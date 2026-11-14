# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
import os
import sys
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None
# SPECPATH là biến môi trường nội bộ của PyInstaller chứa đường dẫn thư mục spec file
backend_dir = Path(SPECPATH).resolve()

a = Analysis(
    ['run_server.py'],
    pathex=[str(backend_dir)],
    binaries=[],
    datas=[
        (str(backend_dir / 'prompts'), 'prompts'),
        (str(backend_dir / 'resources'), 'resources'),
        (str(backend_dir / 'app' / 'campaign' / 'prompt_defaults'), 'app/campaign/prompt_defaults'),
        (str(backend_dir / 'app' / 'campaign' / 'formats'), 'app/campaign/formats'),
    ],
    hiddenimports=collect_submodules('app') + [
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'sqlite3',
        'pydantic_settings',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='backend_server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
