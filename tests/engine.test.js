import test from 'node:test';
import assert from 'node:assert/strict';
import {generateMesh,generateStage,DEFAULTS,newWorld,validateWorld,generatePlates,generateElevation,generateCoasts,WORLD_WIDTH,WORLD_HEIGHT} from '../src/engine.js';
const settings={...DEFAULTS[1],count:150,relaxation:1,seed:11};
let mesh;
test('Voronoi mesh is deterministic with symmetric topology and bounded polygons',()=>{
 mesh=generateMesh(settings);
 assert.equal(mesh.cells.length,150);
 assert.deepEqual(mesh,generateMesh(settings));
 for(const [i,c] of mesh.cells.entries()){
  assert.ok(c.poly.length>=6&&c.poly.length%2===0);
  assert.ok(c.neighbors.length>=2);
  for(let j=0;j<c.poly.length;j+=2){assert.ok(c.poly[j]>=-1e-5&&c.poly[j]<=WORLD_WIDTH+1e-5);assert.ok(c.poly[j+1]>=-1e-5&&c.poly[j+1]<=WORLD_HEIGHT+1e-5);}
  for(const neighbor of c.neighbors)assert.ok(mesh.cells[neighbor].neighbors.includes(i),`Asymmetric neighbors ${i}/${neighbor}`);
 }
});
test('supports all three placement distributions and zero relaxations',()=>{
 for(const distribution of ['random','jittered','clustered']){
  const data=generateMesh({...settings,distribution,relaxation:0});
  assert.equal(data.cells.length,150);
  for(const c of data.cells)assert.ok(c.neighbors.length>0);
 }
});
test('four stages build a complete deterministic world with valid land fraction',()=>{
 const w=newWorld('Test world');w.working.settings=settings;
 for(let stage=1;stage<=4;stage++){
  const data=generateStage(stage,w.locked,stage===1?settings:DEFAULTS[stage]);
  w.locked.push({stage,settings:stage===1?settings:DEFAULTS[stage],data});
 }
 const sea=w.locked[3].data;
 assert.equal(sea.water.length,150);
 assert.ok(Math.abs(sea.landFraction-DEFAULTS[4].land)<.02);
 assert.ok(w.locked[1].data.plates.length>=3);
 assert.equal(w.locked[2].data.elevations.length,150);
 const json=JSON.stringify(w),copy=JSON.parse(json);
 copy.working={stage:5,settings:{},data:null};
 assert.doesNotThrow(()=>validateWorld(copy));
 assert.deepEqual(copy.locked,w.locked);
});
test('validation rejects missing, out-of-order or unsupported stages',()=>{
 assert.throws(()=>validateWorld({schema:2,locked:[]}));
 const w=newWorld();w.locked=[{stage:2,data:{}}];w.working.stage=2;
 assert.throws(()=>validateWorld(w));
});
