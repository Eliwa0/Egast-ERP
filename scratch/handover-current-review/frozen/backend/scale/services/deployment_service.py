"""Scale Agent deployment package generation.

Responsible for:
  ScaleDevice records
        ↓
  Agent config dictionary
        ↓
  config.json
        ↓
  + ScaleAgent.exe + install.bat + uninstall.bat + README.txt
        ↓
  in-memory ZIP download

This service contains ZERO business workflow logic (no ScaleDraft, Quality,
GRPO or SAP). It is a pure deployment/packaging helper.
"""

import io
import json
import os
import re
import zipfile
import hashlib
import hmac
from pathlib import Path

from django.conf import settings

from ..models import ScaleDevice
from ..release import APPROVED_EXE_SHA256

# ── Agent configuration defaults ──────────────────────────────────────────────
# These are the Phase 2 Agent schema fields that do NOT exist on the Django
# ScaleDevice model. Sensible hardware defaults are used here instead of adding
# a migration. Documented per the Phase 3 requirements.

AGENT_GLOBAL_DEFAULTS = {
    "local_api_host": "127.0.0.1",   # Local Agent API - loopback only (security)
    "local_api_port": 8998,          # Local Agent API port
    "push_interval": 0.5,            # Min seconds between Django pushes
    "auth_token": "",                # Filled from server environment at build time
    "log_level": "INFO",
    "log_max_bytes": 5 * 1024 * 1024,
    "log_backup_count": 3,
}

AGENT_DEVICE_DEFAULTS = {
    "data_bits": 8,              # 8 data bits (most scale indicators)
    "stop_bits": 1,              # 1 stop bit
    "parity": "N",               # No parity
    "serial_timeout": 1.0,       # Seconds
    "poll_interval": 0.1,        # Seconds between COM reads
    "stable_sample_count": 3,    # Consecutive samples within delta => stable
    "stable_delta": 0.02,        # Kg tolerance for stable_sample_count
    "reconnect_delay": 5.0,      # Seconds between reconnect attempts
}

_SCALE_ID_SAFE_RE = re.compile(r"[^A-Za-z0-9_-]+")


