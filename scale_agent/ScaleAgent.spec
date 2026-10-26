# -*- mode: python ; coding: utf-8 -*-
#
# ScaleAgent.spec - PyInstaller build for Scale Agent v1.0.0
#
# Build (from the scale_agent/ directory):
#     pyinstaller ScaleAgent.spec --noconfirm --clean
#
# Output: single-file ScaleAgent.exe + external config.json
#
# ARCHITECTURE NOTES
# ------------------
# * onefile is used: the deployment model (Phase 3/4) is exactly one
#   ScaleAgent.exe next to an external, operator-editable config.json.
#   Onefile is appropriate here because there are no user-modifiable data
#   files that must persist between runs inside the bundle.
# * --windowed (no console): this is a system-tray application. Startup
#   errors are still captured to "%APPDATA%\Scale Agent\startup_error.log"
#   by scale_agent.main, and rotating logs go to the same directory.
# * config.json is intentionally NOT bundled (datas=[]). It is resolved at
#   runtime next to the real executable (scale_agent.config). Do not bundle
#   the repository's config.json - it contains local/dev server defaults.
# * Hidden imports below come from inspecting the actual Phase 2 code:
#     - serial            : dynamically imported inside SerialReader._open_serial
#     - pystray._win32    : the Windows backend pystray selects at runtime
#     - PIL.Image/Draw    : dynamically imported inside tray._create_icon_image
#     - requests/urllib3  : module-level imports in django_client (kept here so
#                           a spec change cannot silently drop a hard dependency)
# * No tkinter, numpy, matplotlib, or test code is used by the Agent.

import os

block_cipher = None

agent_root = os.path.abspath(SPECPATH)
project_root = os.path.dirname(agent_root)

a = Analysis(
    [os.path.join(agent_root, "main.py")],
    pathex=[project_root, agent_root],
    binaries=[],
    datas=[],
    hiddenimports=[
        "serial",
        "serial.tools",
        "serial.tools.list_ports",
        "pystray._win32",
        "PIL",
        "PIL.Image",
        "PIL.ImageDraw",
        "requests",
        "urllib3",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "scale_agent.tests",
        "tkinter",
        "numpy",
        "matplotlib",
        "pytest",
    ],
    noarchive=False,
    optimize=1,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="ScaleAgent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,                       # tray app: no permanent console
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    version=os.path.join(agent_root, "version_info.txt"),
)