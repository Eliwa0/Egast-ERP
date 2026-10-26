import io
import hashlib
import json
import os
import tempfile
import zipfile

from django.contrib.auth.models import User
from django.conf import settings
from django.test import TestCase, override_settings

from scale.models import ScaleDevice
from scale.services.deployment_service import (
    DeploymentError,
    build_agent_config_json,
    build_deployment_zip,
    create_deployment,
    get_deployable_devices,
)


def _make_user(username, role):
    user = User.objects.create_user(username=username, password="password123")
    user.userprofile.role = role
    user.userprofile.save()
    return user


@override_settings(SCALE_AGENT_AUTH_TOKEN='deployment-test-token')
class BaseDeploymentTestCase(TestCase):
    def setUp(self):
        self.admin = _make_user("dep_admin", "scale_admin")
        self.operator = _make_user("dep_operator", "scale_operator")
        self.prod_user = _make_user("dep_prod", "production_user")

        self.dev1 = ScaleDevice.objects.create(
            device_id="SCALE-01", device_name="Main Gate",
            device_type="local", com_port="COM3", baud_rate=9600,
        )
        self.dev2 = ScaleDevice.objects.create(
            device_id="SCALE-02", device_name="Second Scale",
            device_type="local", com_port="COM4", baud_rate=4800,
        )
        self.inactive = ScaleDevice.objects.create(
            device_id="SCALE-OFF", device_name="Decommissioned",
            device_type="local", com_port="COM9", is_active=False,
        )
        self.virtual = ScaleDevice.objects.create(
            device_id="SCALE-VIRT", device_name="Virtual",
            device_type="virtual", com_port=None,
        )


