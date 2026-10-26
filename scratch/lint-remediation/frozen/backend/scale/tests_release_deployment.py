"""Verify ERP downloads contain the approved, already-built recovery release."""
import hashlib
import io
import json
import zipfile
import tempfile
from pathlib import Path

from django.conf import settings
from django.test import TestCase, override_settings
from django.urls import reverse

from scale.models import ScaleDevice
from scale.tests_deployment import _make_user


@override_settings(SCALE_AGENT_SERVER_URL='http://192.0.2.10:8000')
class RecoveryReleaseDownloadTests(TestCase):
    # Explicit operator approval in this task; not computed from the file under test.
    expected_hash = 'DF4A8921C03CAA8C52D4F10D50863ED5B4EA2B56DA7EC5B45DE716F2787B1163'

    def setUp(self):
        self.client.force_login(_make_user('release_admin', 'scale_admin'))
        self.device = ScaleDevice.objects.create(
            device_id='RELEASE-AUTO', device_name='Recovery Scale',
            device_type='local', com_port=None, baud_rate=None,
        )
        ScaleDevice.objects.create(
            device_id='INACTIVE', device_name='Inactive', is_active=False,
        )
        ScaleDevice.objects.create(
            device_id='REMOTE', device_name='Remote', device_type='remote',
        )

    def check_download(self, params):
        # Use the actual configured EXE, not a mock or a test path override.
        url = reverse('scale_agent_deploy')
        self.assertEqual(url, '/scale-management/deploy/')
        response = self.client.get(url, params)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/zip')
        self.assertIn('attachment;', response['Content-Disposition'])
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(set(archive.namelist()), {
                'ScaleAgent/ScaleAgent.exe', 'ScaleAgent/config.json',
                'ScaleAgent/install.bat', 'ScaleAgent/uninstall.bat',
                'ScaleAgent/README.txt',
            })
            executable = archive.read('ScaleAgent/ScaleAgent.exe')
            self.assertTrue(executable.startswith(b'MZ'))
            self.assertEqual(hashlib.sha256(executable).hexdigest().upper(), self.expected_hash)
            config = json.loads(archive.read('ScaleAgent/config.json'))
            self.assertEqual(config['server_url'], settings.SCALE_AGENT_SERVER_URL)
            self.assertEqual(config['local_api_host'], '127.0.0.1')
            self.assertEqual(config['local_api_port'], 8998)
            self.assertEqual([d['device_id'] for d in config['devices']], ['RELEASE-AUTO'])
            self.assertEqual(config['devices'][0]['com_port'], 'AUTO')
            self.assertEqual(config['devices'][0]['baud_rate'], 'AUTO')

    def test_all_active_local_scales_download_approved_executable(self):
        self.check_download({})

    def test_selected_scale_download_approved_executable(self):
        ScaleDevice.objects.create(device_id='OTHER-LOCAL', device_name='Other')
        self.check_download({'scale_id': self.device.device_id})

    def test_unapproved_executable_is_rejected_without_returning_zip(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'ScaleAgent.exe'
            path.write_bytes(b'MZ unapproved executable')
            with override_settings(SCALE_AGENT_EXE_PATH=str(path)):
                response = self.client.get(reverse('scale_agent_deploy'))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertIn('integrity', response.json()['error'])
        self.assertNotIn('Content-Disposition', response)

    def test_invalid_approval_configuration_fails_closed(self):
        with override_settings(SCALE_AGENT_APPROVED_SHA256='invalid-pin'):
            response = self.client.get(reverse('scale_agent_deploy'))
        self.assertEqual(response.status_code, 503)