class DeploymentError(Exception):
    """Raised for expected user/configuration errors (maps to 4xx responses)."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


# ── server_url resolution ─────────────────────────────────────────────────────

def get_configured_server_url() -> str:
    """Return the ERP URL the Agent must push readings to.

    Comes ONLY from Django settings (SCALE_AGENT_SERVER_URL env variable).
    Never guessed, never derived from the browser request, never localhost.
    """
    url = (getattr(settings, "SCALE_AGENT_SERVER_URL", "") or "").strip()
    if url:
        return url.rstrip("/")
    return ""


# ── Device selection ──────────────────────────────────────────────────────────

def get_deployable_devices(scale_id=None):
    """Return the ScaleDevice queryset eligible for agent deployment.

    Only ACTIVE, LOCAL (COM) devices are deployable - the Phase 2 Agent is a
    COM/serial hardware gateway. Virtual/dev-only and remote devices are excluded.
    """
    queryset = ScaleDevice.objects.filter(is_active=True, device_type="local")

    if scale_id:
        queryset = queryset.filter(device_id=scale_id)
        device = queryset.first()
        if device is None:
            # Distinguish "not found" from "exists but not deployable".
            existing = ScaleDevice.objects.filter(device_id=scale_id).first()
            if existing is None:
                raise DeploymentError(f"Scale '{scale_id}' was not found.", 404)
            if not existing.is_active:
                raise DeploymentError(f"Scale '{scale_id}' is inactive.", 400)
            raise DeploymentError(
                f"Scale '{scale_id}' is a '{existing.device_type}' device; "
                "only local (COM) devices can be deployed to the Agent.",
                400,
            )
        return [device]

    devices = list(queryset)
    if not devices:
        raise DeploymentError(
            "No active local (COM) scale devices are configured for deployment.",
            404,
        )
    return devices


# ── config.json generation ────────────────────────────────────────────────────

def _device_to_agent_config(device: ScaleDevice) -> dict:
    entry = {
        "device_id": device.device_id,
        "device_name": device.device_name or device.device_id,
        "device_type": "local",
    }
    entry["com_port"] = device.com_port if device.com_port else "AUTO"
    entry["baud_rate"] = device.baud_rate if device.baud_rate else "AUTO"
    entry.update(AGENT_DEVICE_DEFAULTS)
    return entry


def build_agent_config_json(devices, server_url: str) -> str:
    """Build the config.json payload (pretty-printed JSON string)."""
    config = dict(AGENT_GLOBAL_DEFAULTS)
    config["server_url"] = server_url.rstrip("/")
    config["auth_token"] = (
        getattr(settings, "SCALE_AGENT_AUTH_TOKEN", "") or ""
    ).strip()
    if not config['auth_token']:
        raise DeploymentError('SCALE_AGENT_AUTH_TOKEN is not configured. Configure the shared Agent credential before downloading.', 400)
    config["devices"] = [_device_to_agent_config(d) for d in devices]
    return json.dumps(config, indent=2, ensure_ascii=False)


# ── README.txt generation ─────────────────────────────────────────────────────

def build_readme(devices, server_url: str) -> str:
    lines = []
    lines.append("=" * 62)
    lines.append("Scale Agent - Deployment Package")
    lines.append("وكيل الميزان - حزمة التثبيت")
    lines.append("=" * 62)
    lines.append("")

    lines.append("WHAT IS THIS / ما هذا البرنامج؟")
    lines.append("-" * 62)
    lines.append("Scale Agent is a Windows hardware gateway that reads physical")
    lines.append("scale weights from COM/serial ports and forwards them to the")
    lines.append("ERP server over HTTP. It contains no business logic.")
    lines.append("وكيل الميزان برنامج صغير يعمل على جهاز ويندوز، يقرأ أوزان الميزان")
    lines.append("الفيزيائي من منفذ COM ويرسلها إلى خادم النظام (ERP).")
    lines.append("")

    lines.append("PACKAGE CONTENTS / محتويات الحزمة")
    lines.append("-" * 62)
    lines.append("  ScaleAgent.exe : the agent application (تطبيق الوكيل)")
    lines.append("  config.json    : agent configuration (إعدادات الوكيل)")
    lines.append("  install.bat    : one-click installer (برنامج التثبيت)")
    lines.append("  uninstall.bat  : uninstaller (برنامج الإلغاء)")
    lines.append("  README.txt     : this file (هذا الملف)")
    lines.append("")

    lines.append("INCLUDED SCALES / الأجهزة المضمنة")
    lines.append("-" * 62)
    for d in devices:
        port = d.com_port or "AUTO (auto-detect)"
        baud = d.baud_rate or "AUTO (auto-detect)"
        lines.append(f"  - {d.device_id} | {d.device_name or ''} | {port} @ {baud}")
    lines.append("")

    lines.append("INSTALLATION / التثبيت")
    lines.append("-" * 62)
    lines.append("1) Extract the ZIP on the Windows PC that is physically")
    lines.append("   connected to the scale's COM port.")
    lines.append("2) Right-click install.bat and select \"Run as Administrator\".")
    lines.append("3) Wait for the installation confirmation message.")
    lines.append("4) The Agent is installed to:")
    lines.append("      C:\\Program Files\\Scale Agent\\")
    lines.append("   and is registered to start automatically with Windows.")
    lines.append("")
    lines.append("UNINSTALLATION / إلغاء التثبيت")
    lines.append("-" * 62)
    lines.append("Run the following as Administrator:")
    lines.append("      C:\\Program Files\\Scale Agent\\uninstall.bat")
    lines.append("Only files created by the installer are removed.")
    lines.append("")

    lines.append("AGENT LOCATION / موقع البرنامج")
    lines.append("-" * 62)
    lines.append("      C:\\Program Files\\Scale Agent\\")
    lines.append("")

    lines.append("LOCAL API / الواجهة المحلية")
    lines.append("-" * 62)
    lines.append("      http://127.0.0.1:8998")
    lines.append("")

    lines.append("HEALTH / فحص الصحة")
    lines.append("-" * 62)
    lines.append("      http://127.0.0.1:8998/health")
    lines.append("   Should return {\"status\": \"ok\"}.")
    lines.append("")

    lines.append("SERVER URL / عنوان الخادم")
    lines.append("-" * 62)
    lines.append(f"  {server_url}")
    lines.append("  The Agent pushes readings to this address every few seconds.")
    lines.append("  Make sure this PC can reach it (firewall / LAN).")
    lines.append("")

    lines.append("IMPORTANT / مهم")
    lines.append("-" * 62)
    lines.append("The Agent must be installed on the Windows PC physically")
    lines.append("connected to the scale's COM port. It cannot read a scale that")
    lines.append("is connected to another computer.")
    lines.append("")

    lines.append("SECURITY NOTES / ملاحظات الأمان")
    lines.append("-" * 62)
    lines.append("* The Agent local API binds to 127.0.0.1 ONLY - do not change")
    lines.append("  local_api_host to 0.0.0.0.")
    lines.append("* Weight pushes use the private auth_token in config.json.")
    lines.append("  Keep config.json restricted to the Scale Agent PC and never log")
    lines.append("  or share its token.")
    lines.append("")

    lines.append("LOGS / السجلات")
    lines.append("-" * 62)
    lines.append("The agent writes rotating logs (scale_agent.log) next to itself.")
    lines.append("")
    return "\n".join(lines)


# ── Windows installer / uninstaller scripts ───────────────────────────────────
# Static, safe Phase 4 scripts shipped inside every deployment ZIP. They are
# kept as pure-ASCII strings (cmd.exe codepage friendly) and normalized to CRLF
# line endings on write so cmd.exe executes them reliably.

INSTALL_BAT = r"""@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Scale Agent Installer

