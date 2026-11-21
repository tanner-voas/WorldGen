import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,IMPLEMENTED,newWorld,generateStage,generateCoasts,generateClimate,cellArea,snapshotThroughStage,validateWorld,upgradeWorld} from '../src/engine.js';
const shapes=[{shape:'rectangle',width:1200,height:900},{shape:'circle',radius:520},{shape:'ellipse',radiusX:820,radiusY:390}];
function worldWithClimate(shape=shapes[0],count=270){
 const world=newWorld('Climate migration');
 for(let stage=1;stage<=8;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?shape:{}),...(stage===2?{averageArea:world.locked[0].data.areaKm2/count,relaxation:0,seed:7289}:{})};
  const data=generateStage(stage,world.locked,settings);
  world.locked.push({stage,settings,data});
 }
 world.working={stage:9,settings:{},data:null,dataSettings:null};return world;
}
function distanceToRect(x,y,mesh){return Math.min(x,mesh.width-x,y,mesh.height-y);}
test('stage 8 is climate; its weather arrays are deterministic and respect earlier locks',()=>{
 assert.ok(IMPLEMENTED>=8);
 const world=worldWithClimate(),before=JSON.stringify(world.locked.slice(0,7));
 const c=world.locked[7].data,mesh=world.locked[1].data;
 const rebuilt=generateStage(8,world.locked.slice(0,7),DEFAULTS[8]);
 assert.deepEqual(c,rebuilt);assert.equal(c.meanTemp.length,mesh.cells.length);
 assert.ok(Math.max(...c.meanTemp)-Math.min(...c.meanTemp)>15,'variation in climate');
 assert.ok(Math.max(...c.precipitation)-Math.min(...c.precipitation)>100,'variation in precipitation');
 assert.equal(JSON.stringify(world.locked.slice(0,7)),before,'terrain, drainage and water immutable');
 assert.doesNotThrow(()=>validateWorld(world));
});
test('broad continental setback moves land inward with coastal coverage preserved',()=>{
 for(const shape of shapes){
  const world=worldWithClimate(shape,260),mesh=world.locked[1].data,heights=world.locked[3].data;
  const base=generateCoasts(heights,{...DEFAULTS[5],setbackStrength:0},mesh);
  const coast=generateCoasts(heights,DEFAULTS[5],mesh);
  assert.ok(coast.edgeWaterCells>0);assert.ok(coast.retreatWidthKm>coast.edgeWidthKm);
  const maxArea=Math.max(...mesh.cells.map(cellArea)),totalArea=mesh.cells.reduce((sum,c)=>sum+cellArea(c),0);
  assert.ok(Math.abs(coast.landAreaFraction-DEFAULTS[5].land)<=maxArea/totalArea+.0001);
  assert.deepEqual(heights.elevations,world.locked[3].data.elevations);
  const near=mesh.cells.findIndex(c=>shape.shape==='rectangle'?distanceToRect(c.x,c.y,mesh)<coast.retreatWidthKm*.5:Math.hypot(c.x-mesh.width/2,c.y-mesh.height/2)>Math.min(mesh.width,mesh.height)*.26);
  assert.ok(near>=0);assert.ok(coast.elevations[near]<=base.elevations[near]);
 }
});
test('wide setback does not modify deep interior heights',()=>{
 const world=worldWithClimate(shapes[0],340),mesh=world.locked[1].data,h=world.locked[3].data;
 const coast=generateCoasts(h,DEFAULTS[5],mesh);
 let deep=0;
 for(let i=0;i<mesh.cells.length;i++)if(distanceToRect(mesh.cells[i].x,mesh.cells[i].y,mesh)>coast.retreatWidthKm+2){
  deep++;assert.equal(coast.elevations[i],h.elevations[i]);
 }
 assert.ok(deep>0.4*mesh.cells.length,'large central part of the world stays untouched');
});
test('tilt zero produces January and July same temperature; northern and southern seasons reverse',()=>{
 const w=worldWithClimate(shapes[0],200),mesh=w.locked[1].data,coast=w.locked[4].data,erosion=w.locked[6].data;
 const noTilt=generateClimate(mesh,coast,erosion,{...DEFAULTS[8],axialTilt:0});
 assert.deepEqual(noTilt.janTemp,noTilt.julTemp);
 const c=w.locked[7].data;
 const north=mesh.cells.findIndex(cell=>cell.y<mesh.height*.25);
 const south=mesh.cells.findIndex(cell=>cell.y>mesh.height*.75);
 assert.ok(c.julTemp[north]>c.janTemp[north]);
 assert.ok(c.janTemp[south]>c.julTemp[south]);
});
test('climate checkpoint is complete and survives export-style JSON roundtrip',()=>{
 const w=worldWithClimate(shapes[2],180),snap=snapshotThroughStage(w,8);
 assert.equal(snap.locked.length,8);assert.equal(snap.working.stage,9);
 const imported=upgradeWorld(JSON.parse(JSON.stringify(snap)));
 assert.deepEqual(imported.locked[7].data,w.locked[7].data);
 assert.doesNotThrow(()=>validateWorld(imported));
});
test('older fully locked erosion world moves to new editable climate stage',()=>{
 const world=worldWithClimate(shapes[0],180);
 world.locked.pop();world.working={stage:8,settings:{},data:null,dataSettings:null};
 const previous=JSON.stringify(world.locked);
 upgradeWorld(world);
 assert.deepEqual(world.working.settings,DEFAULTS[8]);
 assert.equal(JSON.stringify(world.locked),previous);
});
test('reject invalid or missing climate fields in imported save',()=>{
 const world=worldWithClimate(shapes[0],180);
 for(const mutate of [d=>d.meanTemp[0]=Infinity,d=>d.precipitation.pop(),d=>d.moisture[0]=-1,d=>delete d.summary]){
  const invalid=structuredClone(world);mutate(invalid.locked[7].data);
  assert.throws(()=>validateWorld(invalid),/Invalid climate/);
 }
});
