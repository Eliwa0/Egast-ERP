"""Standalone runtime verification for the built ScaleAgent.exe (Phase 5).

Usage (after a successful `build_exe.bat`):

    python verify_standalone.py

NOT a pytest: this harness launches the real EXE as a subprocess, binds the
real 127.0.0.1:8998 socket and requires dist/ScaleAgent.exe. It is the Phase 5
runtime verification for:

    Test 1 - EXE exists
    Test 2 - starts standalone (no python invoked)
    Test 3 - loads external config.json next to the EXE
    Test 4 - local API /health responds
    Test 5 - /status and /scales work
    Test 6 - invalid COM port handled safely (no crash, API stays up)

Exit codes: 0 = all checks passed, 1 = one or more checks failed,
            2 = EXE not found / misconfigured.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

APP_DIR = os.path.dirname(os.path.abspath(__file__))
EXE_PATH = os.path.join(APP_DIR, "dist", "current", "ScaleAgent.exe")
BASE_URL = "http://127.0.0.1:8998"

# Deliberately invalid COM port + an unreachable ERP: the Agent must start,
# serve its HTTP API, and report the scale as error/disconnected without
# crashing - and it must keep retrying without blocking the API.
CONFIG_TEMPLATE = {
    "server_url": "http://127.0.0.1:8000",
    "local_api_host": "127.0.0.1",
    "local_api_port": 8998,
    "push_interval": 0.5,
    "auth_token": "",
    "log_level": "INFO",
    "log_max_bytes": 5242880,
    "log_backup_count": 3,
    "devices": [
        {
            "device_id": "SCALE-01",
            "device_name": "Standalone Test Scale",
            "device_type": "local",
            "com_port": "COM999",
            "baud_rate": 9600,
            "data_bits": 8,
            "stop_bits": 1,
            "parity": "N",
            "serial_timeout": 0.5,
            "poll_interval": 0.1,
            "stable_sample_count": 3,
            "stable_delta": 0.02,
            "reconnect_delay": 5.0,
        }
    ],
}

_results = []


def check(name, ok, detail=""):
    _results.append((name, bool(ok)))
    line = f"[{'PASS' if ok else 'FAIL'}] {name}"
    if detail:
        line += f" - {detail}"
    print(line)


def http_json(path, timeout=3):
    with urllib.request.urlopen(BASE_URL + path, timeout=timeout) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def _kill_process_tree(proc, exe_path):
    # PyInstaller onefile uses a launcher parent + app child; terminate() only
    # kills the parent, leaving the child running and locking the EXE file.
    # Kill the whole tree, then sweep any orphan whose executable is exe_path.
    try:
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            capture_output=True, timeout=10,
        )
    except Exception:
        pass
    ps_cmd = (
        "Get-CimInstance Win32_Process | "
        "Where-Object { $_.ExecutablePath -eq $args[0] } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )
    try:
        subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", ps_cmd, exe_path],
            capture_output=True, timeout=15,
        )
    except Exception:
        pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def _drain_startup_error_log():
    log_dir = os.path.join(os.environ.get("APPDATA", ""), "Scale Agent")
    err_log = os.path.join(log_dir, "startup_error.log")
    if os.path.isfile(err_log):
        print("--- startup_error.log (tail) ---")
        with open(err_log, encoding="utf-8") as f:
            lines = f.read().splitlines()
        print("\n".join(lines[-40:]))


def main():
    if not os.path.isfile(EXE_PATH):
        print(f"ERROR: {EXE_PATH} not found. Run build_exe.bat first.")
        return 2

    with tempfile.TemporaryDirectory(prefix="scale_agent_verify_") as tmp:
        # Simulate the installed layout: EXE + config.json beside each other.
        app_dir = os.path.join(tmp, "app")
        os.makedirs(app_dir, exist_ok=True)
        exe_copy = os.path.join(app_dir, "ScaleAgent.exe")
        with open(os.path.join(app_dir, "config.json"), "w", encoding="utf-8") as f:
            json.dump(CONFIG_TEMPLATE, f, indent=2)
        shutil.copy2(EXE_PATH, exe_copy)

        # Launch from an UNRELATED working directory (must not assume cwd).
        proc = subprocess.Popen([exe_copy], cwd=tmp)
        try:
            healthy = False
            for _ in range(40):
                try:
                    status, health = http_json("/health", timeout=1)
                    if status == 200:
                        healthy = True
                        break
                except Exception:
                    time.sleep(0.5)

            check("Test 2: EXE starts standalone", proc.poll() is None,
                  "process exited early" if proc.poll() is not None else "running")
            check("Test 4: /health responds on 127.0.0.1:8998", healthy)

            if not healthy:
                _drain_startup_error_log()
                proc.terminate()
                return 1

            check("Test 4: /health status=ok", health.get("status") == "ok",
                  json.dumps(health))

            _, status_data = http_json("/status")
            check("Test 5: /status returns agent info",
                  status_data.get("status") == "ok" and "scales_count" in status_data)
            check("Test 3: external config applied (server_url + device)",
                  status_data.get("server_url") == CONFIG_TEMPLATE["server_url"]
                  and status_data.get("scales_count") == 1,
                  f"server_url={status_data.get('server_url')}, "
                  f"scales_count={status_data.get('scales_count')}")

            _, scales = http_json("/scales")
            scale_map = scales.get("scales", {})
            scale01 = scale_map.get("SCALE-01")
            check("Test 5: /scales lists the configured scale",
                  len(scale_map) == 1
                  and isinstance(scale01, dict)
                  and scale01.get("device_id") == "SCALE-01")

            # Test 6: invalid COM - the scale must report a failed connection
            # and the HTTP API must remain available.
            if isinstance(scale01, dict):
                conn = scale01.get("connection_status")
                check("Test 6: invalid COM reported (error/disconnected/connecting)",
                      conn in ("error", "disconnected", "connecting"), f"connection_status={conn}")

            time.sleep(3)
            try:
                status, _ = http_json("/health", timeout=2)
                check("Test 6: API alive after invalid-COM retries", status == 200)
            except Exception as exc:
                check("Test 6: API alive after invalid-COM retries", False, str(exc))
        finally:
            _kill_process_tree(proc, exe_copy)

    passed = sum(1 for _, ok in _results if ok)
    failed = len(_results) - passed
    print()
    print(f"Verified {len(_results)} checks: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