set "APP_NAME=Scale Agent"
set "INSTALL_DIR=C:\Program Files\Scale Agent"
set "EXE_NAME=ScaleAgent.exe"
set "CFG_NAME=config.json"
set "STARTUP_RUN_KEY=HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
set "STARTUP_VALUE_NAME=ScaleAgent"
set "HEALTH_URL=http://127.0.0.1:8998/health"
set /a HEALTH_ATTEMPTS=20

echo ====================================
echo  %APP_NAME% Installer
echo ====================================
echo.

rem ── A. Require Administrator (no unsafe elevation tricks) ──
echo Checking administrator privileges...
net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Administrator privileges are required.
    echo Right-click %~nx0 and select "Run as Administrator".
    echo Installation aborted - nothing was changed.
    exit /b 1
)
echo   OK - administrator privileges confirmed.

rem ── B. This script's own directory (ZIP folder may contain spaces) ──
set "SOURCE_DIR=%~dp0"

rem ── C. Validate required files before touching the system ──
echo Checking required files...
if not exist "%SOURCE_DIR%%EXE_NAME%" (
    echo.
    echo ERROR: %EXE_NAME% was not found next to install.bat.
    echo Extract the ZIP completely, then run install.bat from inside it.
    exit /b 1
)
if not exist "%SOURCE_DIR%%CFG_NAME%" (
    echo.
    echo ERROR: %CFG_NAME% was not found next to install.bat.
    echo Extract the ZIP completely, then run install.bat from inside it.
    exit /b 1
)
echo   OK - required files present.

