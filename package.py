#!/usr/bin/env python3
"""Produce separate launcher module and standalone offline PWA distributions."""
import hashlib
import json
import shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parent
APP=ROOT/'dist/worldgen'
STANDALONE=ROOT/'dist/standalone'
FILES=['app.js','engine.js','compute-worker.js','styles.css']

def main():
    for name in FILES:
        if not (ROOT/'src'/name).is_file():raise FileNotFoundError(f'Missing src/{name}')
    for folder in (APP,STANDALONE):
        if folder.exists():shutil.rmtree(folder)
        folder.mkdir(parents=True)
    for name in FILES:
        shutil.copy2(ROOT/'src'/name,APP/name)
        shutil.copy2(ROOT/'src'/name,STANDALONE/name)
    for name in ['index.html','manifest.webmanifest','standalone-boot.js']:
        shutil.copy2(ROOT/name,STANDALONE/name)
    items=[p for p in sorted(STANDALONE.rglob('*')) if p.is_file()]
    digest=hashlib.sha256()
    for item in items:
        digest.update(item.relative_to(STANDALONE).as_posix().encode()+b'\0'+hashlib.sha256(item.read_bytes()).digest())
    ver=json.loads((ROOT/'package.json').read_text())['version']
    sw=(ROOT/'sw.template.js').read_text().replace('__CACHE__',f'worldgen-shell-v{ver}-{digest.hexdigest()[:16]}').replace('__ASSETS__',json.dumps(['./'+p.relative_to(STANDALONE).as_posix() for p in items]))
    (STANDALONE/'sw.js').write_text(sw)
    print('WorldGen launcher module: dist/worldgen')
    print('WorldGen standalone PWA: dist/standalone')
if __name__=='__main__':main()
