import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,IMPLEMENTED,LANDFORM_NAMES,generateStage,validateWorld,upgradeWorld,snapshotThroughStage,newWorld} from '../src/engine.js';

function makeWorld(count=350){
 const w=newWorld('Audit world');
 for(let stage=1;stage<=5;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?{count,seed:928}:{}),...(stage===2?{seed:678}:{}),...(stage===5?{seed:314}: {})};
  const data=generateStage(stage,w.locked,settings);
  w.locked.push({stage,settings,data,lockedAt:'2026-11-21'});
 }
 w.working={stage:6,settings:{},data:null,dataSettings:null};
 return w;
}

test('v0.1.1 adds a fifth deterministic and coastline-safe landscape layer',()=>{
 const w=makeWorld();assert.equal(IMPLEMENTED,5);
 const mesh=w.locked[0].data,heights=w.locked[2].data,coasts=w.locked[3].data,land=w.locked[4].data;
 assert.equal(land.classes.length,mesh.cells.length);
 assert.equal(land.ruggedness.length,mesh.cells.length);
 assert.equal(land.elevations.length,mesh.cells.length);
 assert.equal(land.counts.length,LANDFORM_NAMES.length);
 assert.equal(land.counts.reduce((a,b)=>a+b,0),mesh.cells.length);
 assert.ok(land.classes.some(c=>c===0||c===1));
 assert.ok(land.classes.some(c=>c>=2));
 assert.ok(land.elevations.some((h,i)=>h!==heights.elevations[i]));
 for(let i=0;i<mesh.cells.length;i++){
  assert.equal(land.elevations[i]<coasts.seaLevel,Boolean(coasts.water[i]),'landform refinement must retain all locked coastline cells');
  assert.ok(land.classes[i]>=0&&land.classes[i]<LANDFORM_NAMES.length);
  assert.ok(land.ruggedness[i]>=0&&land.ruggedness[i]<=1);
 }
 assert.deepEqual(land,generateStage(5,w.locked.slice(0,4),w.locked[4].settings));
 assert.doesNotThrow(()=>validateWorld(w));
});

test('a checkpoint of an earlier selected layer includes exactly layers 1 through N',()=>{
 const w=makeWorld(150);
 const stage4=snapshotThroughStage(w,4);
 assert.equal(stage4.locked.length,4);
 assert.equal(stage4.working.stage,5);
 assert.equal(stage4.working.data,null);
 assert.equal(stage4.viewStage,4);
 assert.deepEqual(stage4.locked,w.locked.slice(0,4));
 assert.doesNotThrow(()=>validateWorld(JSON.parse(JSON.stringify(stage4))));
 stage4.locked[0].data.cells[0].x=999;
 assert.notEqual(stage4.locked[0].data.cells[0].x,w.locked[0].data.cells[0].x,'snapshots must be independent');
 const stage2=snapshotThroughStage(w,2);
 assert.equal(stage2.locked.length,2);
 assert.equal(stage2.working.stage,3);
 const stage5=snapshotThroughStage(w,5);
 assert.equal(stage5.locked.length,5);
 assert.equal(stage5.working.stage,6);
 assert.throws(()=>snapshotThroughStage(w,6));
});

test('a generated-but-unlocked layer also exports complete preceding dependencies',()=>{
 const w=makeWorld(120);
 const stage5=w.locked.pop();
 w.working={stage:5,settings:stage5.settings,data:stage5.data,dataSettings:stage5.settings};
 const snap=snapshotThroughStage(w,5);
 assert.equal(snap.locked.length,4);
 assert.ok(snap.working.data.classes.length===120);
 assert.equal(snap.working.stage,5);
 assert.doesNotThrow(()=>validateWorld(JSON.parse(JSON.stringify(snap))));
});

test('v0.1.0 completed four-layer saves migrate cleanly into editable stage 5',()=>{
 const old=makeWorld(120);
 old.locked=old.locked.slice(0,4);
 old.working={stage:5,settings:{},data:null,dataSettings:null};
 delete old.showPlateBorders;delete old.showCoastBorders;delete old.exploreMode;
 const frozen=JSON.stringify(old.locked);
 const upgraded=upgradeWorld(old);
 assert.deepEqual(upgraded.working.settings,DEFAULTS[5]);
 assert.equal(JSON.stringify(upgraded.locked),frozen,'must not regenerate locked data');
 const detail=generateStage(5,upgraded.locked,upgraded.working.settings);
 assert.equal(detail.classes.length,120);
 upgraded.working.data=detail;upgraded.working.dataSettings={...DEFAULTS[5]};
 assert.doesNotThrow(()=>validateWorld(upgraded));
});

test('untrusted save validation rejects truncated, corrupt and unsupported layer arrays',()=>{
 const w=makeWorld(120);
 const bad=structuredClone(w);
 bad.locked[4].data.classes[0]=999;
 assert.throws(()=>validateWorld(bad),/Invalid landform/);
 const badCoast=structuredClone(w);
 badCoast.locked[3].data.water=[];
 assert.throws(()=>validateWorld(badCoast),/Invalid coast/);
 const badMesh=structuredClone(w);
 badMesh.locked[0].data.cells[0].poly[0]=Infinity;
 assert.throws(()=>validateWorld(badMesh),/Invalid polygon/);
});
