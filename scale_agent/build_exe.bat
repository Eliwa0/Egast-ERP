@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Scale Agent Build

rem ─────────────────────────────────────────────────────────────
rem  ScaleAgent build script (PyInstaller)
rem  Output : dist\ScaleAgent.exe  (single-file EXE)
rem  Config remains external: config.json next to the EXE.
rem ─────────────────────────────────────────────────────────────

set "AGENT_DIR=%~dp0"
set "SPEC=%AGENT_DIR%ScaleAgent.spec"
set "WORK_DIR=%AGENT_DIR%build"
set "DIST_DIR=%AGENT_DIR%dist\current"
set "EXE_PATH=%DIST_DIR%\ScaleAgent.exe"

echo ====================================
echo  Scale Agent - PyInstaller Build
echo ====================================
echo.

rem ── [1/6] Python check ──
echo [1/6] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Python was not found. Install Python and ensure it is in PATH.
    exit /b 1
)
for /f "delims=" %%v in ('python --version 2^>^&1') do set "PY_VERSION=%%v"
echo   OK - %PY_VERSION%

rem ── [2/6] PyInstaller check ──
echo [2/6] Checking PyInstaller...
python -m PyInstaller --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: PyInstaller is not installed. Run:
    echo        python -m pip install pyinstaller
    exit /b 1
)
for /f "delims=" %%v in ('python -m PyInstaller --version 2^>^&1') do set "PI_VERSION=%%v"
echo   OK - PyInstaller %PI_VERSION%

rem ── [3/6] Clean previous PyInstaller artifacts (only scale_agent dirs) ──
echo [3/6] Cleaning previous build artifacts...
if exist "%WORK_DIR%" rmdir /s /q "%WORK_DIR%"
rem Preserve deployed config.json and package files; PyInstaller replaces the EXE.
echo   OK - cleaned "%WORK_DIR%", deployment configuration preserved.

rem ── [4/6] Build ──
echo [4/6] Building ScaleAgent.exe - this can take a few minutes...
pushd "%AGENT_DIR%"
python -m PyInstaller "%SPEC%" --noconfirm --clean --workpath "%WORK_DIR%" --distpath "%DIST_DIR%"
set "BUILD_RC=%ERRORLEVEL%"
popd
if not "%BUILD_RC%"=="0" (
    echo.
    echo ERROR: PyInstaller build failed ^(exit code %BUILD_RC%^).
    exit /b 1
)
echo   OK - PyInstaller completed.

rem ── [5/6] Verify executable exists ──
echo [5/6] Verifying output executable...
if not exist "%EXE_PATH%" (
    echo.
    echo ERROR: Expected executable was not found: "%EXE_PATH%"
    exit /b 1
)
echo   OK - "%EXE_PATH%" exists.

rem ── [6/6] Report ──
echo [6/6] Build complete.
echo.
echo ====================================
echo  Scale Agent build succeeded
echo ====================================
echo  Python      : %PY_VERSION%
echo  PyInstaller : %PI_VERSION%
echo  EXE path    : %EXE_PATH%
for %%F in ("%EXE_PATH%") do echo  EXE size    : %%~zF bytes
echo  Config file : external config.json (placed next to the EXE)
echo.
endlocal
exit /b 0
