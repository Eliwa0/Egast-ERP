"""Provision the local scale credential without printing or embedding secrets."""
import json
import os
from pathlib import Path
import secrets
import urllib.request
from dotenv import dotenv_values, set_key

root = Path(__file__).resolve().parents[1]
agent_config = Path(r'D:\ScaleAgent_SCALE_02_Deployment (1)\ScaleAgent\config.json')
config = json.loads(agent_config.read_text(encoding='utf-8'))
env_path = root / 'backend' / '.env'
token = dotenv_values(env_path).get('SCALE_AGENT_AUTH_TOKEN') or secrets.token_urlsafe(48)
set_key(str(env_path), 'SCALE_AGENT_AUTH_TOKEN', token)
config['auth_token'] = token
agent_config.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
# Django's development autoreloader watches its settings module, unlike .env.
settings_file = root / 'backend' / 'receipt_project' / 'settings.py'
os.utime(settings_file, None)
request = urllib.request.Request('http://127.0.0.1:8998/reload-config', data=b'{}',
    headers={'Content-Type': 'application/json'}, method='POST')
with urllib.request.urlopen(request, timeout=10) as response:
    print('Agent reload:', response.status)
print('Shared scale credential configured. No credential values logged.')
