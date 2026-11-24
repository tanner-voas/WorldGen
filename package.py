#!/usr/bin/env python3
"""Produce separate launcher-module and standalone offline PWA distributions.

Copy all application JS/CSS modules rather than maintaining a fragile list. Check
relative module references before creating the distributions, so a missing
import fails CI instead of failing after deployment in iOS Safari.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'src'
APP = ROOT / 'dist/worldgen'
STANDALONE = ROOT / 'dist/standalone'
REQUIRED = ('app.js', 'engine.js', 'spatial.js', 'compute-worker.js', 'terrain-sampler.js',
            'terrain-3d.js', 'terrain-3d-worker.js', 'terrain-pick-bounds.js', 'terrain-3d-outline.js', 'terrain-3d-morph.js', 'terrain-coastline.js', 'terrain-lakes.js', 'terrain-rivers.js', 'elevation-units.js', 'geographic-units.js', 'generation-constraints.js', 'styles.css')

CORE = ROOT / 'shared' / 'pwa-core'


def load_offline_core():
    # The caller initializes submodules explicitly (CI uses recursive checkout).
    # Never silently substitute another library revision or fetch browser code.
    if not (CORE / 'build/offline.py').is_file():
        raise FileNotFoundError('Missing PWA-Core; run git submodule update --init --recursive')
    if (ROOT / '.git').exists():
        status = subprocess.check_output(
            ['git', 'submodule', 'status', '--', 'shared/pwa-core'], cwd=ROOT, text=True)
        if not status.startswith(' '):
            raise RuntimeError('PWA-Core checkout does not match its pinned gitlink')
        if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'],
                                   cwd=CORE, text=True).strip():
            raise RuntimeError('PWA-Core contains uncommitted tracked changes')
    sys.path.insert(0, str(CORE / 'build'))
    from offline import asset_record, generate_worker
    return asset_record, generate_worker


# Match static imports, literal dynamic imports, and Worker URLs resolved using
# import.meta.url. They all refer to files that must exist in the distribution.
RELATIVE_MODULE = re.compile(
    r'''(?:\bfrom\s*|\bimport\s*\(\s*|\bnew\s+URL\s*\(\s*)[\"'](\.{1,2}/[^\"']+)[\"']'''
)


def application_files():
    for name in REQUIRED:
        if not (SOURCE / name).is_file():
            raise FileNotFoundError(f'Missing src/{name}')
    files = sorted(
        p for p in SOURCE.rglob('*')
        if p.is_file() and p.suffix in ('.js', '.css')
    )
    if not files:
        raise FileNotFoundError('No application modules found in src/')
    return files


def validate_module_references(root):
    """Fail packaging if a generated bundle has an unresolved local JS import."""
    for script in sorted(root.rglob('*.js')):
        for relative in RELATIVE_MODULE.findall(script.read_text()):
            destination = (script.parent / relative).resolve()
            if not destination.is_relative_to(root.resolve()) or not destination.is_file():
                raise FileNotFoundError(
                    f'Unresolved module {relative!r} referenced by '
                    f'{script.relative_to(root)}'
                )


def main():
    asset_record, generate_worker = load_offline_core()
    files = application_files()
    for folder in (APP, STANDALONE):
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True)
        for src in files:
            dest = folder / src.relative_to(SOURCE)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
        # Keep the deployed import URL unchanged; the source adapter is not shipped.
        shutil.copy2(CORE / 'src/pwa-update.js', folder / 'pwa-update.js')
    for name in ('index.html', 'manifest.webmanifest', 'standalone-boot.js'):
        shutil.copy2(ROOT / name, STANDALONE / name)
    shutil.copytree(ROOT / 'icons', STANDALONE / 'icons')

    validate_module_references(APP)
    validate_module_references(STANDALONE)

    # Every copied source module is automatically included in the standalone
    # service worker's cache list, including the terrain viewer and future additions.
    assets = [asset_record(STANDALONE, item, ['shell'])
              for item in sorted(STANDALONE.rglob('*')) if item.is_file()]
    ver = json.loads((ROOT / 'package.json').read_text())['version']
    _, worker, _ = generate_worker(assets, cache_prefix='worldgen-shell-', version=ver,
                                   excluded_path_prefixes=('/_profiles/',))
    (STANDALONE / 'sw.js').write_text(worker, encoding='utf-8')
    print('WorldGen launcher module: dist/worldgen')
    print('WorldGen standalone PWA: dist/standalone')


if __name__ == '__main__':
    main()
