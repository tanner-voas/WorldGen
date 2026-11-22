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
            'terrain-3d.js', 'terrain-3d-worker.js', 'elevation-units.js', 'styles.css')
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
    items = [p for p in sorted(STANDALONE.rglob('*')) if p.is_file()]
    digest = hashlib.sha256()
    for item in items:
        digest.update(
            item.relative_to(STANDALONE).as_posix().encode()
            + b'\0' + hashlib.sha256(item.read_bytes()).digest()
        )
    ver = json.loads((ROOT / 'package.json').read_text())['version']
    assets = ['./' + p.relative_to(STANDALONE).as_posix() for p in items]
    sw = (ROOT / 'sw.template.js').read_text().replace(
        '__CACHE__', f'worldgen-shell-v{ver}-{digest.hexdigest()[:16]}'
    ).replace('__ASSETS__', json.dumps(assets))
    (STANDALONE / 'sw.js').write_text(sw)
    print('WorldGen launcher module: dist/worldgen')
    print('WorldGen standalone PWA: dist/standalone')


if __name__ == '__main__':
    main()
