import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateOceans,generateStage,newWorld,prepareWorld,validateWorld,cellArea} from '../src/engine.js';
import {geometryConstraintReport,meshConstraintReport} from '../src/generation-constraints.js';

function rectCell(x0,x1){return {x:(x0+x1)/2,y:50,poly:[x0,0,x1,0,x1,100,x0,100],neighbors:[]};}
function weightedMesh(){return {cells:[rectCell(0,60),rectCell(60,80),rectCell(80,90),rectCell(90,100)]};}

test('new ocean layer floods exactly elevations <= zero, never targets a land percentage',()=>{
 const mesh=weightedMesh(),h={elevations:[-.1,.1,.2,.3]};
 const flooded=generateOceans(h,DEFAULTS[5],mesh);
 assert.deepEqual(flooded.water,[1,0,0,0]);
 assert.equal(flooded.seaLevel,0);
 assert.equal(flooded.landFraction,.75);
 assert.equal(flooded.landAreaFraction,.4);
 assert.deepEqual(h.elevations,[-.1,.1,.2,.3]);
 assert.equal(mesh.cells.map(cellArea).reduce((a,b)=>a+b,0),10000);
});

test('offset handles entirely submerged and exposed worlds without special target rules',()=>{
 const mesh=weightedMesh(),height={elevations:[-.1,.1,.2,.3]};
 const allWater=generateOceans(height,{oceanOffset:-.5},mesh);
 const allLand=generateOceans(height,{oceanOffset:.5},mesh);
 assert.deepEqual(allWater.water,[1,1,1,1]);
 assert.deepEqual(allLand.water,[0,0,0,0]);
 assert.equal(allWater.landAreaFraction,0);
 assert.equal(allLand.landAreaFraction,1);
 assert.equal(meshConstraintReport(mesh),null);
});

test('world aspect ratio diagnostics operate independently of land and water',()=>{
 assert.equal(geometryConstraintReport({width:100,height:100}),null);
 assert.match(geometryConstraintReport({width:20000,height:50}).messages.join('\n'),/400:1/);
});

test('extreme shapes generate valid 13-layer worlds without target land percentage',()=>{
 for(const shape of [{shape:'rectangle',width:20000,height:50},{shape:'ellipse',radiusX:20000,radiusY:50},{shape:'circle',radius:50}]){
  const w=newWorld('Zero-datum extremes');
  for(let stage=1;stage<=13;stage++){
   const settings={...DEFAULTS[stage],...(stage===1?shape:stage===2?{averageArea:w.locked[0].data.areaKm2/100,relaxation:0}: {})};
   const data=generateStage(stage,w.locked,settings);w.locked.push({stage,settings,data});
  }
  const mesh=w.locked[1].data,oceans=w.locked[4].data,coast=w.locked[5].data;
  assert.ok(oceans.landAreaFraction>=0&&oceans.landAreaFraction<=1);
  assert.equal(oceans.water.length,mesh.cells.length);
  for(let i=0;i<mesh.cells.length;i++){
   assert.equal(oceans.water[i],Number(oceans.elevations[i]<=0));
   assert.equal(coast.water[i],Number(coast.elevations[i]<=0));
  }
  w.working={stage:14,settings:{},data:null,dataSettings:null};w.viewStage=13;
  assert.doesNotThrow(()=>validateWorld(w));
  assert.deepEqual(prepareWorld(structuredClone(w)).locked,w.locked);
 }
});