rem ── D. Stop any existing Agent (targeted: %EXE_NAME% only) ──
echo Stopping any previous Agent...
tasklist /FI "IMAGENAME eq %EXE_NAME%" | find /I "%EXE_NAME%" >nul
if not errorlevel 1 (
    echo   Old Agent process found - stopping it gracefully...
    taskkill /IM %EXE_NAME% >nul 2>&1
    timeout /t 3 /nobreak >nul
    tasklist /FI "IMAGENAME eq %EXE_NAME%" | find /I "%EXE_NAME%" >nul
    if not errorlevel 1 (
        echo   Process did not stop - forcing termination...
        taskkill /IM %EXE_NAME% /F >nul 2>&1
        timeout /t 2 /nobreak >nul
        tasklist /FI "IMAGENAME eq %EXE_NAME%" | find /I "%EXE_NAME%" >nul
        if not errorlevel 1 (
            echo.
            echo ERROR: Could not stop the previous %EXE_NAME% process.
            echo Installation aborted to protect the existing installation.
            exit /b 1
        )
    )
    echo   Previous Agent stopped.
) else (
    echo   No running Agent detected - nothing to stop.
)

rem ── E. Create installation directory ──
echo Installing files...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%" (
    echo.
    echo ERROR: Could not create "%INSTALL_DIR%".
    exit /b 1
)

rem ── F. Copy files ──
rem install.bat itself is deliberately NOT copied: the extracted ZIP folder is
rem the installation medium. uninstall.bat IS copied so users can run it from
rem the install directory later.
copy /Y "%SOURCE_DIR%%EXE_NAME%" "%INSTALL_DIR%\%EXE_NAME%" >nul
if errorlevel 1 (
    echo ERROR: Failed to copy %EXE_NAME%.
    exit /b 1
)

rem Config preservation policy (Django ERP is the source of truth):
rem   - fresh install : install the generated config.json from the ZIP
rem   - existing copy : previous config is preserved as config.json.bak
rem   - every deploy ships an explicit new configuration
if exist "%INSTALL_DIR%\%CFG_NAME%" (
    copy /Y "%INSTALL_DIR%\%CFG_NAME%" "%INSTALL_DIR%\%CFG_NAME%.bak" >nul 2>&1
    echo   Previous config preserved as %CFG_NAME%.bak
)
copy /Y "%SOURCE_DIR%%CFG_NAME%" "%INSTALL_DIR%\%CFG_NAME%" >nul
if errorlevel 1 (
    echo ERROR: Failed to copy %CFG_NAME%.
    exit /b 1
)

copy /Y "%SOURCE_DIR%uninstall.bat" "%INSTALL_DIR%\uninstall.bat" >nul
if errorlevel 1 (
    echo ERROR: Failed to copy uninstall.bat.
    exit /b 1
)

if exist "%SOURCE_DIR%README.txt" (
    copy /Y "%SOURCE_DIR%README.txt" "%INSTALL_DIR%\README.txt" >nul
)
echo   Files copied to "%INSTALL_DIR%".

rem ── G. Windows startup (machine-wide via HKLM Run key) ──
echo Configuring Windows startup...
reg add "%STARTUP_RUN_KEY%" /v "%STARTUP_VALUE_NAME%" /t REG_SZ /d "\"%INSTALL_DIR%\%EXE_NAME%\"" /f >nul
if errorlevel 1 (
    echo ERROR: Failed to register the startup entry.
    exit /b 1
)
echo   Startup entry registered in %STARTUP_RUN_KEY% (machine-wide, every login).

rem ── H. Start Menu shortcut (Common Start Menu, all users) ──
echo Creating Start Menu shortcut...
powershell -NoProfile -Command "$sm=[Environment]::GetFolderPath('CommonStartMenu'); if($sm){$lnk=Join-Path $sm 'Programs\Scale Agent.lnk'; $ws=New-Object -ComObject WScript.Shell; $sc=$ws.CreateShortcut($lnk); $sc.TargetPath='%INSTALL_DIR%\%EXE_NAME%'; $sc.WorkingDirectory='%INSTALL_DIR%'; $sc.Description='Scale Agent'; $sc.Save()}" >nul 2>&1
echo   Start Menu shortcut set.
rem Note: no external utilities are downloaded or installed for shortcuts.