@override_settings(SCALE_AGENT_SERVER_URL="")
class DeployServerUrlTestCase(BaseDeploymentTestCase):
    def test_missing_server_url_returns_400(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/scale-management/deploy/")
        self.assertEqual(resp.status_code, 400)
        data = json.loads(resp.content)
        self.assertIn("SCALE_AGENT_SERVER_URL", data["error"])


class DeployAuthTestCase(BaseDeploymentTestCase):
    def setUp(self):
        super().setUp()
        self._exe_dir = tempfile.mkdtemp()
        self.exe_path = os.path.join(self._exe_dir, "ScaleAgent.exe")
        with open(self.exe_path, "wb") as f:
            f.write(b"MZ fake exe")

        pin = override_settings(SCALE_AGENT_APPROVED_SHA256=hashlib.sha256(b"MZ fake exe").hexdigest())
        pin.enable()
        self.addCleanup(pin.disable)

    def tearDown(self):
        os.remove(self.exe_path)

    def _zip(self):
        return self.client.get("/scale-management/deploy/")

    @override_settings(SCALE_AGENT_SERVER_URL="http://192.168.1.50:8000")
    def test_unauthenticated_rejected(self):
        resp = self._zip()
        self.assertEqual(resp.status_code, 401)

    @override_settings(SCALE_AGENT_SERVER_URL="http://192.168.1.50:8000")
    def test_scale_operator_rejected(self):
        self.client.force_login(self.operator)
        resp = self._zip()
        self.assertEqual(resp.status_code, 403)

    @override_settings(SCALE_AGENT_SERVER_URL="http://192.168.1.50:8000")
    def test_production_user_rejected(self):
        self.client.force_login(self.prod_user)
        resp = self._zip()
        self.assertEqual(resp.status_code, 403)

    @override_settings(
        SCALE_AGENT_SERVER_URL="http://192.168.1.50:8000",
        SCALE_AGENT_EXE_PATH="__unset__",
    )
    def test_scale_admin_allowed_but_exe_missing_returns_clear_error(self):
        self.client.force_login(self.admin)
        resp = self._zip()
        self.assertEqual(resp.status_code, 400)
        data = json.loads(resp.content)
        self.assertIn("has not been built", data["error"])


class DeploymentConfigGenerationTestCase(BaseDeploymentTestCase):
    @override_settings(SCALE_AGENT_AUTH_TOKEN='')
    def test_download_cannot_ship_an_unconfigured_credential(self):
        with self.assertRaises(DeploymentError):
            build_agent_config_json([self.dev1], 'http://erp:8000')

    def test_config_includes_active_scales_only(self):
        self.client.force_login(self.admin)
        config = build_agent_config_json([self.dev1, self.dev2], "http://erp:8000")
        data = json.loads(config)
        ids = [d["device_id"] for d in data["devices"]]
        self.assertEqual(set(ids), {"SCALE-01", "SCALE-02"})

    def test_single_scale_selection(self):
        devices = get_deployable_devices(scale_id="SCALE-01")
        self.assertEqual([d.device_id for d in devices], ["SCALE-01"])

    def test_specific_server_url_used(self):
        config = build_agent_config_json([self.dev1], "http://192.168.1.100:8000")
        data = json.loads(config)
        self.assertEqual(data["server_url"], "http://192.168.1.100:8000")
        self.assertNotEqual(data["server_url"], "http://localhost:8000")

    def test_device_mapping_uses_existing_fields(self):
        data = json.loads(build_agent_config_json([self.dev1], "http://x:8000"))
        dev = data["devices"][0]
        self.assertEqual(dev["device_id"], "SCALE-01")
        self.assertEqual(dev["device_name"], "Main Gate")
        self.assertEqual(dev["device_type"], "local")
        self.assertEqual(dev["com_port"], "COM3")
        self.assertEqual(dev["baud_rate"], 9600)
        # Agent-only fields use documented defaults
        self.assertEqual(dev["data_bits"], 8)
        self.assertEqual(dev["stop_bits"], 1)
        self.assertEqual(dev["parity"], "N")
        self.assertEqual(dev["serial_timeout"], 1.0)
        self.assertEqual(dev["poll_interval"], 0.1)
        self.assertEqual(dev["stable_sample_count"], 3)
        self.assertEqual(dev["stable_delta"], 0.02)

    @override_settings(SCALE_AGENT_AUTH_TOKEN="deployment-agent-token")
    def test_config_contains_only_the_dedicated_agent_credential(self):
        config = build_agent_config_json([self.dev1], "http://x:8000")
        data = json.loads(config)
        self.assertEqual(data["auth_token"], "deployment-agent-token")
        self.assertNotIn(settings.SECRET_KEY, config)
        self.assertNotIn("password", config.lower())


class DeploymentAutoConfigTestCase(BaseDeploymentTestCase):
    """Phase C/D: AUTO (auto-detect) mode must flow into the agent config."""

    def setUp(self):
        super().setUp()
        self.auto_dev = ScaleDevice.objects.create(
            device_id="SCALE-AUTO", device_name="Auto Gate",
            device_type="local", com_port=None, baud_rate=None,
        )

    def test_auto_device_emits_auto_for_com_and_baud(self):
        data = json.loads(build_agent_config_json([self.auto_dev], "http://x:8000"))
        dev = data["devices"][0]
        self.assertEqual(dev["device_id"], "SCALE-AUTO")
        self.assertEqual(dev["com_port"], "AUTO")
        self.assertEqual(dev["baud_rate"], "AUTO")

    def test_auto_device_only_port_with_manual_baud(self):
        dev = ScaleDevice.objects.create(
            device_id="SCALE-AUTO-B", device_name="B",
            device_type="local", com_port=None, baud_rate=9600,
        )
        data = json.loads(build_agent_config_json([dev], "http://x:8000"))
        d = data["devices"][0]
        self.assertEqual(d["com_port"], "AUTO")
        self.assertEqual(d["baud_rate"], 9600)

    def test_existing_manual_config_keeps_explicit_values(self):
        data = json.loads(build_agent_config_json([self.dev1], "http://x:8000"))
        dev = data["devices"][0]
        self.assertEqual(dev["com_port"], "COM3")
        self.assertEqual(dev["baud_rate"], 9600)

    def test_auto_device_deployable_via_api(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/scale-management/deploy/?scale_id=SCALE-AUTO")
        self.assertEqual(resp.status_code, 200)
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        config = json.loads(zf.read("ScaleAgent/config.json").decode("utf-8"))
        dev = config["devices"][0]
        self.assertEqual(dev["com_port"], "AUTO")
        self.assertEqual(dev["baud_rate"], "AUTO")
        readme = zf.read("ScaleAgent/README.txt").decode("utf-8")
        self.assertIn("AUTO", readme)


class DeploymentErrorHandlingTestCase(BaseDeploymentTestCase):
    def test_invalid_scale_id_raises_404(self):
        with self.assertRaises(DeploymentError) as ctx:
            get_deployable_devices(scale_id="DOES-NOT-EXIST")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_inactive_scale_raises_400(self):
        with self.assertRaises(DeploymentError) as ctx:
            get_deployable_devices(scale_id="SCALE-OFF")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_non_local_scale_raises_400(self):
        with self.assertRaises(DeploymentError) as ctx:
            get_deployable_devices(scale_id="SCALE-VIRT")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_no_active_scales_raises_404(self):
        ScaleDevice.objects.all().delete()
        with self.assertRaises(DeploymentError) as ctx:
            get_deployable_devices()
        self.assertEqual(ctx.exception.status_code, 404)

    @override_settings(SCALE_AGENT_EXE_PATH="__missing_exe__")
    def test_missing_exe_raises_clear_error(self):
        with self.assertRaises(DeploymentError) as ctx:
            build_deployment_zip([self.dev1], "http://erp:8000")
        self.assertIn("not been built", str(ctx.exception))


class DeploymentZIPTestCase(BaseDeploymentTestCase):
    def setUp(self):
        super().setUp()
        self._exe_dir = tempfile.mkdtemp()
        self.exe_path = os.path.join(self._exe_dir, "ScaleAgent.exe")
        with open(self.exe_path, "wb") as f:
            f.write(b"MZ fake exe bytes")
        self._override_exe = override_settings(
            SCALE_AGENT_SERVER_URL="http://192.168.1.50:8000",
            SCALE_AGENT_EXE_PATH=self.exe_path,
            SCALE_AGENT_APPROVED_SHA256=hashlib.sha256(b"MZ fake exe bytes").hexdigest(),
        )
        self._override_exe.enable()
        self.addCleanup(self._override_exe.disable)

    def tearDown(self):
        if os.path.isfile(self.exe_path):
            os.remove(self.exe_path)

    def test_zip_download_all_scales(self):
        ScaleDevice.objects.create(
            device_id='REMOTE-EXCLUDED', device_name='Remote',
            device_type='remote', ip_address='192.0.2.1',
        )
        self.client.force_login(self.admin)
        resp = self.client.get("/scale-management/deploy/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "application/zip")
        self.assertIn('filename="ScaleAgent_Deployment.zip"', resp["Content-Disposition"])

        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        names = zf.namelist()
        self.assertEqual(
            sorted(names),
            [
                "ScaleAgent/README.txt",
                "ScaleAgent/ScaleAgent.exe",
                "ScaleAgent/config.json",
                "ScaleAgent/install.bat",
                "ScaleAgent/uninstall.bat",
            ],
        )
        config = json.loads(zf.read("ScaleAgent/config.json").decode("utf-8"))
        self.assertEqual(config["server_url"], "http://192.168.1.50:8000")
        self.assertEqual(config["local_api_host"], "127.0.0.1")
        self.assertEqual(config["local_api_port"], 8998)
        self.assertEqual(len(config["devices"]), 2)
        self.assertEqual({d['device_id'] for d in config['devices']}, {'SCALE-01', 'SCALE-02'})
        # No secrets/unrelated files
        self.assertNotIn(".env", "\n".join(names))
        self.assertNotIn("settings.py", "\n".join(names))
        readme = zf.read("ScaleAgent/README.txt").decode("utf-8")
        self.assertIn("http://192.168.1.50:8000", readme)
        exe = zf.read("ScaleAgent/ScaleAgent.exe")
        self.assertEqual(exe, b"MZ fake exe bytes")

    def test_zip_download_single_scale_and_filename(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/scale-management/deploy/?scale_id=SCALE-02")
        self.assertEqual(resp.status_code, 200)
        self.assertIn('filename="ScaleAgent_SCALE-02_Deployment.zip"', resp["Content-Disposition"])
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        config = json.loads(zf.read("ScaleAgent/config.json").decode("utf-8"))
        self.assertEqual([d["device_id"] for d in config["devices"]], ["SCALE-02"])

    def test_invalid_scale_id_via_http_returns_404(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/scale-management/deploy/?scale_id=NOPE")
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp["Content-Type"], "application/json")

    def test_inactive_scale_via_http_returns_400(self):
        self.client.force_login(self.admin)
        resp = self.client.get("/scale-management/deploy/?scale_id=SCALE-OFF")
        self.assertEqual(resp.status_code, 400)

    def test_scale_id_is_sanitized_in_filename(self):
        bad = ScaleDevice.objects.create(
            device_id="BAD/../name", device_name="Bad",
            device_type="local", com_port="COM7",
        )
        self.addCleanup(bad.delete)
        self.client.force_login(self.admin)
        resp = self.client.get(
            "/scale-management/deploy/?scale_id=BAD/../name"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("../", resp["Content-Disposition"])

    def test_path_traversal_scale_id_returns_404(self):
        self.client.force_login(self.admin)
        resp = self.client.get(
            "/scale-management/deploy/?scale_id=../../etc/passwd"
        )
        self.assertEqual(resp.status_code, 404)


class DeploymentScriptSafetyTestCase(BaseDeploymentTestCase):
    """Phase 4: install.bat / uninstall.bat inside the package must be safe."""

    def setUp(self):
        super().setUp()
        self._exe_dir = tempfile.mkdtemp()
        self.exe_path = os.path.join(self._exe_dir, "ScaleAgent.exe")
        with open(self.exe_path, "wb") as f:
            f.write(b"MZ fake exe bytes")
        self._override_exe = override_settings(
            SCALE_AGENT_SERVER_URL="http://192.168.1.50:8000",
            SCALE_AGENT_EXE_PATH=self.exe_path,
            SCALE_AGENT_APPROVED_SHA256=hashlib.sha256(b"MZ fake exe bytes").hexdigest(),
        )
        self._override_exe.enable()
        self.addCleanup(self._override_exe.disable)

    def tearDown(self):
        if os.path.isfile(self.exe_path):
            os.remove(self.exe_path)

    def _package(self):
        return build_deployment_zip([self.dev1], "http://192.168.1.50:8000")[0]

    def _script(self, name):
        zf = zipfile.ZipFile(io.BytesIO(self._package()))
        return zf.read(f"ScaleAgent/{name}").decode("utf-8")

    def test_zip_contains_install_and_uninstall_scripts(self):
        zf = zipfile.ZipFile(io.BytesIO(self._package()))
        names = zf.namelist()
        self.assertIn("ScaleAgent/install.bat", names)
        self.assertIn("ScaleAgent/uninstall.bat", names)
        self.assertIn("ScaleAgent/ScaleAgent.exe", names)
        self.assertIn("ScaleAgent/config.json", names)
        # Only the approved deployment files may exist.
        self.assertEqual(
            sorted(names),
            [
                "ScaleAgent/README.txt",
                "ScaleAgent/ScaleAgent.exe",
                "ScaleAgent/config.json",
                "ScaleAgent/install.bat",
                "ScaleAgent/uninstall.bat",
            ],
        )

    def test_scripts_use_crlf_line_endings(self):
        zf = zipfile.ZipFile(io.BytesIO(self._package()))
        for script in ("install.bat", "uninstall.bat"):
            content = zf.read(f"ScaleAgent/{script}")
            self.assertIn(b"\r\n", content, f"{script} must use CRLF endings")

    def test_install_script_targets_program_files(self):
        install_bat = self._script("install.bat")
        self.assertIn(r"C:\Program Files\Scale Agent", install_bat)
        self.assertIn("ScaleAgent.exe", install_bat)

    def test_uninstall_script_targets_program_files(self):
        uninstall_bat = self._script("uninstall.bat")
        self.assertIn(r"C:\Program Files\Scale Agent", uninstall_bat)
        self.assertIn("ScaleAgent.exe", uninstall_bat)

    def test_no_broad_process_kill_commands(self):
        for name in ("install.bat", "uninstall.bat"):
            script = self._script(name)
            for line in script.splitlines():
                if "taskkill" in line.lower():
                    # Only the known Agent exe may be targeted, via the fixed
                    # %EXE_NAME% constant (defined as ScaleAgent.exe).
                    self.assertIn("%EXE_NAME%", line)
                    self.assertNotIn("python", line.lower())
                    self.assertNotIn("cmd", line.lower())
                    self.assertNotIn("*", line)

    def test_no_0_0_0_0_binding_introduced(self):
        for name in ("install.bat", "uninstall.bat"):
            self.assertNotIn("0.0.0.0", self._script(name))

    def test_install_script_checks_required_files_before_install(self):
        install_bat = self._script("install.bat")
        # The known file names are pinned as constants (%EXE_NAME%), so checks
        # reference those constants - verify both the definitions and the checks.
        self.assertIn('set "EXE_NAME=ScaleAgent.exe"', install_bat)
        self.assertIn('set "CFG_NAME=config.json"', install_bat)
        section = install_bat.split("echo Checking required files...")[1]
        section = section.split("echo   OK - required files present.")[0]
        self.assertIn("if not exist", section)
        self.assertIn("%EXE_NAME%", section)
        self.assertIn("%CFG_NAME%", section)
        # The check must happen before any copy/startup operation.
        self.assertLess(
            install_bat.index("echo Checking required files..."),
            install_bat.index("copy /Y"),
        )

    def test_install_script_requires_admin_without_escalation_tricks(self):
        install_bat = self._script("install.bat")
        self.assertIn("net session", install_bat)
        self.assertIn("Run as Administrator", install_bat)

    def test_no_broad_destructive_filesystem_commands(self):
        for name in ("install.bat", "uninstall.bat"):
            script = self._script(name)
            self.assertNotIn("rd /s", script)
            self.assertNotIn("rmdir", script)
            self.assertNotIn("del /S", script)
            self.assertNotIn("DEL /S", script)

    def test_readme_documents_installation(self):
        zf = zipfile.ZipFile(io.BytesIO(self._package()))
        readme = zf.read("ScaleAgent/README.txt").decode("utf-8")
        self.assertIn("install.bat", readme)
        self.assertIn("uninstall.bat", readme)
        self.assertIn(r"C:\Program Files\Scale Agent", readme)
        self.assertIn("http://127.0.0.1:8998/health", readme)

    def test_missing_exe_still_returns_clear_400(self):
        # Existing Phase 3 behavior must remain intact.
        with override_settings(SCALE_AGENT_EXE_PATH="__missing_exe__"):
            with self.assertRaises(DeploymentError) as ctx:
                build_deployment_zip([self.dev1], "http://erp:8000")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("not been built", str(ctx.exception))
