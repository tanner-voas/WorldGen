import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {DEFAULTS,IMPLEMENTED,newWorld,generateStage,stageUsesSeed,upgradeWorld,snapshotThroughStage} from '../src/engine.js';
import * as sampler from '../src/terrain-sampler.js';

const source=name=>readFileSync(new URL(`../src/${name}`,import.meta.url),'utf8');
function coastWorld(shape={shape:'rectangle',width:1000,height:600}){
 const world=newWorld();
 for(let stage=1;stage<=4;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?shape:{})};
  if(stage===2)settings.averageArea=world.locked[0].data.areaKm2/180;
  world.locked.push({stage,settings,data:generateStage(stage,world.locked,settings)});
 }
 const settings={...DEFAULTS[5],seed:4294967295};
 world.working={stage:5,settings,data:generateStage(5,world.locked,settings),dataSettings:{...settings}};
 world.viewStage=5;
 return world;
}

test('only layers that use an independent seed expose seed controls',()=>{
 assert.deepEqual(Array.from({length:IMPLEMENTED},(_,i)=>i+1).filter(stageUsesSeed),[2,3,4,6,7,8,9,10,11,12]);
 for(const invalid of [-1,0,13,NaN,Infinity,4.5,'5'])assert.equal(stageUsesSeed(invalid),false);
 const code=source('app.js');
 assert.match(code,/!stageUsesSeed\(stage\)\?'':`<div class="wg-seed-row"/);
 assert.match(code,/case 'reroll':if\(viewStage\(\)!==currentStage\(\)\|\|!stageUsesSeed\(currentStage\(\)\)\)break/);
 assert.match(code,/if\(el.id==='wg-seed'\)\{\s*if\(viewStage\(\)!==currentStage\(\)\|\|!stageUsesSeed\(currentStage\(\)\)\)return/);
});

test('coast generation is seed-independent on all map shapes',()=>{
 for(const shape of [{shape:'rectangle',width:1000,height:600},{shape:'circle',radius:500},{shape:'ellipse',radiusX:700,radiusY:300}]){
  const world=coastWorld(shape),{settings,data}=world.working;
  assert.deepEqual(generateStage(5,world.locked,{...settings,seed:0}),data);
  assert.deepEqual(generateStage(5,world.locked,{...settings,seed:12345}),data);
  assert.notDeepEqual(generateStage(5,world.locked,{...settings,land:.65}),data);
 }
});

test('legacy coast seeds, locked geometry and working data survive upgrade and checkpoint export',()=>{
 const before=coastWorld(),saved=upgradeWorld(JSON.parse(JSON.stringify(before)));
 assert.equal(saved.working.settings.seed,4294967295);
 assert.deepEqual(saved.working.dataSettings,before.working.dataSettings);
 assert.deepEqual(saved.working.data,before.working.data);
 assert.deepEqual(saved.locked,before.locked);
 const checkpoint=snapshotThroughStage(saved,5);
 assert.equal(checkpoint.working.settings.seed,4294967295);
 assert.deepEqual(checkpoint.working.data,saved.working.data);
 // Locking the layer also preserves the original seed and geography.
 saved.locked.push({stage:5,settings:saved.working.settings,data:saved.working.data});
 saved.working={stage:6,settings:{...DEFAULTS[6]},data:null,dataSettings:null};
 const lockedCheckpoint=snapshotThroughStage(saved,5);
 assert.equal(lockedCheckpoint.locked[4].settings.seed,4294967295);
 assert.deepEqual(lockedCheckpoint.locked[4].data,before.working.data);
});

test('retired renderer is absent but editor PNG export and 3D entry/relief controls survive',()=>{
 for(const retired of ['render.js','raster-worker.js','raster.js'])assert.equal(existsSync(new URL(`../src/${retired}`,import.meta.url)),false);
 const code=source('app.js');
 assert.doesNotMatch(code,/showRenderDialog|renderDraft|renderController|renderOutputCanvas|data-render-setting|wg-render-|case 'render-/);
 assert.doesNotMatch(source('styles.css'),/\.wg-render-|\.wg-change-key/);
 assert.match(code,/case 'render':showTerrain3D\(\)/);
 assert.match(code,/case 'screenshot':screenshot\(\)/);
 assert.match(code,/function screenshot\(\)\{canvas.toBlob/);
 assert.match(code,/data-action="3d-height-up"/);
 assert.match(code,/function closeModal\(\)\{releaseTerrainViewer\(\)/);
 assert.match(code,/function releaseTerrainViewer\(\)\{\s*terrainViewer\?\.dispose\(\)/);
});

test('shared sampler contains only live spatial interpolation exports',()=>{
 assert.deepEqual(Object.keys(sampler).sort(),['createTerrainSampler','nearestTerrainSite','visitTerrainSites']);
});
