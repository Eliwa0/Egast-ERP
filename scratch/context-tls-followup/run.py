import hashlib,json,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
manifest=json.loads((ROOT/'scratch/remaining-remediation-20261021/manifest.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
before={k:sha(ROOT/k) for k in manifest['files']}
(OUT/'start-hashes.json').write_text(json.dumps(before,indent=2))
commands=[['node',str(OUT/'context-alternatives.mjs')],[sys.executable,str(OUT/'tls-offline.py')],['node',str(ROOT/'frontend/node_modules/eslint/bin/eslint.js'),'src/contexts/AuthContext.jsx','src/contexts/I18nContext.jsx','src/components/ui/ToastProvider.jsx']]
rows=[]
for i,command in enumerate(commands):
 start=time.perf_counter();cwd=ROOT/'frontend' if i==2 else ROOT
 with (OUT/f'check-{i+1}.log').open('wb') as log:result=subprocess.run(command,cwd=cwd,stdout=log,stderr=log)
 rows.append({'command':command,'cwd':str(cwd),'exit_code':result.returncode,'seconds':round(time.perf_counter()-start,3)})
 assert all(sha(ROOT/k)==v for k,v in before.items())
(OUT/'results.json').write_text(json.dumps(rows,indent=2))
(OUT/'integrity.json').write_text(json.dumps({'baseline_manifest_sha256':manifest['sha256'],'baseline_drift':[k for k,h in manifest['files'].items() if before[k]!=h],'source_changes':[],'protected_content_read_or_hashed':False},indent=2))
print(json.dumps([{'check':i+1,'exit_code':r['exit_code']} for i,r in enumerate(rows)]))
