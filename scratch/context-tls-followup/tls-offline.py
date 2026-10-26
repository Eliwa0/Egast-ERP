import ast,io,json,os,unittest
from pathlib import Path
from unittest.mock import patch
from dotenv import dotenv_values,load_dotenv
import requests
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
source=ROOT/'backend/api/services/sap_service.py'
tree=ast.parse(source.read_text(encoding='utf-8'))
function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_env_bool')
namespace={'os':os};exec(compile(ast.Module(body=[function],type_ignores=[]),str(source),'exec'),namespace)
env_bool=namespace['_env_bool']
class OfflineTLSContract(unittest.TestCase):
 def test_missing_flag_defaults_to_verified(self):
  with patch.dict(os.environ,{},clear=True):self.assertTrue(env_bool('SAP_VERIFY_SSL',True))
 def test_explicit_secure_flag(self):
  with patch.dict(os.environ,{'SAP_VERIFY_SSL':'true'},clear=True):self.assertTrue(env_bool('SAP_VERIFY_SSL',True))
 def test_dotenv_does_not_override_process(self):
  with patch.dict(os.environ,{'SAP_VERIFY_SSL':'true'},clear=True):
   load_dotenv(stream=io.StringIO('SAP_VERIFY_SSL=false\n'),override=False)
   self.assertTrue(env_bool('SAP_VERIFY_SSL',True))
 def test_requests_accepts_ca_bundle_with_verification_enabled(self):
  with patch.dict(os.environ,{'REQUESTS_CA_BUNDLE':'test-only-ca-path.pem'},clear=True):
   with requests.Session() as session:
    settings=session.merge_environment_settings('https://example.invalid/',{},None,True,None)
   self.assertEqual(settings['verify'],'test-only-ca-path.pem')
   # This verifies Requests configuration merging only. No file opened, no certificate verified.
values=dotenv_values(ROOT/'backend/.env');flag='SAP_VERIFY_SSL'
effective=os.environ.get(flag,values.get(flag,'true'))
safety={'flag':flag,'source':'process environment' if flag in os.environ else 'backend/.env' if flag in values else 'default',
 'verification_enabled':str(effective).strip().lower() in {'1','true','yes','on'},
 'requests_ca_bundle_configured':bool(os.environ.get('REQUESTS_CA_BUNDLE') or values.get('REQUESTS_CA_BUNDLE')),
 'curl_ca_bundle_configured':bool(os.environ.get('CURL_CA_BUNDLE') or values.get('CURL_CA_BUNDLE')),
 'live_requests':0,'server_chain_verified':False}
with patch('requests.sessions.Session.request',side_effect=AssertionError('Live network prohibited')):
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(OfflineTLSContract))
safety['offline_tests']={'run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped)}
(OUT/'tls-offline.json').write_text(json.dumps(safety,indent=2))
raise SystemExit(not result.wasSuccessful())
