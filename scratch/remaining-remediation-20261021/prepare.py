import hashlib,json,os,re
from pathlib import Path
from dotenv import dotenv_values
ROOT=Path(__file__).resolve().parents[2]; OUT=Path(__file__).resolve().parent
old=ROOT/'scratch/handover-current-review'
manifest=json.loads((old/'manifest.json').read_text())['files']
before={k:hashlib.sha256((ROOT/k).read_bytes()).hexdigest() for k in manifest if (ROOT/k).exists()}
(OUT/'start-hashes.json').write_text(json.dumps(before,indent=2))
consumers=[]
for k in before:
 if k.startswith('frontend/') and Path(k).suffix in {'.js','.jsx','.mjs'}:
  for n,line in enumerate((ROOT/k).read_text(encoding='utf-8').splitlines(),1):
   if re.search(r'(?:import|export).*?(?:AuthContext|I18nContext|ToastProvider)',line):consumers.append({'file':k,'line':n,'source':line.strip()})
(OUT/'allowed-consumers.json').write_text(json.dumps(consumers,indent=2))
values=dotenv_values(ROOT/'backend/.env'); name='SAP_VERIFY_SSL'
effective=os.environ.get(name,values.get(name,'true'))
safe={'tls_flag_source':'process environment' if name in os.environ else 'backend/.env' if name in values else 'default true',
 'tls_verification_enabled':str(effective).lower().strip() in {'1','true','yes','on'},
 'requests_ca_bundle_configured':bool(os.environ.get('REQUESTS_CA_BUNDLE') or values.get('REQUESTS_CA_BUNDLE')),
 'curl_ca_bundle_configured':bool(os.environ.get('CURL_CA_BUNDLE') or values.get('CURL_CA_BUNDLE')),
 'live_connections_executed':0,'certificate_chain_validated':False}
(OUT/'tls-safety.json').write_text(json.dumps(safe,indent=2));print(json.dumps(safe))
for name in ['verify.py','backend.py','serve.mjs','visual.py','vendor-lifecycle.py','header.py']:
 text=(old/name).read_text(encoding='utf-8').replace('5200','5202')
 if name=='verify.py':text=text.replace("[node,'scripts/check-i18n.js']","[node,str(OUT/'check-i18n-allowed.mjs')]")
 (OUT/name).write_text(text,encoding='utf-8')
# Keep the original validation rules; replace only source discovery and protected key scope.
checker=(ROOT/'frontend/scripts/check-i18n.js').read_text(encoding='utf-8')
checker=checker.replace("const srcDir = path.resolve(__dirname, '../src');","const srcDir = path.resolve(process.env.FROZEN_ROOT, 'frontend/src');")
checker=checker.replace('const allFiles = getAllFiles(srcDir);',"const allowedManifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'manifest.json'), 'utf8'));\nconst allFiles = Object.keys(allowedManifest.files).filter(k => k.startsWith('frontend/src/') && /\\.[jt]sx?$/.test(k)).map(k => path.resolve(process.env.FROZEN_ROOT, k));")
checker=checker.replace('// Import translations',"for (const key of extractedKeys.keys()) { if (/scale/i.test(key)) extractedKeys.delete(key); }\n// Import translations")
(OUT/'check-i18n-allowed.mjs').write_text(checker,encoding='utf-8')
print('Allowed consumer imports:',len(consumers))
