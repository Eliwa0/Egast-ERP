import importlib.util,json,os,sys
from pathlib import Path
from unittest.mock import patch
from dotenv import load_dotenv
OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[1];FROZEN=Path(os.environ['FROZEN_ROOT'])
load_dotenv(ROOT/'backend/.env');sys.path.insert(0,str(FROZEN/'backend'))
sys.argv=['run_stability_tests.py','--postgres'];os.environ['STABILITY_RUN_NAME']='lint-backend'
spec=importlib.util.spec_from_file_location('lint_backend_runner',FROZEN/'backend/run_stability_tests.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
# Exact 550 previously executed API case IDs: no discovery/inspection of excluded cases.
ids=[r['test'] for r in json.loads((ROOT/'scratch/frontend-remediation/backend-final.json').read_text())['cases']]
with patch('requests.sessions.Session.request',side_effect=module.forbid_network):
 failed=module.Runner(verbosity=1,interactive=False).run_tests(ids)
result=FROZEN/'scratch/lint-backend.json'
if result.exists():(OUT/'backend-final.json').write_bytes(result.read_bytes())
raise SystemExit(bool(failed))