rem ── I. Start the Agent (only after every step above succeeded) ──
echo Starting Agent...
start "" "%INSTALL_DIR%\%EXE_NAME%"

rem ── J. Health check (best effort - never fails the install) ──
echo Checking Agent health at %HEALTH_URL%...
set /a attempt=0
:health_loop
powershell -NoProfile -Command "try { $null=Invoke-WebRequest -UseBasicParsing -Uri '%HEALTH_URL%' -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto health_ok
set /a attempt+=1
if %attempt% geq %HEALTH_ATTEMPTS% goto health_timeout
timeout /t 1 /nobreak >nul
goto health_loop

:health_ok
echo   Agent started successfully.
goto finish

:health_timeout
echo   Agent installed, but health check did not respond yet.
echo   This is not fatal - the Agent may still be starting up.
echo   Check it later at: %HEALTH_URL%

:finish
echo.
echo ====================================
echo  Installation completed.
echo ====================================
echo  Agent location : %INSTALL_DIR%
echo  Local API      : http://127.0.0.1:8998
echo  Health         : %HEALTH_URL%
echo.
endlocal
exit /b 0
"""


UNINSTALL_BAT = r"""@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Scale Agent Uninstaller

set "APP_NAME=Scale Agent"
set "INSTALL_DIR=C:\Program Files\Scale Agent"
set "EXE_NAME=ScaleAgent.exe"
set "STARTUP_RUN_KEY=HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
set "STARTUP_VALUE_NAME=ScaleAgent"

echo ====================================
echo  %APP_NAME% Uninstaller
echo ====================================
echo.

rem ── Require Administrator ──
echo Checking administrator privileges...
net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Administrator privileges are required.
    echo Right-click %~nx0 and select "Run as Administrator".
    echo Uninstallation aborted.
    exit /b 1
)
echo   OK - administrator privileges confirmed.

rem ── Stop the Agent (targeted: %EXE_NAME% only) ──
echo Stopping %APP_NAME%...
tasklist /FI "IMAGENAME eq %EXE_NAME%" | find /I "%EXE_NAME%" >nul
if not errorlevel 1 (
    taskkill /IM %EXE_NAME% >nul 2>&1
    timeout /t 3 /nobreak >nul
    tasklist /FI "IMAGENAME eq %EXE_NAME%" | find /I "%EXE_NAME%" >nul
    if not errorlevel 1 (
        echo   Process did not stop - forcing termination...
        taskkill /IM %EXE_NAME% /F >nul 2>&1
        timeout /t 2 /nobreak >nul
    )
    echo   Agent stopped.
) else (
    echo   Agent is not running.
)

rem ── Remove startup entry ──
echo Removing Windows startup entry...
reg delete "%STARTUP_RUN_KEY%" /v "%STARTUP_VALUE_NAME%" /f >nul 2>&1
echo   Startup entry removed (if present).

rem ── Remove shortcuts created by the installer ──
echo Removing shortcuts...
powershell -NoProfile -Command "Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('CommonStartMenu')) 'Programs\Scale Agent.lnk') -Force -ErrorAction SilentlyContinue" >nul 2>&1
echo   Shortcuts removed (if present).

rem ── Remove installed files ONLY (user/diagnostic files are preserved) ──
echo Removing installed files...
if exist "%INSTALL_DIR%\%EXE_NAME%" del /Q "%INSTALL_DIR%\%EXE_NAME%"
if exist "%INSTALL_DIR%\config.json" del /Q "%INSTALL_DIR%\config.json"
if exist "%INSTALL_DIR%\README.txt" del /Q "%INSTALL_DIR%\README.txt"
if exist "%INSTALL_DIR%\uninstall.bat" del /Q "%INSTALL_DIR%\uninstall.bat"
echo   Installed files removed.

