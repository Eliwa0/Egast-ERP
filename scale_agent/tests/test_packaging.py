"""Phase 5 packaging-related unit tests.

Verifies build scaffolding and frozen-mode path behavior WITHOUT requiring
the actual PyInstaller build to have completed. These tests are fast and
deterministic, suitable for inclusion in the standard unittest suite.

Run from the project root (receipt_from_production/):
    python -m unittest discover -s scale_agent/tests -p "test_*.py"
"""

import importlib
import os
import sys
import tempfile
import unittest
from unittest import mock


class TestFrozenConfigPath(unittest.TestCase):
    """Ensure config.json is resolved next to the real executable (not the
    temporary extraction directory) when running as a PyInstaller onefile app."""

    def test_frozen_uses_executable_dir(self):
        import scale_agent.config as cfg

        fake_exe = r"C:\Program Files\Scale Agent\ScaleAgent.exe"
        expected = r"C:\Program Files\Scale Agent\config.json"

        with mock.patch.object(sys, "frozen", True, create=True), \
             mock.patch.object(sys, "executable", fake_exe):
            reloaded = importlib.reload(cfg)
        try:
            self.assertEqual(reloaded.DEFAULT_CONFIG_PATH, expected)
        finally:
            importlib.reload(cfg)  # restore original module state


class TestFrozenLoggingPath(unittest.TestCase):
    """Ensure logs go to a per-user writable AppData location when frozen."""

    def test_frozen_uses_appdata_for_logs(self):
        with tempfile.TemporaryDirectory() as fake_appdata:
            fake_exe = r"C:\Program Files\Scale Agent\ScaleAgent.exe"

            with mock.patch.object(sys, "frozen", True, create=True), \
                 mock.patch.object(sys, "executable", fake_exe), \
                 mock.patch.dict(os.environ, {"APPDATA": fake_appdata}):
                from scale_agent.logger import setup_logging
                log = setup_logging(log_level="INFO")

            # Close all handlers to release the log file before temp dir cleanup.
            for h in log.handlers[:]:
                h.close()
                log.removeHandler(h)

            log_dir = os.path.join(fake_appdata, "Scale Agent")
            self.assertTrue(
                os.path.isdir(log_dir),
                f"Log directory was not created: {log_dir}",
            )
            log_file = os.path.join(log_dir, "scale_agent.log")
            self.assertTrue(os.path.isfile(log_file), f"Log file missing: {log_file}")


class TestLoggerWindowedMode(unittest.TestCase):
    """The Agent builds with --windowed (no console). The logger must not
    crash when sys.stdout is None."""

    def test_setup_logging_survives_none_stdout(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(sys, "stdout", None):
                from scale_agent.logger import setup_logging
                log = setup_logging(log_level="INFO", log_dir=tmp)
                log.info("windowed-mode test message")
            for h in log.handlers[:]:
                h.close()
                log.removeHandler(h)
            log_file = os.path.join(tmp, "scale_agent.log")
            self.assertTrue(os.path.isfile(log_file))


class TestBuildScaffolding(unittest.TestCase):
    """Assert all required build files exist and are consistent."""

    def setUp(self):
        self.agent_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def _path(self, *parts):
        return os.path.join(self.agent_root, *parts)

    def test_spec_file_exists(self):
        self.assertTrue(os.path.isfile(self._path("ScaleAgent.spec")))

    def test_build_script_exists(self):
        self.assertTrue(os.path.isfile(self._path("build_exe.bat")))

    def test_verify_script_exists(self):
        self.assertTrue(os.path.isfile(self._path("verify_standalone.py")))

    def test_version_info_references_correct_exe_and_version(self):
        path = self._path("version_info.txt")
        self.assertTrue(os.path.isfile(path))
        content = open(path, encoding="utf-8").read()
        self.assertIn("ScaleAgent.exe", content)
        self.assertIn("1.0.1", content)
        self.assertIn("Mhosny Project", content)

    def test_requirements_has_all_runtime_deps(self):
        content = open(self._path("requirements.txt"), encoding="utf-8").read().lower()
        for pkg in ("pyserial", "pystray", "pillow", "requests"):
            self.assertIn(pkg, content, f"{pkg} missing from requirements.txt")

    def test_entry_point_is_callable(self):
        from scale_agent.main import main
        self.assertTrue(callable(main))


if __name__ == "__main__":
    unittest.main()
