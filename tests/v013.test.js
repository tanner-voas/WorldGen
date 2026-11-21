import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,IMPLEMENTED,generateStage,newWorld,upgradeWorld,validateWorld,snapshotThroughStage,landAreaFraction} from '../src/engine.js';

function makeWorld(count=220){
 const world=newWorld('Erosion regression');
 for(let stage=1;stage<=7;stage++){
  const settings={...DEFAULTS[stage],...(stage===2?{averageArea:2048*1024/count,seed:8123,relaxation:0}: {})};
  const data=generateStage(stage,world.locked,settings);
  world.locked.push({stage,settings,data});
 }
 world.working={stage:8,settings:{},data:null,dataSettings:null};
 return world;
}

test('stage 6 produces deterministic erosion, drainage and sediment arrays',()=>{
 const world=makeWorld(),mesh=world.locked[1].data,erosion=world.locked[6].data;
 assert.ok(IMPLEMENTED>=7);
 for(const name of ['elevations','erosionDepth','deposition','flowTo','discharge'])assert.equal(erosion[name].length,mesh.cells.length);
 assert.ok(erosion.erosionDepth.some(v=>v>0),'erosion is measurable');
 assert.ok(erosion.channels.length>0,'flow channels exist');
 assert.ok(erosion.summary.maxDischarge>0);
 assert.deepEqual(erosion,generateStage(7,world.locked.slice(0,6),world.locked[6].settings));
 assert.doesNotThrow(()=>validateWorld(world));
});

test('stage 6 cannot mutate locked coastlines, mesh or landform inputs',()=>{
 const world=makeWorld();
 const coast=world.locked[4].data,previous=world.locked[5].data,next=world.locked[6].data;
 const mesh=world.locked[1].data;
 const before=JSON.stringify(world.locked.slice(0,6));
 for(let i=0;i<coast.water.length;i++){
  assert.equal(next.elevations[i]<coast.seaLevel,Boolean(coast.water[i]));
  if(coast.water[i])assert.equal(next.elevations[i],previous.elevations[i]);
  const j=next.flowTo[i];if(j>=0){assert.ok(mesh.cells[i].neighbors.includes(j));assert.ok(next.elevations[i]>next.elevations[j],`cell ${i} should flow downhill`);}
 }
 assert.equal(JSON.stringify(world.locked.slice(0,6)),before);
 assert.equal(landAreaFraction(mesh,coast.water),coast.landAreaFraction);
});

test('zero hydraulic and thermal strengths leave the layer 5 terrain unchanged',()=>{
 const world=makeWorld(120);
 const result=generateStage(7,world.locked.slice(0,6),{...DEFAULTS[7],hydraulic:0,thermal:0});
 assert.deepEqual(result.elevations,world.locked[5].data.elevations);
 assert.ok(result.erosionDepth.every(x=>x===0));
 assert.ok(result.deposition.every(x=>x===0));
});

test('v0.1.2 completed worlds upgrade to editable stage 6 without changing history',()=>{
 const world=makeWorld(130);
 const original=JSON.stringify(world.locked.slice(0,6));
 world.locked.pop();world.working={stage:7,settings:{},data:null,dataSettings:null};
 delete world.showFlow;
 upgradeWorld(world);
 assert.deepEqual(world.working.settings,DEFAULTS[7]);
 assert.equal(world.showFlow,false);
 assert.equal(JSON.stringify(world.locked),original);
 const preview=generateStage(7,world.locked,world.working.settings);
 world.working.data=preview;world.working.dataSettings={...world.working.settings};
 assert.doesNotThrow(()=>validateWorld(world));
});

test('complete stage 4 and stage 6 snapshots preserve exact history',()=>{
 const world=makeWorld(130),throughFour=snapshotThroughStage(world,5),throughSix=snapshotThroughStage(world,7);
 assert.equal(throughFour.locked.length,5);
 assert.equal(throughFour.working.stage,6);
 assert.equal(throughSix.locked.length,7);
 assert.equal(throughSix.working.stage,8);
 assert.doesNotThrow(()=>validateWorld(JSON.parse(JSON.stringify(throughFour))));
 assert.doesNotThrow(()=>validateWorld(JSON.parse(JSON.stringify(throughSix))));
});

test('reject corrupted flow index, negative water discharge and malformed erosion arrays',()=>{
 const world=makeWorld(130);
 for(const change of [
  w=>w.locked[6].data.flowTo[0]=100000,
  w=>w.locked[6].data.discharge[1]=-1,
  w=>w.locked[6].data.channels.push(-1),
  w=>w.locked[6].data.erosionDepth.pop(),
  w=>w.locked[6].data.summary.maxDischarge=Infinity
 ]){
  const invalid=structuredClone(world);change(invalid);
  assert.throws(()=>validateWorld(invalid),/Invalid erosion data/);
 }
});
