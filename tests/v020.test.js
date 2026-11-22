import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newWorld,upgradeWorld} from '../src/engine.js';

const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');

test('v0.2.0 stores a resizable drawer height as optional recoverable world metadata',()=>{
 const created=newWorld();
 assert.equal(created.consoleHeightRatio,.36);
 const old=structuredClone(created);
 delete old.consoleHeightRatio;
 assert.equal(upgradeWorld(old).consoleHeightRatio,.36);
 for(const [invalid,expected] of [[null,.36],[NaN,.36],[-100,.1],[Infinity,.36],[3,.95]]){
  const world=structuredClone(created);
  world.consoleHeightRatio=invalid;
  assert.equal(upgradeWorld(world).consoleHeightRatio,expected);
 }
});

test('every generation parameter uses the same one-column layout',()=>{
 assert.match(css,/\.wg-controls\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/@media\(min-width:700px\)\{\.wg-controls\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(app,/OPTIONS\[stage\].*?\.map\(settingRow\)/);
 assert.doesNotMatch(app,/data-action="lock"/);
 assert.match(app,/data-action="lock-or-unlock"/);
 assert.match(app,/data-action="reset-settings"/);
});

test('drawer can be dragged and resized without disabling map exploration',()=>{
 assert.match(app,/handle\.setPointerCapture\(event\.pointerId\)/);
 assert.match(app,/handle\.addEventListener\('pointermove'/);
 assert.match(app,/workspace\.consoleHeightRatio=height\/viewport/);
 assert.match(app,/resizeCanvas\(\)/);
 assert.match(app,/suppressHandleClick/);
 assert.match(css,/\.wg-console\{height:var\(--wg-console-height\)/);
 assert.match(css,/\.wg-map-area\{bottom:var\(--wg-console-height\)/);
});

test('unavailable overlays and palettes are removed, not disabled',()=>{
 assert.match(app,/availablePalettes=shown>2\?Object\.entries\(palettes\)\.filter/);
 assert.match(app,/displayBar\.hidden=shown<2/);
 for(const stage of [2,3,5,7])assert.match(app,new RegExp(`data-overlay-stage="${stage}"`));
 assert.match(app,/label\.hidden=Number\(label\.dataset\.overlayStage\)>shown/);
});

test('unlock has no confirmation and backs up history when branching to an earlier layer',()=>{
 const method=app.slice(app.indexOf('async function unlockLayer('),app.indexOf('function rgb('));
 assert.doesNotMatch(method,/\bconfirm\s*\(/);
 assert.match(method,/if\(stage<workspace\.locked\.length\)/);
 assert.match(method,/await commitCheckpoint\(await db\(\),\{kind:'save',metadata,world:previous\}\)/);
 assert.match(method,/reviseStage\(stage\)/);
 assert.match(app,/case 'lock-or-unlock':if\(viewStage\(\)<=workspace\.locked\.length\)await unlockLayer/);
});
