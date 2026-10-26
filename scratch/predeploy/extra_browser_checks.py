"""Run existing intercepted-API browser tests; adapt only local origin/artifact path."""
import json
from pathlib import Path
import subprocess
import sys
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
(OUT/'extra').mkdir(exist_ok=True)
results=[]
previous=OUT/'extra-initial'
previous.mkdir(exist_ok=True)
for file in [OUT/'extra-browser-results.json', *OUT.glob('test-*.py.log')]:
    if file.exists():
        (previous/file.name).write_bytes(file.read_bytes())
for name in ['test-select-ux-browser.py','test-master-search-workflow-ui.py','test-sales-order-independent-ui.py']:
    original=ROOT/'frontend/scripts'/name
    code=original.read_text(encoding='utf-8').replace('127.0.0.1:5173','127.0.0.1:5188').replace('127.0.0.1:5189','127.0.0.1:5188')
    code=code.replace("'scratch/", "'scratch/predeploy/extra/").replace('"scratch/', '"scratch/predeploy/extra/')
    adapter=OUT/name
    adapter.write_text(code,encoding='utf-8')
    with (OUT/(name+'.log')).open('wb') as log:
        try:
            result=subprocess.run([sys.executable,str(adapter)],cwd=ROOT,stdout=log,stderr=log,timeout=150)
            code=result.returncode
        except subprocess.TimeoutExpired:
            code=124
    results.append({'source':original.relative_to(ROOT).as_posix(),'exit_code':code,'adapter_changes':'origin/artifact path only'})
    (OUT/'extra-browser-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print(json.dumps(results[-1]),flush=True)
raise SystemExit(int(any(r['exit_code'] for r in results)))
