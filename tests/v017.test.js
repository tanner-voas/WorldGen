import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,IMPLEMENTED,newWorld,generateStage,generateHydrology,validateWorld,prepareWorld,snapshotThroughStage} from '../src/engine.js';

function worldAt(stage=10,count=340,geometry={shape:'rectangle',width:1500,height:850}){
 const w=newWorld('Hydrology world');
 for(let s=1;s<=stage;s++){
  const settings={...DEFAULTS[s],...(s===1?geometry:{}),...(s===2?{averageArea:w.locked[0].data.areaKm2/count,relaxation:0}:{})};
  const data=generateStage(s,w.locked,settings);
  w.locked.push({stage:s,settings,data});
 }
 w.working={stage:stage+1,settings:stage<IMPLEMENTED?{...DEFAULTS[stage+1]}:{},data:null,dataSettings:null};
 w.viewStage=stage;
 return w;
}
test('stage 9 hydrology works and earlier layers are immutable',()=>{
 assert.ok(IMPLEMENTED>=9);
 const w=worldAt();const original=JSON.stringify(w.locked.slice(0,8));
 const hydro=w.locked[9].data;
 assert.equal(hydro.flowTo.length,w.locked[1].data.cells.length);
 assert.ok(hydro.summary.annualRunoffKm3>0);
 assert.deepEqual(generateStage(10,w.locked.slice(0,9),DEFAULTS[10]),hydro);
 assert.equal(JSON.stringify(w.locked.slice(0,8)),original);
 assert.doesNotThrow(()=>validateWorld(w));
});
test('routes are adjacent, acyclic, reach an outlet, and conserve accumulated volumes',()=>{
 const w=worldAt(10,650),cells=w.locked[1].data.cells,hydro=w.locked[9].data,sea=w.locked[5].data;
 for(let i=0;i<cells.length;i++){
  let id=i,steps=0;
  while(hydro.flowTo[id]>=0){assert.ok(cells[id].neighbors.includes(hydro.flowTo[id]));id=hydro.flowTo[id];assert.ok(++steps<=cells.length,'routing cycle');}
  assert.equal(id,hydro.outlet[i]);
  if(!sea.water[i])assert.ok(hydro.catchmentArea[i]>0);
  const expected=hydro.localRunoff[i]+hydro.flowTo.reduce((sum,j,k)=>sum+(j===i?hydro.discharge[k]:0),0);
  // Rounded storage is sufficient to reconstruct mass balance to 1e-4 km³/year.
  assert.ok(Math.abs(hydro.discharge[i]-expected)<.0001,`flow conservation in cell ${i}`);
 }
});
test('increasing runoff and reducing infiltration increases total water without rewriting climate',()=>{
 const w=worldAt(9,400),inputs=w.locked,original=JSON.stringify(inputs);
 const mesh=inputs[1].data,coasts=inputs[5].data,erosion=inputs[7].data,climate=inputs[8].data;
 const dry=generateHydrology(mesh,coasts,erosion,climate,{...DEFAULTS[10],runoffScale:.3,infiltration:.85});
 const wet=generateHydrology(mesh,coasts,erosion,climate,{...DEFAULTS[10],runoffScale:2,infiltration:.05,evaporation:0});
 assert.ok(wet.summary.annualRunoffKm3>dry.summary.annualRunoffKm3);
 assert.equal(JSON.stringify(inputs),original);
});
test('priority flood fills a closed pit and generates a finite lakeshore',()=>{
 const squares=[0,1,2,3].map(i=>({x:i+.5,y:.5,poly:[i,0,i+1,0,i+1,1,i,1],neighbors:[i-1,i+1].filter(x=>x>=0&&x<4)}));
 const mesh={width:4,height:1,areaKm2:4,cells:squares};
 const coast={water:[1,0,0,0],seaLevel:0};
 const erosion={elevations:[-1,.5,.1,.7]};
 const climate={precipitation:[1000,1300,1300,1300],meanTemp:[18,18,18,18],moisture:[.5,.5,.5,.5]};
 const h=generateHydrology(mesh,coast,erosion,climate,{...DEFAULTS[10],lakeDepth:.02,minLakeCells:1});
 assert.equal(h.flowTo[2],1);assert.equal(h.spillElevation[2],.5);
 assert.equal(h.lakes.length,1);assert.equal(h.lakeId[2],0);
 assert.ok(h.lakeDepth[2]>.3);assert.equal(h.lakeLevel[2],.5);
 assert.deepEqual(h.flowTo,[-1,0,1,2]);
 assert.equal(h.outlet[3],0);
 const noLakes=generateHydrology(mesh,coast,erosion,climate,{...DEFAULTS[10],minLakeCells:2});
 assert.equal(noLakes.lakes.length,0);
});
test('complete layer 9 snapshot survives JSON restore, and layer 8 saves migrate without changing layers',()=>{
 const w=worldAt(10,320,{shape:'circle',radius:620});
 const snap=snapshotThroughStage(w,10);assert.equal(snap.locked.length,10);assert.equal(snap.working.stage,11);
 const loaded=prepareWorld(JSON.parse(JSON.stringify(snap)));assert.deepEqual(loaded.locked[9].data,w.locked[9].data);
 const previous=worldAt(9,260),locked=JSON.stringify(previous.locked);previous.working.settings={};
 prepareWorld(previous);assert.equal(previous.working.stage,10);assert.deepEqual(previous.working.settings,DEFAULTS[10]);
 assert.equal(JSON.stringify(previous.locked),locked);
 const early=snapshotThroughStage(w,6);assert.equal(early.locked.length,6);assert.equal(early.working.stage,7);
 assert.doesNotThrow(()=>validateWorld(early));
});
test('corrupt hydrology arrays, lakes, and cyclic drainage routes are rejected',()=>{
 const w=worldAt(10,300);
 const mutations=[
  d=>d.flowTo.pop(),
  d=>d.discharge[0]=NaN,
  d=>d.catchmentArea[2]=-1,
  d=>d.lakeId[3]=999,
  d=>d.outlet[0]=-1,
  d=>{d.flowTo[0]=0;},
  d=>{d.lakes.push({id:0,cells:[99999],areaKm2:1,level:0,maxDepth:1});}
 ];
 for(const mutate of mutations){const broken=structuredClone(w);mutate(broken.locked[9].data);assert.throws(()=>validateWorld(broken),/Invalid hydrology/);}
});
test('hydrology works on ellipse, and default rivers appear on a dense mesh',()=>{
 const w=worldAt(10,1550,{shape:'ellipse',radiusX:850,radiusY:400});
 const h=w.locked[9].data;assert.ok(h.channels.length>0,'at least some rivers');
 assert.doesNotThrow(()=>validateWorld(w));
});
