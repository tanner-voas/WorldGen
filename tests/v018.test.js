import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,IMPLEMENTED,SOIL_NAMES,newWorld,generateStage,generateSoils,validateWorld,upgradeWorld,snapshotThroughStage} from '../src/engine.js';

function worldAt(stage=10,count=320,shape={shape:'rectangle',width:1500,height:850}){
 const w=newWorld('Soil map');
 for(let s=1;s<=stage;s++){
  const settings={...DEFAULTS[s],...(s===1?shape:{}),...(s===2?{averageArea:w.locked[0].data.areaKm2/count,relaxation:0}:{})};
  const data=generateStage(s,w.locked,settings);
  w.locked.push({stage:s,settings,data});
 }
 w.working={stage:stage+1,settings:stage<IMPLEMENTED?{...DEFAULTS[stage+1]}:{},data:null,dataSettings:null};
 w.viewStage=stage;
 return w;
}
test('stage 10 computes deterministic soil fields from immutable upstream layers',()=>{
 assert.ok(IMPLEMENTED>=10);
 const w=worldAt(9),upstream=JSON.stringify(w.locked),soil=generateStage(10,w.locked,DEFAULTS[10]);
 assert.equal(JSON.stringify(w.locked),upstream);
 assert.deepEqual(generateStage(10,w.locked,DEFAULTS[10]),soil);
 assert.equal(soil.soilType.length,w.locked[1].data.cells.length);
 assert.equal(soil.counts.reduce((a,b)=>a+b,0),soil.soilType.length);
 assert.ok(soil.summary.meanDepthM>0);
 assert.ok(soil.summary.landCells>0);
 assert.ok(soil.summary.highFertilityCells>0);
});
test('ocean and freshwater lake cells contain no soil; other cells have bounded values',()=>{
 const w=worldAt(9,450);const inputs=w.locked.map(r=>r.data),hyd=structuredClone(inputs[8]),coast=inputs[4];
 const inland=coast.water.findIndex((v,i)=>!v&&hyd.lakeId[i]===-1);
 assert.ok(inland>=0);hyd.lakeId[inland]=0;
 const soil=generateSoils(inputs[1],inputs[2],inputs[5],coast,inputs[6],inputs[7],hyd,DEFAULTS[10]);
 for(let i=0;i<soil.soilType.length;i++){
  const wet=coast.water[i]||hyd.lakeId[i]>=0;
  assert.equal(soil.soilType[i]===0,!!wet);
  if(wet)for(const field of ['depthM','organicMatter','permeability','fertility','groundwater','erosionRisk'])assert.equal(soil[field][i],0);
  else {
   assert.ok(soil.depthM[i]>=0&&soil.depthM[i]<=7);
   for(const f of ['organicMatter','permeability','fertility','groundwater','erosionRisk'])assert.ok(soil[f][i]>=0&&soil[f][i]<=1);
  }
 }
});
test('weathering, organic input, and groundwater controls have directional results',()=>{
 const w=worldAt(9,320),data=w.locked.map(r=>r.data),calc=settings=>generateSoils(data[1],data[2],data[5],data[4],data[6],data[7],data[8],settings);
 const dry=calc({...DEFAULTS[10],weathering:0,organicInput:0,groundwaterRecharge:0});
 const wet=calc({...DEFAULTS[10],weathering:2,organicInput:2,groundwaterRecharge:2});
 assert.ok(wet.summary.meanDepthM>dry.summary.meanDepthM);
 assert.ok(wet.summary.meanGroundwater>dry.summary.meanGroundwater);
 const mean=(a,field)=>a[field].reduce((sum,v)=>sum+v,0);
 assert.ok(mean(wet,'organicMatter')>mean(dry,'organicMatter'));
});
test('complete stage 10 checkpoint restores, while stage 9 saves advance without changes',()=>{
 const w=worldAt(10,350,{shape:'circle',radius:750});
 assert.doesNotThrow(()=>validateWorld(w));
 const snap=snapshotThroughStage(w,10);
 assert.equal(snap.locked.length,10);assert.equal(snap.working.stage,11);
 const clone=upgradeWorld(JSON.parse(JSON.stringify(snap)));
 assert.deepEqual(clone.locked[9].data,w.locked[9].data);
 const previous=worldAt(9,280),original=JSON.stringify(previous.locked);
 previous.working.settings={};upgradeWorld(previous);
 assert.deepEqual(previous.working.settings,DEFAULTS[10]);
 assert.equal(JSON.stringify(previous.locked),original);
});
test('soil validation rejects malformed arrays, out-of-range data, wrong water mask and inconsistent counts',()=>{
 const w=worldAt(10,280,{shape:'ellipse',radiusX:1100,radiusY:650});
 assert.doesNotThrow(()=>validateWorld(w));
 assert.equal(SOIL_NAMES.length,w.locked[9].data.counts.length);
 const cases=[
  d=>d.soilType.pop(),d=>d.soilType[0]=SOIL_NAMES.length,
  d=>d.depthM[0]=-1,d=>d.fertility[0]=NaN,d=>d.permeability[0]=5,
  d=>d.counts[0]++,d=>d.summary.meanFertility=10,
  d=>{const inland=w.locked[4].data.water.findIndex(v=>v===0);d.soilType[inland]=0;}
 ];
 for(const mutate of cases){const broken=structuredClone(w);mutate(broken.locked[9].data);assert.throws(()=>validateWorld(broken),/Invalid soil/);}
});
