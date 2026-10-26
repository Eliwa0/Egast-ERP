"""API suite on disposable PostgreSQL; explicitly exclude scale/weight-related tests."""
import importlib.util
import inspect
import json
import os
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch
from dotenv import load_dotenv
OUT=Path(__file__).resolve().parent
load_dotenv(OUT.parents[1]/'backend/.env')
root=Path(os.environ['FROZEN_ROOT'])
sys.path.insert(0,str(root/'backend'))
sys.argv=['run_stability_tests.py','--postgres','api']
os.environ['STABILITY_RUN_NAME']='frontend-remediation-backend'
spec=importlib.util.spec_from_file_location('health_runner',root/'backend/run_stability_tests.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
excluded=[]
class Runner(module.Runner):
    def build_suite(self,*args,**kwargs):
        suite=super().build_suite(*args,**kwargs)
        def flatten(suite):
            for item in suite:
                if isinstance(item,unittest.TestSuite):yield from flatten(item)
                else:yield item
        kept=[]
        for test in flatten(suite):
            identity=test.id()
            source=inspect.getsource(type(test))
            if type(test).__module__!='api.tests':source+='\n'+inspect.getsource(sys.modules[type(test).__module__])
            if re.search(r'scale|weigh|ScaleAgent',identity+'\n'+source,re.I):excluded.append({'test':identity,'reason':'scale/weight domain or fixture dependency excluded by user'})
            else:kept.append(test)
        (OUT/'backend-exclusions.json').write_text(json.dumps(excluded,indent=2))
        return unittest.TestSuite(kept)
with patch('requests.sessions.Session.request',side_effect=module.forbid_network):
    failed=Runner(verbosity=1,interactive=False).run_tests(['api'])
result=root/'scratch/frontend-remediation-backend.json'
if result.exists():(OUT/'backend-final.json').write_bytes(result.read_bytes())
raise SystemExit(bool(failed))
