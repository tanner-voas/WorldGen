import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULTS,MAX_CELLS,generateGeometry,generateMesh,meshTargetCount,newWorld,upgradeWorld,validateWorld} from '../src/engine.js';
const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');

test('v0.2.1 uses blue-noise random by default and caps optional high-resolution worlds at 20k',()=>{
 assert.equal(DEFAULTS[2].distribution,'random');
 assert.equal(MAX_CELLS,20000);
 const g=generateGeometry({shape:'circle',radius:1000});
 assert.equal(meshTargetCount(g,.0001),20000);
 const mesh=generateMesh({...DEFAULTS[2],averageArea:g.areaKm2/20000,relaxation:0},null,g);
 assert.equal(mesh.cells.length,20000);
 assert.ok(mesh.cells.every(cell=>Number.isFinite(cell.x)&&Number.isFinite(cell.y)&&cell.poly.length>=6));
 const w=newWorld();w.locked.push({stage:1,settings:{shape:'circle',radius:1000},data:g});
 w.locked.push({stage:2,settings:{...DEFAULTS[2],averageArea:g.areaKm2/20000,relaxation:0},data:mesh});
 w.working={stage:3,settings:{...DEFAULTS[3]},data:null,dataSettings:null};
 assert.doesNotThrow(()=>validateWorld(w));
});
test('Lloyd relaxation has matching UI, runtime, and upgrade limits',()=>{
 const s=app.match(/\['relaxation','Lloyd relaxation','range',0,(\d+),/);
 assert.equal(Number(s?.[1]),8);
 const g=generateGeometry(DEFAULTS[1]),w=newWorld();w.locked.push({stage:1,settings:DEFAULTS[1],data:g});
 w.working={stage:2,settings:{...DEFAULTS[2],relaxation:100},data:null,dataSettings:null};
 assert.equal(upgradeWorld(w).working.settings.relaxation,8);
 assert.match(readFileSync(new URL('../src/engine.js',import.meta.url),'utf8'),/const passes=clamp\(Math\.round\(settings\.relaxation\),0,8\)/);
});
test('stage 2 jitter is contextual and random seed reroll remains icon-only',()=>{
 assert.match(app,/stage!==2\|\|option\[0\]!=='jitter'\|\|settings\.distribution==='jittered'/);
 assert.match(app,/wg-seed-input/);
 assert.match(app,/aria-label="Reroll random seed" title="Reroll random seed">↻<\/button>/);
 assert.match(css,/\.wg-seed-row \.wg-info\{[^}]*border-radius:50%/);
});
test('collapsed map has three side-by-side controls and expanded settings has layer lock',()=>{
 assert.match(app,/class="wg-map-bottom-tools"/);
 assert.match(app,/id="wg-map-layer-select"/);
 assert.match(app,/class="wg-panel-lock wg-layer-toggle"/);
 assert.match(app,/stageSelect\.innerHTML=/);
 assert.match(css,/\.wg-map-bottom-tools\{[^}]*display:grid;grid-template-columns:/);
 assert.match(css,/\.wg-shell:not\(\.wg-explore\) \.wg-map-bottom-tools\{display:none\}/);
 assert.match(app,/drawerDrag\.closeOnRelease=rawHeight<minimum\*\.72/);
 assert.match(app,/if\(close\)\{workspace\.exploreMode=true;/);
});
test('stage 2 hides a redundant palette and all legends, retaining overlay toggles',()=>{
 assert.match(app,/const availablePalettes=shown>2\?/);
 assert.match(app,/palette\.hidden=shown<=2/);
 assert.doesNotMatch(app,/<details class="wg-legend-details"/);
 assert.match(app,/data-overlay-stage="2"/);
 assert.match(css,/\.wg-shell\.wg-map-compact \.wg-overlays\{top:106px/);
});
