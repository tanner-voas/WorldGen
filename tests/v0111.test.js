import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,IMPLEMENTED,VEGETATION_NAMES,generateStage,generateVegetation,newWorld,validateWorld,prepareWorld,snapshotThroughStage} from '../src/engine.js';

function worldAt(stage=12,shape={shape:'rectangle',width:2048,height:1024},count=280){
 const world=newWorld('Vegetation regression');
 for(let s=1;s<=stage;s++){
  const settings={...DEFAULTS[s],...(s===1?shape:{}),...(s===2?{averageArea:world.locked[0].data.areaKm2/count,relaxation:0}:{})};
  world.locked.push({stage:s,settings,data:generateStage(s,world.locked,settings)});
 }
 world.working={stage:stage+1,settings:DEFAULTS[stage+1]?{...DEFAULTS[stage+1]}:{},data:null,dataSettings:null};
 world.viewStage=stage;
 return world;
}
const vegetation=(w,settings={})=>generateStage(13,w.locked,{...DEFAULTS[13],...settings});

test('stage 12 produces deterministic, bounded vegetation without rewriting earlier layers',()=>{
 assert.equal(IMPLEMENTED,13);
 const w=worldAt();const old=JSON.stringify(w.locked);
 const a=vegetation(w),b=vegetation(w);
 assert.deepEqual(a,b);assert.equal(JSON.stringify(w.locked),old);
 const n=w.locked[1].data.cells.length;
 assert.equal(a.coverClass.length,n);assert.equal(a.counts.reduce((x,y)=>x+y,0),n);
 assert.equal(a.areaKm2ByClass.length,VEGETATION_NAMES.length);
 for(const key of ['canopyCover','groundCover','biomass','habitatComplexity','riparian'])assert.ok(a[key].every(v=>v>=0&&v<=1));
 assert.ok(a.heightM.every(v=>v>=0&&v<=40));
 assert.ok(a.counts.filter(Boolean).length>=3);
});

test('oceans and lakes contain no vegetation and river influence never crosses oceans',()=>{
 const w=worldAt(),a=vegetation(w),coast=w.locked[5].data,hydro=w.locked[9].data;
 for(let i=0;i<a.coverClass.length;i++){
  if(coast.water[i])assert.equal(a.coverClass[i],0);
  else if(hydro.lakeId[i]>=0)assert.equal(a.coverClass[i],1);
  else assert.ok(a.coverClass[i]>=2);
  if(coast.water[i]||hydro.lakeId[i]>=0)for(const key of ['canopyCover','groundCover','biomass','heightM','habitatComplexity','riparian'])assert.equal(a[key][i],0);
 }
});

test('density, maturity, disturbance and riparian controls affect the intended vegetation fields',()=>{
 const w=worldAt();
 const sparse=vegetation(w,{vegetationDensity:.25}),lush=vegetation(w,{vegetationDensity:1.7});
 assert.ok(lush.summary.meanCanopy>sparse.summary.meanCanopy);
 assert.ok(lush.summary.meanGroundCover>sparse.summary.meanGroundCover);
 const young=vegetation(w,{maturity:0}),old=vegetation(w,{maturity:1});
 assert.ok(old.summary.meanHeightM>young.summary.meanHeightM);
 const clear=vegetation(w,{disturbance:0}),damaged=vegetation(w,{disturbance:1});
 assert.ok(clear.summary.meanBiomass>damaged.summary.meanBiomass);
 const noRiver=vegetation(w,{riparianStrength:0}),withRiver=vegetation(w,{riparianStrength:1.5});
 assert.ok(withRiver.summary.meanGroundCover>=noRiver.summary.meanGroundCover);
 const unpatched=vegetation(w,{patchiness:0}),patched=vegetation(w,{patchiness:.45});
 assert.notDeepEqual(unpatched.canopyCover,patched.canopyCover);
});

test('three geographic shapes save complete stage-12 checkpoints and resume stage-11 snapshots',()=>{
 for(const shape of [{shape:'rectangle',width:2048,height:1024},{shape:'circle',radius:750},{shape:'ellipse',radiusX:1100,radiusY:600}]){
  const w=worldAt(12,shape,220),a=vegetation(w);
  w.locked.push({stage:13,settings:{...DEFAULTS[13]},data:a});
  w.working={stage:14,settings:{},data:null,dataSettings:null};w.viewStage=12;
  assert.doesNotThrow(()=>validateWorld(w),shape.shape);
  const snap=snapshotThroughStage(w,12);
  assert.equal(snap.locked.length,12);assert.equal(snap.working.stage,13);
  assert.doesNotThrow(()=>validateWorld(structuredClone(snap)));
  const older=snapshotThroughStage(w,12);
  assert.equal(older.locked.length,12);assert.equal(older.working.stage,13);
  assert.doesNotThrow(()=>prepareWorld(older));
  assert.ok(Number.isFinite(older.working.settings.vegetationDensity));
  assert.equal(vegetation(older).coverClass.length,220);
 }
});

test('import rejects damaged vegetation arrays, water assignments, false counts and forged area totals',()=>{
 const w=worldAt(),data=vegetation(w);
 w.locked.push({stage:13,settings:{...DEFAULTS[13]},data});
 w.working={stage:14,settings:{},data:null,dataSettings:null};
 const truncated=structuredClone(w);truncated.locked[12].data.canopyCover.pop();
 assert.throws(()=>validateWorld(truncated),/Invalid vegetation field/);
 const mismatch=structuredClone(w);mismatch.locked[12].data.counts[2]++;
 assert.throws(()=>validateWorld(mismatch),/Invalid vegetation totals/);
 const coast=w.locked[5].data,ocean=coast.water.findIndex(Boolean);
 const water=structuredClone(w);water.locked[12].data.coverClass[ocean]=7;water.locked[12].data.counts[0]--;water.locked[12].data.counts[7]++;
 assert.throws(()=>validateWorld(water),/Vegetation water mask/);
 const forged=structuredClone(w);forged.locked[12].data.areaKm2ByClass[2]+=w.locked[1].data.areaKm2;
 assert.throws(()=>validateWorld(forged),/Invalid vegetation area/);
});
