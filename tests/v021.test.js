import test from 'node:test';
import assert from 'node:assert/strict';
import {generateStage,newWorld,DEFAULTS} from '../src/engine.js';
import {terrainHeightScale,buildHydrologySurface,buildElevationSurface,selectTerrainSource} from '../src/terrain-3d-model.js';

function worldAtHydrology(shape,count=340){
 const world=newWorld('3D water regression');
 for(let stage=1;stage<=9;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?shape:{}),...(stage===2?{averageArea:world.locked[0].data.areaKm2/count,relaxation:0}:{})};
  world.locked.push({stage,settings,data:generateStage(stage,world.locked,settings)});
 }
 return world;
}
const shapes=[{shape:'rectangle',width:1650,height:880},{shape:'circle',radius:710},{shape:'ellipse',radiusX:1200,radiusY:560}];

test('3D river geometry is finite, deterministic, and derived without rewriting saves for all shapes',()=>{
 for(const shape of shapes){
  const world=worldAtHydrology(shape,430);
  const geom=world.locked[0].data,mesh=world.locked[1].data,coast=world.locked[4].data,erosion=world.locked[6].data,hydro=world.locked[8].data;
  const frozen=JSON.stringify(world.locked);
  const first=buildElevationSurface(geom,mesh,erosion.elevations,()=>{},{seaLevel:coast.seaLevel,hydrology:hydro,waterMask:coast.water});
  const second=buildElevationSurface(geom,mesh,erosion.elevations,()=>{},{seaLevel:coast.seaLevel,hydrology:hydro,waterMask:coast.water});
  assert.equal(first.hydrology.rivers.length%9,0);
  assert.equal(first.hydrology.lakes.length%9,0);
  assert.ok(first.hydrology.rivers.every(Number.isFinite));
  assert.ok(first.hydrology.lakes.every(Number.isFinite));
  assert.deepEqual(first.hydrology.rivers,second.hydrology.rivers);
  assert.deepEqual(first.hydrology.lakes,second.hydrology.lakes);
  assert.equal(JSON.stringify(world.locked),frozen);
  assert.ok(first.hydrology.riverSegments>0,`${shape.shape}: expected a generated river`);
 }
});

test('3D water remains absent from earlier terrain stages and absent when hydrology is omitted',()=>{
 const world=worldAtHydrology(shapes[0],300),get=stage=>world.locked[stage-1]?.data;
 const terrain4=selectTerrainSource(4,get),terrain8=selectTerrainSource(8,get),terrain9=selectTerrainSource(9,get);
 assert.equal(terrain4.terrainStage,4);
 assert.equal(terrain8.terrainStage,7);
 assert.equal(terrain9.terrainStage,7);
 const empty=buildElevationSurface(get(1),get(2),get(7).elevations,()=>{},{seaLevel:get(5).seaLevel});
 assert.equal(empty.hydrology.rivers.length,0);
 assert.equal(empty.hydrology.lakes.length,0);
});

test('3D water creates finite lake geometry at the locked spill elevation',()=>{
 const cells=Array.from({length:4},(_,i)=>({x:i+.5,y:.5,poly:[i,0,i+1,0,i+1,1,i,1],neighbors:[i-1,i+1].filter(j=>j>=0&&j<4)}));
 const mesh={width:4,height:1,areaKm2:4,cells};
 const shape={shape:'rectangle',width:4,height:1};
 const elevation=[-1,.5,.1,.7],hydrology={
  channels:[2,3],flowTo:[-1,0,1,2],discharge:[0,1,2,3],lakeId:[-1,-1,0,-1],
  lakes:[{id:0,cells:[2],level:.5,maxDepth:.4,areaKm2:1}],summary:{maxDischarge:3}
 };
 const a=buildHydrologySurface(shape,mesh,elevation,hydrology,{waterMask:[1,0,0,0],worldScale:1});
 assert.equal(a.lakeCells,1);
 assert.equal(a.lakes.length,4*3*3);
 assert.ok(a.rivers.length>0);
 for(let i=1;i<a.lakes.length;i+=3)assert.ok(Math.abs(a.lakes[i]-(.5*terrainHeightScale(shape)+Math.max(.0002,terrainHeightScale(shape)*.018)))<1e-6);
 assert.ok(a.rivers.every(Number.isFinite));
 assert.ok(a.lakes.every(Number.isFinite));
});

test('3D water rejects a mismatched saved hydrology record rather than silently drawing wrong features',()=>{
 const mesh={width:4,height:1,areaKm2:4,cells:[{x:2,y:.5,poly:[0,0,4,0,4,1,0,1],neighbors:[]}]};
 assert.throws(()=>buildHydrologySurface({shape:'rectangle',width:4,height:1},mesh,[.2],{channels:[],flowTo:[],discharge:[],lakeId:[],lakes:[]}),/does not match/);
});
