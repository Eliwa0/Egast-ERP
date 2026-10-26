import hashlib,json,os,shutil,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent;FROZEN=OUT/'frozen'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
phase=sys.argv[1]
if phase=='freeze':
 assert not FROZEN.exists()
 manifest={}
 for base in ['frontend','backend']:
  for folder,dirs,files in os.walk(ROOT/base):
   dirs[:]=[d for d in dirs if d not in {'node_modules','dist','__pycache__','responsive-screenshots','.git','scale'}]
   for name in files:
    p=Path(folder)/name;key=p.relative_to(ROOT).as_posix()
    if p.suffix not in {'.js','.jsx','.mjs','.py','.css','.json','.html','.png','.svg','.jpg','.jpeg','.woff','.woff2','.ttf','.ico','.txt'} or name.startswith('.env'):continue
    if 'scale' in name.lower() or ('scripts/' in key and 'responsive' in name.lower()):
     target=FROZEN/key;target.parent.mkdir(parents=True,exist_ok=True);os.link(p,target);continue
    if key=='frontend/src/i18n/translations.js':continue
    target=FROZEN/key;target.parent.mkdir(parents=True,exist_ok=True);h=sha(p);shutil.copyfile(p,target);assert h==sha(target)==sha(p);manifest[key]=h
 # Protected sources remain untouched dependencies. No review/hash/read of their content.
 for key in ['frontend/src/i18n/translations.js']:
  os.link(ROOT/key,FROZEN/key)
 for key in ['backend/scale','frontend/src/modules/scale','frontend/node_modules']:
  target=FROZEN/key;target.parent.mkdir(parents=True,exist_ok=True)
  subprocess.run(['cmd','/c','mklink','/J',str(target),str(ROOT/key)],check=True,stdout=subprocess.DEVNULL)
 (FROZEN/'scratch').mkdir(exist_ok=True)
 identity=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 (OUT/'manifest.json').write_text(json.dumps({'sha256':identity,'files':manifest,'protected_dependencies':'Existing protected directories referenced without inspection or fresh content hashing; translation file hard-linked unchanged.'},indent=2))
 print(identity);raise SystemExit(0)
manifest=json.loads((OUT/'manifest.json').read_text());results=[]
def check():
 assert all(sha(FROZEN/k)==h for k,h in manifest['files'].items()),'Frozen input changed'
check();env=os.environ.copy();env.update(TEST_FRONTEND_ORIGIN='http://127.0.0.1:5196',QUOTATION_CURRENCY_BROWSER_URL='http://127.0.0.1:5196',FROZEN_ROOT=str(FROZEN),PYTHONPATH=str(ROOT/'scratch/readiness-pdf-tools'))
def run(name,args,cwd,timeout=600):
 t=time.perf_counter()
 with (OUT/(name+'.log')).open('wb') as log:
  try:code=subprocess.run(args,cwd=cwd,env=env,stdout=log,stderr=log,timeout=timeout).returncode
  except subprocess.TimeoutExpired:code=124
 check();results.append({'name':name,'command':args,'cwd':str(cwd),'exit_code':code,'seconds':round(time.perf_counter()-t,2),'snapshot_sha256':manifest['sha256']})
 (OUT/(phase+'-results.json')).write_text(json.dumps(results,indent=2));print(name,code,flush=True)
node=shutil.which('node');front=FROZEN/'frontend'
if phase=='node':
 old=json.loads((ROOT/'scratch/frontend-remediation/node-results.json').read_text())[0]['command'][4:]
 # The first source path is at index 3; preserve the complete previously validated list.
 old=json.loads((ROOT/'scratch/frontend-remediation/node-results.json').read_text())[0]['command'][3:]
 old+=['src/utils/salesDocumentFormatting.test.mjs']
 run('node',[node,'--test','--test-concurrency=1',*old],front)
elif phase=='quality':
 run('lint',[node,'node_modules/eslint/bin/eslint.js','.','--ignore-pattern','**/modules/scale/**','--ignore-pattern','**/*[Ss]cale*','--ignore-pattern','**/fixtures/responsive-harness.jsx','--ignore-pattern','**/i18n/translations.js','--format','json','--output-file',str(OUT/'lint-final.json')],front)
 run('translations',[node,'scripts/check-i18n.js'],front)
 run('build',[node,'node_modules/vite/bin/vite.js','build'],front)
elif phase=='browser':
 for name in ['test-select-ux-browser.py','test-master-search-workflow-ui.py','test-sales-order-independent-ui.py','test-cost-center-lifecycle-browser.py']:run(name,[sys.executable,str(front/'scripts'/name)],FROZEN,180)
elif phase=='visual':run('visual',[sys.executable,str(OUT/'visual.py'),'after'],FROZEN)
elif phase=='vendor':run('vendor',[sys.executable,str(OUT/'vendor-lifecycle.py')],FROZEN)
elif phase=='backend':run('backend',[sys.executable,str(OUT/'backend.py')],FROZEN)
else:raise SystemExit('unknown phase')
raise SystemExit(int(any(r['exit_code'] for r in results)))
