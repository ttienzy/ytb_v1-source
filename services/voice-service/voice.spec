# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
import os
import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

block_cipher = None
service_dir = Path(SPECPATH).resolve()

a = Analysis(
    ['run_server.py'],
    pathex=[str(service_dir)],
    binaries=[],
    # Runtime voices/model cache live under APP_DATA_DIR and must never be baked
    # into a release. Built-in preset assets and sea_g2p binary dictionary belong in the EXE.
    datas=(
        collect_data_files('vieneu', includes=['assets/**/*'])
        + collect_data_files('sea_g2p')
        + copy_metadata('vieneu')
    ),
    hiddenimports=(
        collect_submodules('sea_g2p')
        + collect_submodules('vieneu_utils')
        + collect_submodules('cpuinfo')
        + [
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
            'app',
            'app.main',
            'app.engine',
            'app.routers',
            'app.routers.health',
            'app.routers.voices',
            'app.routers.tts',
            'pydantic_settings',
            'vieneu',
            'vieneu.v3turbo',
            'vieneu.v3nano',
            'onnxruntime',
            'huggingface_hub',
        ]
    ),
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
    name='voice_server',
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
