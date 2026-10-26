import hashlib,json,zipfile,difflib,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
manifest=json.loads((OUT/'frozen-final-manifest.json').read_text())
start=json.loads((OUT/'start-hashes.json').read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
changed=[k for k,h in start.items() if not (ROOT/k).exists() or sha(ROOT/k)!=h]
drift=[k for k,h in manifest['files'].items() if not (ROOT/k).exists() or sha(ROOT/k)!=h]
frozen_drift=[k for k,h in manifest['files'].items() if sha(OUT/'frozen-final'/k)!=h]
protected=[k for k in start if k.startswith(('backend/scale/','frontend/src/modules/scale/'))]
report={'snapshot_sha256':manifest['sha256'],'changed_since_task_start':changed,'working_tree_drift_since_freeze':drift,
 'frozen_input_drift':frozen_drift,'protected_scale_source_files':len(protected),'protected_scale_source_changed':[k for k in protected if k in changed],
 'backend_changed':[k for k in changed if k.startswith('backend/')],
 'frontend_python_scripts_not_run':[p.relative_to(ROOT).as_posix() for p in (ROOT/'frontend/scripts').glob('test*.py') if p.name not in {'test-select-ux-browser.py','test-master-search-workflow-ui.py','test-sales-order-independent-ui.py'}]}
(OUT/'final-integrity.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
with zipfile.ZipFile(OUT/'before.zip') as z:
    diffs=[]
    for key in changed:
        if key in z.namelist() and (ROOT/key).suffix in {'.jsx','.js','.mjs','.py'}:
            diffs.extend(difflib.unified_diff(z.read(key).decode('utf-8-sig').replace('\r\n','\n').splitlines(True),(ROOT/key).read_text(encoding='utf-8-sig').splitlines(True),fromfile='start/'+key,tofile='current/'+key))
    (OUT/'task-only.diff').write_text(''.join(diffs),encoding='utf-8')
ledger=[]
for row in json.loads((OUT/'lint-final.json').read_text(encoding='utf-8')):
    path=Path(row['filePath']);lines=path.read_text(encoding='utf-8-sig').splitlines()
    for m in row['messages']:
        rule=m['ruleId'];line=m['line'];file=path.relative_to(OUT/'frozen-final').as_posix()
        if rule=='no-dupe-keys':disposition='Unresolved: protected scale translation namespace; not edited under explicit user exclusion.'
        elif rule=='react-refresh/only-export-components':disposition='Unresolved: mixed component/hook/helper exports; splitting module contracts requires further focused regression checks. No rule disabled.'
        elif rule=='react-hooks/set-state-in-effect':disposition='Unresolved: synchronous loading state in shared cost-center effect; no render-loop failure proved here, no scheduling/performance rewrite made.'
        elif rule=='react-hooks/exhaustive-deps':disposition='Unresolved: hook dependency review needs lifecycle scenarios; adding dependencies blindly may change reload behavior. Warning retained.'
        else:disposition='Unresolved: unused binding/handler/parameter; no runtime ReferenceError implied. Existing functionality not deleted solely to pass lint.'
        ledger.append({'file':file,'line':line,'severity':m['severity'],'rule':rule,'message':m['message'],'source_context':lines[max(0,line-3):line+2],'disposition':disposition})
(OUT/'lint-review-ledger.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2),encoding='utf-8')
for name,args in [('git-after.txt',['git','status','--short']),('git-diff-after.txt',['git','diff','--no-ext-diff'])]:
    with (OUT/name).open('wb') as f:subprocess.run(args,cwd=ROOT,stdout=f,stderr=subprocess.DEVNULL)
print(json.dumps(report));print('Remaining lint findings:',len(ledger))
