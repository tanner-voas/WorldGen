import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS, IMPLEMENTED, BIOME_NAMES,generateStage,generateBiomes,newWorld,validateWorld,upgradeWorld,snapshotThroughStage} from '../src/engine.js';

function worldAt(stage=10, shape={shape:'rectangle',width:2048,height:1024}, count=280){
 const w=newWorld('Biome regression');
 for(let s=1;s<=stage;s++){
  const settings={...DEFAULTS[s],...(s===1?shape:{}),...(s===2?{averageArea:w.locked[0].data.areaKm2/count,relaxation:0}:{})};
  w.locked.push({stage:s,settings,data:generateStage(s,w.locked,settings)});
 }
 w.working={stage:stage+1,settings:DEFAULTS[stage+1]?{...DEFAULTS[stage+1]}:{},data:null,dataSettings:null};
 w.viewStage=stage;
 return w;
}

function getBiome(w, settings={}){
 return generateStage(11,w.locked,{...DEFAULTS[11],...settings});
}

test('stage 11 is a deterministic, self-contained biome classification with immutable dependencies',()=>{
 assert.equal(IMPLEMENTED,12);
 const w=worldAt();const previous=JSON.stringify(w.locked);
 const a=getBiome(w),b=getBiome(w);
 assert.deepEqual(a,b);
 assert.equal(JSON.stringify(w.locked),previous);
 assert.equal(a.biome.length,w.locked[1].data.cells.length);
 assert.equal(a.counts.reduce((x,y)=>x+y,0),a.biome.length);
 assert.ok(a.counts.filter(Boolean).length>=5, 'expect meaningful biome diversity');
 assert.equal(a.areaKm2ByBiome.length,BIOME_NAMES.length);
 for(const key of ['treePotential','productivity','waterStress','ecotone'])assert.ok(a[key].every(v=>v>=0&&v<=1));
 assert.ok(a.growingMonths.every(v=>v>=0&&v<=12&&Number.isInteger(v)));
});

test('ocean, lake and land classes match upstream water masks and permit no aquatic productivity',()=>{
 const w=worldAt(),a=getBiome(w),coast=w.locked[4].data,hyd=w.locked[8].data;
 for(let i=0;i<a.biome.length;i++){
  assert.equal(a.biome[i],coast.water[i]?0:hyd.lakeId[i]>=0?1:a.biome[i]);
  if(a.biome[i]<2)for(const key of ['treePotential','productivity','waterStress','ecotone','growingMonths'])assert.equal(a[key][i],0);
 }
});

test('drier and wetter settings change ecological potential, with local variation deterministic',()=>{
 const w=worldAt(),dry=getBiome(w,{rainfallResponse:.4,forestThreshold:1.7}),wet=getBiome(w,{rainfallResponse:1.8,forestThreshold:.45});
 assert.ok(wet.summary.meanTreePotential>dry.summary.meanTreePotential);
 assert.ok(wet.summary.meanProductivity>dry.summary.meanProductivity);
 const noNoise=getBiome(w,{patchVariation:0}),withNoise=getBiome(w,{patchVariation:.4});
 assert.notDeepEqual(noNoise.biome,withNoise.biome);
 const cold=getBiome(w,{temperatureShift:-12}),warm=getBiome(w,{temperatureShift:12});
 assert.ok(warm.summary.meanGrowingMonths>cold.summary.meanGrowingMonths);
});

test('rectangle, circle and ellipse checkpoints validate; saved stage 10 can resume at stage 11',()=>{
 for(const shape of [{shape:'rectangle',width:2048,height:1024},{shape:'circle',radius:750},{shape:'ellipse',radiusX:1100,radiusY:600}]){
  const w=worldAt(11,shape,240);
  assert.doesNotThrow(()=>validateWorld(w),shape.shape);
  const full=snapshotThroughStage(w,11);assert.equal(full.locked.length,11);assert.equal(full.working.stage,12);
  assert.doesNotThrow(()=>validateWorld(structuredClone(full)));
  const earlier=snapshotThroughStage(w,10);assert.equal(earlier.locked.length,10);assert.equal(earlier.working.stage,11);
  assert.ok(!earlier.locked.some(r=>r.stage===11));
  upgradeWorld(earlier);assert.ok(Number.isFinite(earlier.working.settings.forestThreshold));
  const resumed=generateStage(11,earlier.locked,earlier.working.settings);
  assert.equal(resumed.biome.length,earlier.locked[1].data.cells.length);
 }
});

test('import validation rejects invalid biome arrays, water mismatch, and forged totals',()=>{
 const w=worldAt(11,{shape:'circle',radius:710},240);
 const broken=structuredClone(w);broken.locked[10].data.biome.pop();
 assert.throws(()=>validateWorld(broken),/Invalid biome classes/);
 const forged=structuredClone(w);forged.locked[10].data.counts[2]++;
 assert.throws(()=>validateWorld(forged),/Invalid biome totals/);
 const water=structuredClone(w),ocean=water.locked[4].data.water.findIndex(Boolean);
 assert.ok(ocean>=0);water.locked[10].data.biome[ocean]=9;water.locked[10].data.counts[0]--;water.locked[10].data.counts[9]++;
 assert.throws(()=>validateWorld(water),/Biome water mask/);
 const fakeArea=structuredClone(w);fakeArea.locked[10].data.areaKm2ByBiome[2]+=400;
 assert.throws(()=>validateWorld(fakeArea),/Invalid biome area total/);
});
