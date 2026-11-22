import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const start=source.indexOf('function consoleBounds(){');
const end=source.indexOf('function bindDrawerDrag(){',start);
assert.ok(start>=0&&end>start,'drawer layout functions must be present');
const layoutFunctions=source.slice(start,end);

function layoutAt({viewport,header,ratio=.36,exploreMode=false}){
 const properties=new Map(),classes=new Map();
 const shell={style:{setProperty:(name,value)=>properties.set(name,value)},classList:{toggle:(name,value)=>classes.set(name,value)}};
 const root={clientHeight:viewport,querySelector(selector){
  if(selector==='#worldgen-root')return shell;
  if(selector==='.wg-header')return {getBoundingClientRect:()=>({height:header})};
  throw Error(`Unexpected selector: ${selector}`);
 }};
 const context={root,innerHeight:viewport,workspace:{consoleHeightRatio:ratio,exploreMode},clamp:(v,min,max)=>Math.max(min,Math.min(max,v))};
 vm.runInNewContext(`${layoutFunctions}\napplyConsoleHeight();`,context);
 return {properties,classes};
}

test('v0.2.4 map layout can calculate the header in both standalone and launcher-style shells',()=>{
 const tall=layoutAt({viewport:844,header:63});
 assert.equal(tall.properties.get('--wg-console-height'),'304px');
 assert.equal(tall.classes.get('wg-map-short'),false);
 assert.equal(tall.classes.get('wg-map-compact'),false);

 const small=layoutAt({viewport:430,header:63});
 assert.equal(small.classes.get('wg-map-short'),true);
 assert.equal(small.classes.get('wg-map-compact'),true);

 const collapsed=layoutAt({viewport:430,header:63,exploreMode:true});
 assert.equal(collapsed.classes.get('wg-map-short'),false);
 assert.equal(collapsed.classes.get('wg-map-compact'),false);

 const safeArea=layoutAt({viewport:800,header:105,ratio:.35});
 assert.equal(safeArea.properties.get('--wg-console-height'),'280px');
 assert.equal(safeArea.classes.get('wg-map-short'),false);
 assert.equal(safeArea.classes.get('wg-map-compact'),false);
});

test('v0.2.4 keeps v0.2.3 world storage and labels this release correctly',()=>{
 assert.match(source,/APP_VERSION='0\.2\.4',DB_NAME='worldgen-dev-023'/);
 const packageInfo=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.equal(packageInfo.version,'0.2.4');
});
