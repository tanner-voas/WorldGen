import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateStage} from '../src/engine.js';
import {selectTerrainSource,buildElevationSurface} from '../src/terrain-3d-model.js';

function history(geometry){
 const locked=[];
 for(let stage=1;stage<=9;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?geometry:{})};
  if(stage===2)settings.averageArea=locked[0].data.areaKm2/210;
  locked.push({stage,data:generateStage(stage,locked,settings)});
 }
 return locked.map(row=>row.data);
}

test('3D stage selection uses saved elevation, coastlines, landforms and erosion in order',()=>{
 const layers=history({shape:'rectangle',width:1000,height:650});
 const get=stage=>layers[stage-1];
 for(const [stage,terrainStage] of [[4,4],[5,5],[6,6],[7,7],[8,8],[12,8]]){
  const source=selectTerrainSource(stage,get);
  assert.strictEqual(source.elevations,layers[terrainStage-1].elevations);
  assert.equal(source.terrainStage,terrainStage);
  assert.equal(source.seaLevel,stage===4?0:layers[4].seaLevel);
  assert.equal(source.hasCoast,stage>=5);
  assert.equal(source.usesEarlierTerrain,stage>8);
 }
 assert.throws(()=>selectTerrainSource(3,get),/Elevation/);
 assert.throws(()=>selectTerrainSource(6,n=>n===6?null:get(n)),/Layer 6 terrain is unavailable/);
});

test('3D ocean plane is located at the actual locked sea level on every world shape',()=>{
 const shapes=[{shape:'rectangle',width:1150,height:650},{shape:'circle',radius:530},{shape:'ellipse',radiusX:800,radiusY:350}];
 for(const shape of shapes){
  const layers=history(shape),geometry=layers[0],mesh=layers[1];
  for(const stage of [4,5,6,7]){
   const source=selectTerrainSource(stage,n=>layers[n-1]);
   const before=JSON.stringify(source.elevations);
   const rendered=buildElevationSurface(geometry,mesh,source.elevations,()=>{}, {seaLevel:source.seaLevel});
   assert.equal(JSON.stringify(source.elevations),before,'derived mesh must not rewrite locked data');
   assert.equal(rendered.seaLevel,source.seaLevel);
   for(let i=1;i<rendered.ocean.length;i+=3)assert.ok(Math.abs(rendered.ocean[i]-source.seaLevel*rendered.heightScale)<1e-6);
   assert.ok(rendered.vertexData.every(Number.isFinite));
  }
 }
});

test('invalid stage, missing coastline and nonfinite sea level fail without creating a render',()=>{
 const fake={4:{elevations:[0.2]},5:{elevations:[0.1],seaLevel:.05},6:{elevations:[0.3],seaLevel:0},7:{elevations:[0.4]}};
 assert.throws(()=>selectTerrainSource(5,layer=>layer===5?{elevations:[0.1]}:fake[layer]),/sea level/);
 assert.throws(()=>selectTerrainSource(NaN,layer=>fake[layer]),/Elevation/);
 assert.throws(()=>selectTerrainSource(7,layer=>layer===7?null:fake[layer]),/Layer 7/);
 assert.throws(()=>selectTerrainSource(5,layer=>layer===5?{seaLevel:0.13,water:[1]}:fake[layer]),/Layer 5 terrain is unavailable/);
 const mesh={cells:[{x:0,y:0,poly:[0,0,1,0,1,1,0,1],neighbors:[]}]};
 assert.throws(()=>buildElevationSurface({shape:'rectangle',width:1,height:1},mesh,[0],()=>{},{seaLevel:Infinity}),/sea level/);
});
