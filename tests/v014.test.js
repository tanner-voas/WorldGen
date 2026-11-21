import test from 'node:test';
import assert from 'node:assert/strict';
import {generateGeometry,insideGeometry,DEFAULTS,meshTargetCount,MAX_CELLS,generateMesh,generateStage,cellArea,newWorld,upgradeWorld,validateWorld,snapshotThroughStage,SCHEMA_VERSION} from '../src/engine.js';
const shapes=[
 {shape:'rectangle',width:1200,height:800},
 {shape:'circle',radius:450},
 {shape:'ellipse',radiusX:850,radiusY:240}
];
function staged(shape,meshCount=160,through=7){
 const world=newWorld('Shape verification');
 for(let stage=1;stage<=through;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?shape:{}),...(stage===2?{averageArea:world.locked[0].data.areaKm2/meshCount,relaxation:0}:{})};
  const data=generateStage(stage,world.locked,settings);
  world.locked.push({stage,settings,data});
 }
 world.working={stage:through+1,settings:DEFAULTS[through+1]||{},data:null,dataSettings:null};
 return world;
}
test('geometry describes three 2D shapes with physical distance/area and no depth',()=>{
 const rectangle=generateGeometry(shapes[0]),circle=generateGeometry(shapes[1]),ellipse=generateGeometry(shapes[2]);
 assert.equal(rectangle.areaKm2,960000);
 assert.equal(circle.width,900);assert.equal(circle.height,900);
 assert.ok(Math.abs(circle.areaKm2-Math.PI*450**2)<1e-7);
 assert.equal(ellipse.width,1700);assert.equal(ellipse.height,480);
 assert.ok(Math.abs(ellipse.areaKm2-Math.PI*850*240)<1e-7);
 for(const g of [rectangle,circle,ellipse]){assert.equal(g.depth,0);assert.equal(g.unit,'km');assert.ok(insideGeometry(g.width/2,g.height/2,g));}
 assert.equal(insideGeometry(0,0,circle),false);
 assert.equal(insideGeometry(0,0,rectangle),true);
});
test('rejects unknown shapes and invalid sizes',()=>{
 for(const g of [{shape:'sphere',radius:200},{shape:'circle',radius:0},{shape:'ellipse',radiusX:-10,radiusY:100},{shape:'rectangle',width:100,height:Infinity}])assert.throws(()=>generateGeometry(g));
});
test('Voronoi mesh targets mean geographic polygon area, with safe cell bounds',()=>{
 const g=generateGeometry(shapes[0]);
 assert.equal(meshTargetCount(g,g.areaKm2/175),175);
 assert.equal(meshTargetCount(g,1e20),100);
 assert.equal(meshTargetCount(g,0.001),MAX_CELLS);
 assert.throws(()=>meshTargetCount(g,-1));
});
test('shape-clipped polygons fill circle and ellipse without spilling outside the boundary',()=>{
 for(const shape of shapes){
  const g=generateGeometry(shape),opts={...DEFAULTS[2],averageArea:g.areaKm2/230,relaxation:1,seed:308};
  const a=generateMesh(opts,null,g),b=generateMesh(opts,null,g);
  assert.deepEqual(a,b);assert.equal(a.cells.length,230);
  const computed=a.cells.reduce((sum,c)=>sum+cellArea(c),0);
  assert.ok(Math.abs(computed/g.areaKm2-1)<.001,`${shape.shape}: ${computed/g.areaKm2}`);
  for(const [i,c] of a.cells.entries()){
   assert.ok(insideGeometry(c.x,c.y,g),`${shape.shape} site ${i}`);
   for(let j=0;j<c.poly.length;j+=2)assert.ok(insideGeometry(c.poly[j],c.poly[j+1],g),`${shape.shape} polygon ${i}`);
  }
 }
});
test('geometry and density carry through all seven deterministic stages',()=>{
 for(const shape of shapes){
  const world=staged(shape,130),mesh=world.locked[1].data;
  assert.equal(mesh.cells.length,130);
  assert.equal(world.locked[6].data.elevations.length,130);
  assert.doesNotThrow(()=>validateWorld(world));
  const snapshot=snapshotThroughStage(world,4);
  assert.equal(snapshot.locked.length,4);
  assert.equal(snapshot.locked[0].data.shape,shape.shape);
  assert.equal(snapshot.locked[1].data.cells.length,130);
  assert.doesNotThrow(()=>validateWorld(snapshot));
 }
});
test('cannot import a mismatched mesh or geometrically invalid site',()=>{
 const world=staged(shapes[1],160,2);
 const bad=structuredClone(world);bad.locked[1].data.width++;
 assert.throws(()=>validateWorld(bad),/Invalid world mesh/);
 const badSite=structuredClone(world);badSite.locked[1].data.cells[0].x=-1;
 assert.throws(()=>validateWorld(badSite),/Invalid mesh site/);
});
test('v0.1.3 rectangular legacy save migrates without rerunning or modifying generated arrays',()=>{
 const current=staged(DEFAULTS[1],133);
 const old=structuredClone(current);
 old.schema=1;
 old.locked=old.locked.slice(1).map(r=>({...r,stage:r.stage-1}));
 old.working.stage=7;old.viewStage=6;
 old.locked[0].settings={...DEFAULTS[2],count:133};delete old.locked[0].settings.averageArea;
 const legacyMesh=old.locked[0].data;
 delete legacyMesh.shape;delete legacyMesh.areaKm2;
 const oldArrays=old.locked.slice(1).map(r=>JSON.stringify(r.data));
 const upgraded=upgradeWorld(old);
 assert.equal(upgraded.schema,SCHEMA_VERSION);
 assert.equal(upgraded.locked.length,7);
 assert.equal(upgraded.locked[0].data.shape,'rectangle');
 assert.equal(upgraded.locked[1].data.cells.length,133);
 assert.ok(Math.abs(upgraded.locked[1].settings.averageArea-DEFAULTS[1].width*DEFAULTS[1].height/133)<1e-6);
 assert.deepEqual(upgraded.locked.slice(2).map(r=>JSON.stringify(r.data)),oldArrays);
 assert.doesNotThrow(()=>validateWorld(upgraded));
});
test('legacy v0.1.3 first-layer working preview survives insertion of geometry stage',()=>{
 const source=staged(DEFAULTS[1],120,2);
 const working={schema:1,name:'Unfinished world',created:'2026-11-21',locked:[],working:{stage:1,settings:{...DEFAULTS[2],count:120},data:source.locked[1].data,dataSettings:{...DEFAULTS[2],count:120}},viewStage:1};
 delete working.working.settings.averageArea;
 delete working.working.dataSettings.averageArea;
 const restored=upgradeWorld(working);
 assert.equal(restored.locked.length,1);
 assert.equal(restored.working.stage,2);
 assert.equal(restored.working.data.cells.length,120);
 assert.equal(restored.working.settings.averageArea,DEFAULTS[1].width*DEFAULTS[1].height/120);
 assert.doesNotThrow(()=>validateWorld(restored));
});
test('checkpoint saved through new geometry stage carries sensible next-stage area defaults',()=>{
 const world=staged(shapes[2],120,1);
 const checkpoint=snapshotThroughStage(world,1);
 assert.equal(checkpoint.locked.length,1);
 assert.equal(checkpoint.working.stage,2);
 assert.equal(checkpoint.working.settings.averageArea,checkpoint.locked[0].data.areaKm2/1200);
 assert.equal(meshTargetCount(checkpoint.locked[0].data,checkpoint.working.settings.averageArea),1200);
 assert.doesNotThrow(()=>validateWorld(checkpoint));
});