rem ── Remove the installation directory only if it is now empty ──
rem User files (logs, backups, diagnostics) are never deleted; if any remain
rem the directory is intentionally kept.
rd "%INSTALL_DIR%" 2>nul
if not exist "%INSTALL_DIR%" (
    echo   Installation directory removed.
) else (
    echo   NOTE: "%INSTALL_DIR%" still contains other files and was kept.
    echo   Remove it manually only if you are sure those files are no longer needed.
)

echo.
echo ====================================
echo  Uninstallation completed.
echo ====================================
echo.
endlocal
exit /b 0
"""


def _to_crlf(text: str) -> str:
    """Normalize batch content to CRLF line endings for reliable cmd.exe."""
    return text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\r\n")


# ── EXE lookup ────────────────────────────────────────────────────────────────

def resolve_agent_exe_path() -> str:
    raw = (getattr(settings, "SCALE_AGENT_EXE_PATH", "") or "").strip()
    return os.path.abspath(raw)


# ── ZIP packaging ─────────────────────────────────────────────────────────────

def _sanitize_scale_id(scale_id) -> str:
    cleaned = _SCALE_ID_SAFE_RE.sub("", scale_id or "").strip("_-")
    return cleaned or "Scale"


def build_deployment_zip(devices, server_url: str) -> (bytes, str):
    """Create the in-memory ZIP package.

    Returns (zip_bytes, safe_filename). Raises DeploymentError if the Agent
    executable does not actually exist - never faked.
    """
    exe_path = resolve_agent_exe_path()
    if not exe_path or not os.path.isfile(exe_path):
        raise DeploymentError(
            "The Scale Agent executable (ScaleAgent.exe) has not been built yet. "
            "Build it with PyInstaller and set SCALE_AGENT_EXE_PATH to the "
            "generated executable path, then retry.",
            400,
        )

    # Verify the same bytes that will be packaged, closing a verify/read race.
    try:
        exe_bytes = Path(exe_path).read_bytes()
    except OSError as exc:
        raise DeploymentError('The approved Scale Agent executable cannot be read.', 503) from exc
    expected = str(getattr(settings, 'SCALE_AGENT_APPROVED_SHA256', APPROVED_EXE_SHA256)).upper()
    actual = hashlib.sha256(exe_bytes).hexdigest().upper()
    if not re.fullmatch(r'[A-F0-9]{64}', expected) or not hmac.compare_digest(actual, expected) or not exe_bytes.startswith(b'MZ'):
        raise DeploymentError('Scale Agent integrity verification failed; an approved executable is required.', 503)

    config_json = build_agent_config_json(devices, server_url)
    readme = build_readme(devices, server_url)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("ScaleAgent/config.json", config_json)
        zf.writestr("ScaleAgent/README.txt", _to_crlf(readme))
        zf.writestr("ScaleAgent/install.bat", _to_crlf(INSTALL_BAT))
        zf.writestr("ScaleAgent/uninstall.bat", _to_crlf(UNINSTALL_BAT))
        zf.writestr("ScaleAgent/ScaleAgent.exe", exe_bytes)

    zip_bytes = buffer.getvalue()

    if len(devices) == 1:
        filename = f"ScaleAgent_{_sanitize_scale_id(devices[0].device_id)}_Deployment.zip"
    else:
        filename = "ScaleAgent_Deployment.zip"

    return zip_bytes, filename


def create_deployment(scale_id=None) -> (bytes, str):
    """High-level entry used by the deploy view."""
    server_url = get_configured_server_url()
    if not server_url:
        raise DeploymentError(
            "SCALE_AGENT_SERVER_URL is not configured on the server. "
            "Set this environment variable to the ERP address reachable from "
            "the Scale Agent PC (e.g. http://192.168.1.10:8000) and retry.",
            400,
        )

    devices = get_deployable_devices(scale_id=scale_id)
    return build_deployment_zip(devices, server_url)
