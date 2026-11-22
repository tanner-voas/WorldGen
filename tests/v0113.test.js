import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const required=['app.js','engine.js','spatial.js','compute-worker.js','terrain-sampler.js','terrain-3d.js','terrain-3d-worker.js','styles.css'];
const relativeImport=/(?:\bfrom\s*|\bimport\s*\(\s*|\bnew\s+URL\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;

test('v0.1.13 bundles every JS dependency into launcher and standalone outputs',()=>{
 execFileSync('python3',['package.py'],{cwd:root});
 for(const dest of ['dist/worldgen','dist/standalone']){
  for(const retired of ['raster.js','raster-worker.js','render.js'])assert.equal(existsSync(join(root,dest,retired)),false,`${dest}/${retired} must not be shipped`);
  for(const name of required)assert.ok(existsSync(join(root,dest,name)),`${dest}/${name} was omitted`);
  for(const name of required.filter(n=>n.endsWith('.js'))){
   const path=join(root,dest,name),source=readFileSync(path,'utf8');
   for(const match of source.matchAll(relativeImport)){
    const child=resolve(dirname(path),match[1]);
    assert.ok(existsSync(child),`${relative(root,path)} imports missing ${match[1]}`);
   }
  }
 }
 const sw=readFileSync(join(root,'dist/standalone/sw.js'),'utf8');
 assert.match(sw,/"\.\/terrain-sampler\.js"/);
 assert.match(sw,/"\.\/terrain-3d-worker\.js"/);
 assert.doesNotMatch(sw,/"\.\/(?:raster(?:-worker)?|render)\.js"/);
 assert.match(readFileSync(join(root,'dist/worldgen/app.js'),'utf8'),/WorldGen v|0\.1\.13/);
});

test('packager rejects a broken JS import instead of silently producing a broken app',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'worldgen-verify-'));
 try{
  writeFileSync(join(tmp,'app.js'),"import './nonexistent-module.js';\n");
  assert.throws(()=>execFileSync('python3',['-c',
   `import importlib.util,sys; spec=importlib.util.spec_from_file_location('wg_package','${join(root,'package.py')}'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); m.validate_module_references(sys.argv[1])`,tmp],{cwd:root,stdio:'pipe'}),/Unresolved module|subprocess failed|Command failed/);
 }finally{rmSync(tmp,{recursive:true,force:true});}
});
