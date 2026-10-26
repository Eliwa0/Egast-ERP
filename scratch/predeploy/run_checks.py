"""Capture real subprocess exit codes; never invoke live SAP diagnostic scripts."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
kind = sys.argv[1]
cwd = ROOT
env = os.environ.copy()
if kind == 'frontend':
    excluded = {'test-click-traceability.mjs', 'test-print-render.mjs', 'test-responsive-browser.mjs', 'test_modal.mjs'}
    paths = sorted((ROOT/'frontend/src').rglob('*.test.mjs')) + [p for p in sorted((ROOT/'frontend/scripts').glob('test*.mjs')) if p.name not in excluded]
    cwd = ROOT/'frontend'
    command = ['node', '--test', '--test-concurrency=1', *[str(p.relative_to(cwd)) for p in paths]]
elif kind == 'backend':
    env['STABILITY_RUN_NAME'] = 'predeploy-backend-postgres'
    env['QUOTATION_CURRENCY_BROWSER_URL'] = 'http://127.0.0.1:5188'
    command = [str(ROOT/'.venv/Scripts/python.exe'), 'backend/run_stability_tests.py', '--postgres']
else:
    raise SystemExit('unknown suite')
start = time.perf_counter()
with (OUT/(kind+'.log')).open('wb') as log:
    try:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=log, stderr=log, timeout=600)
        code = result.returncode
    except subprocess.TimeoutExpired:
        code = 124
summary = {'command': command, 'cwd': str(cwd), 'exit_code': code, 'elapsed_s': round(time.perf_counter()-start, 2)}
(OUT/(kind+'-command.json')).write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps({'suite': kind, 'exit_code': code, 'elapsed_s': summary['elapsed_s']}))
raise SystemExit(code)
