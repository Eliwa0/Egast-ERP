"""Isolated, pinned verification. No operational DB migrations or live SAP calls."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
FROZEN=OUT/'frozen-final'
NODE=shutil.which('node')
phase=sys.argv[1]

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def files():
    return [p for base in ['backend','frontend'] for p in (ROOT/base).rglob('*')
        if p.is_file() and not any(part in {'node_modules','dist','__pycache__','responsive-screenshots','.git'} for part in p.relative_to(ROOT).parts)
        and not p.name.startswith('.env') and p.suffix.lower() in {'.py','.js','.jsx','.mjs','.css','.json','.html','.txt','.png','.svg','.jpg','.jpeg','.woff','.woff2','.ttf','.ico'}
        and not p.name.startswith(('sqlite_backup','uat_results'))]

if phase=='freeze':
    assert not FROZEN.exists(),'Do not replace an existing reviewed snapshot'
    manifest={}
    for p in files():
        key=p.relative_to(ROOT).as_posix();before=digest(p);target=FROZEN/key
        target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
        assert digest(target)==before and digest(p)==before,key
        manifest[key]=before
    identity=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    (OUT/'frozen-final-manifest.json').write_text(json.dumps({'sha256':identity,'files':manifest},indent=2),encoding='utf-8')
    (FROZEN/'scratch').mkdir(exist_ok=True)
    print(json.dumps({'snapshot_sha256':identity,'files':len(manifest)}));raise SystemExit(0)

manifest=json.loads((OUT/'frozen-final-manifest.json').read_text())
def check():
    changed=[key for key,h in manifest['files'].items() if not (FROZEN/key).exists() or digest(FROZEN/key)!=h]
    assert not changed,changed
check()
results=[]
env=os.environ.copy()
env['TEST_FRONTEND_ORIGIN']='http://127.0.0.1:5192'
env['QUOTATION_CURRENCY_BROWSER_URL']=env['TEST_FRONTEND_ORIGIN']
env['FROZEN_ROOT']=str(FROZEN)
env['PYTHONPATH']=str(ROOT/'scratch/readiness-pdf-tools')
def run(name,command,cwd,timeout=600):
    start=time.perf_counter()
    with (OUT/(name+'.log')).open('wb') as log:
        try:code=subprocess.run(command,cwd=cwd,env=env,stdout=log,stderr=log,timeout=timeout).returncode
        except subprocess.TimeoutExpired:code=124
    check()
    row={'name':name,'snapshot_sha256':manifest['sha256'],'command':command,'cwd':str(cwd),'exit_code':code,'elapsed_s':round(time.perf_counter()-start,2)}
    results.append(row)
    (OUT/(phase+'-results.json')).write_text(json.dumps(results,indent=2),encoding='utf-8')
    print(json.dumps({'name':name,'exit_code':code,'elapsed_s':row['elapsed_s']}),flush=True)

if phase=='node':
    excluded=[];paths=[]
    for p in sorted((FROZEN/'frontend/src').rglob('*.test.mjs'))+sorted((FROZEN/'frontend/scripts').glob('test*.mjs')):
        text=p.read_text(encoding='utf-8')
        reason=None
        if re.search(r'modules/scale|/scale/|ScaleAgent|canAccessScale|scale-monitor',text,re.I) or 'scale' in p.name.lower() or p.name in {'test-module-permissions.mjs','test-shipping-loading-wizard.mjs'}:reason='scale or weight fixture dependencies excluded by user'
        if p.name in {'test-click-traceability.mjs','test-print-render.mjs','test_modal.mjs','test-responsive-browser.mjs'}:reason='legacy CDP/scale checks excluded; not part of isolated Node suite'
        if reason:excluded.append({'file':p.relative_to(FROZEN).as_posix(),'reason':reason})
        else:paths.append(str(p.relative_to(FROZEN/'frontend')))
    (OUT/'node-exclusions.json').write_text(json.dumps(excluded,indent=2))
    run('node',[NODE,'--test','--test-concurrency=1',*paths],FROZEN/'frontend')
elif phase=='quality':
    run('lint',[NODE,str(FROZEN/'frontend/node_modules/eslint/bin/eslint.js'),'.','--ignore-pattern','src/modules/scale/**','--format','json','--output-file',str(OUT/'lint-final.json')],FROZEN/'frontend')
    run('translations',[NODE,'scripts/check-i18n.js'],FROZEN/'frontend')
    run('build',[NODE,str(FROZEN/'frontend/node_modules/vite/bin/vite.js'),'build'],FROZEN/'frontend')
elif phase=='browser':
    for name in ['test-select-ux-browser.py','test-master-search-workflow-ui.py','test-sales-order-independent-ui.py']:
        run(name,[sys.executable,str(FROZEN/'frontend/scripts'/name)],FROZEN,180)
elif phase=='backend':
    run('backend',[sys.executable,str(OUT/'backend_no_scale.py')],FROZEN)
else:raise SystemExit('unknown phase')
raise SystemExit(int(any(row['exit_code'] for row in results)))
