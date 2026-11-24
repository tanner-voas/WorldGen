import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const read=(path)=>fs.readFileSync(new URL(path,root),'utf8');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const app='worldgen';

test('standalone and launcher package use the exact pinned updater and worker policy',()=>{
 execFileSync('python3',['package.py'],{cwd:fileURLToPath(root)});
 const version=JSON.parse(read('package.json')).version;
 const updater=read('shared/pwa-core/src/pwa-update.js');
 assert.equal(read(`dist/${app}/pwa-update.js`),updater);
 assert.equal(read('dist/standalone/pwa-update.js'),updater);
 const worker=read('dist/standalone/sw.js');
 const inventory=worker.match(/const ASSETS=(\[.*\]);/)[1];
 const assets=JSON.parse(inventory);
 assert.ok(assets.some(a=>a.path==='./index.html'));
 assert.ok(assets.some(a=>a.path==='./pwa-update.js'));
 assert.ok(assets.every(a=>a.groups.length===1&&a.groups[0]==='shell'));
 const dir=fileURLToPath(new URL('dist/standalone/',root));
 function files(folder){return fs.readdirSync(folder,{withFileTypes:true}).flatMap(d=>d.isDirectory()?files(path.join(folder,d.name)):[path.join(folder,d.name)]);}
 const expected=files(dir).map(f=>'./'+path.relative(dir,f)).filter(name=>name!=='./sw.js').sort();
 assert.deepEqual(assets.map(a=>a.path).sort(),expected);
 const template=read('shared/pwa-core/build/sw.template.js')
   .replace('__CACHE_PREFIXES__',JSON.stringify([`${app}-shell-`]))
   .replace('__EXCLUDED_PATH_PREFIXES__',JSON.stringify(['/_profiles/']));
 const cacheName=`${app}-shell-v${version}-${sha(inventory+template).slice(0,16)}`;
 assert.equal(worker,template.replace('__SHELL_CACHE_NAME__',cacheName).replace('__PRECACHE_ASSETS__',inventory));
 for(const a of assets){
  const bytes=fs.readFileSync(new URL(`dist/standalone/${a.path.slice(2)}`,root));
  assert.equal(a.size,bytes.length,a.path);assert.equal(a.sha256,sha(bytes),a.path);
 }
 assert.equal(read('dist/standalone/manifest.webmanifest'),read('manifest.webmanifest'));
 assert.equal(read('dist/standalone/standalone-boot.js'),read('standalone-boot.js'));
 assert.equal(fs.existsSync(new URL(`dist/${app}/sw.js`,root)),false);
 assert.equal(fs.existsSync(new URL(`dist/${app}/shared/pwa-core`,root)),false);
});
