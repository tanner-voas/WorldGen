#!/usr/bin/env python3
"""Produce separate launcher-module and standalone offline PWA distributions.

Copy all application JS/CSS modules rather than maintaining a fragile list. Check
relative module references before creating the distributions, so a missing
import fails CI instead of failing after deployment in iOS Safari.
"""
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'src'
APP = ROOT / 'dist/worldgen'
STANDALONE = ROOT / 'dist/standalone'
REQUIRED = ('app.js', 'engine.js', 'spatial.js', 'compute-worker.js', 'terrain-sampler.js',
            'terrain-3d.js', 'terrain-3d-worker.js', 'terrain-pick-bounds.js', 'terrain-3d-outline.js', 'terrain-3d-morph.js', 'terrain-coastline.js', 'terrain-lakes.js', 'terrain-rivers.js', 'elevation-units.js', 'geographic-units.js', 'generation-constraints.js', 'styles.css')
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
    files = application_files()
    for folder in (APP, STANDALONE):
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True)
        for src in files:
            dest = folder / src.relative_to(SOURCE)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
    for name in ('index.html', 'manifest.webmanifest', 'standalone-boot.js'):
        shutil.copy2(ROOT / name, STANDALONE / name)
    shutil.copytree(ROOT / 'icons', STANDALONE / 'icons')

    validate_module_references(APP)
    validate_module_references(STANDALONE)

    # Every copied source module is automatically included in the standalone
    # service worker's cache list, including the terrain viewer and future additions.
    assets = []
    for item in sorted(STANDALONE.rglob('*')):
        if not item.is_file(): continue
        data = item.read_bytes()
        assets.append(dict(path='./'+item.relative_to(STANDALONE).as_posix(),size=len(data),sha256=hashlib.sha256(data).hexdigest(),groups=['shell']))
    inventory = json.dumps(assets, separators=(',', ':'))
    template = (ROOT / 'sw.template.js').read_text()
    digest = hashlib.sha256(inventory.encode()+template.encode())
    ver = json.loads((ROOT / 'package.json').read_text())['version']
    sw = template.replace('__SHELL_CACHE_NAME__', f'worldgen-shell-v{ver}-{digest.hexdigest()[:16]}').replace('__PRECACHE_ASSETS__', inventory)
    (STANDALONE / 'sw.js').write_text(sw)
    print('WorldGen launcher module: dist/worldgen')
    print('WorldGen standalone PWA: dist/standalone')


if __name__ == '__main__':
    main()
