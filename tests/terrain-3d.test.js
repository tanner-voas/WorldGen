import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateStage} from '../src/engine.js';
import {ELEVATION_RENDER_STAGE,buildElevationSurface,terrainGridSize,sampleElevation} from '../src/terrain-3d-model.js';
import {createTerrainSampler} from '../src/terrain-sampler.js';
import {meshLod,lookAtMatrix,multiplyMatrices,perspectiveMatrix} from '../src/terrain-3d.js';

const worldAtElevation=(geometry)=>{
 const locked=[];
 for(let stage=1;stage<=4;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?geometry:{})};
  if(stage===2)settings.averageArea=locked[0].data.areaKm2/250;
  locked.push({stage,data:generateStage(stage,locked,settings)});
 }
 return locked.map(row=>row.data);
};

test('elevation is the first 3D-renderable generation stage',()=>{
 assert.equal(ELEVATION_RENDER_STAGE,4);
 assert.equal(meshLod(20),8);
 assert.equal(meshLod(13),4);
 assert.equal(meshLod(7),2);
 assert.equal(meshLod(2),1);
});

test('a real 3D mesh can be prepared without altering source elevations',()=>{
 for(const dimensions of [
  {shape:'rectangle',width:1400,height:700},
  {shape:'circle',radius:660},
  {shape:'ellipse',radiusX:850,radiusY:390}
 ]){
  const [geometry,mesh,,elevation]=worldAtElevation(dimensions);
  const snapshot=JSON.stringify(elevation);
  const surface=buildElevationSurface(geometry,mesh,elevation.elevations);
  assert.equal(snapshot,JSON.stringify(elevation));
  assert.equal(surface.vertexData.length,surface.vertexCount*7);
  assert.ok(surface.vertexCount>1000&&surface.vertexCount<120000);
  assert.equal(surface.levels.length,4);
  const counts=surface.levels.map(l=>l.indices.length);
  assert.ok(counts.every((n,i)=>n>0&&(i===0||n<counts[i-1])));
  for(const level of surface.levels){
   assert.ok(level.indices.every(i=>i<surface.vertexCount));
  }
  for(let index=0;index<surface.vertexData.length;index+=7){
   assert.ok(Number.isFinite(surface.vertexData[index+1]));
   const normal=surface.vertexData.slice(index+3,index+6);
   assert.ok(Math.abs(Math.hypot(...normal)-1)<0.001);
   assert.ok(normal[1]>0);
  }
  assert.ok(surface.ocean.length>=18);
 }
});

test('interpolation is deterministic and smooth at a source site',()=>{
 const [geometry,mesh,,elevation]=worldAtElevation({shape:'rectangle',width:800,height:500});
 const sampler=createTerrainSampler(mesh,.72);
 const site=mesh.cells[25];
 const a=sampleElevation(sampler,elevation.elevations,site.x,site.y);
 const b=sampleElevation(sampler,elevation.elevations,site.x,site.y);
 assert.equal(a,b);
 assert.ok(Math.abs(a-elevation.elevations[25])<.75);
 const neighbour=sampleElevation(sampler,elevation.elevations,site.x+.0001,site.y+.0001);
 assert.ok(Math.abs(a-neighbour)<.002,'heightfield must remain smooth through source sites');
 assert.deepEqual(terrainGridSize(geometry,mesh.cells.length),terrainGridSize(geometry,mesh.cells.length));
});

test('view and projection matrices transform the camera target to the origin',()=>{
 const eye=[1,6,7],target=[0,0,0];
 const view=lookAtMatrix(eye,target),projection=perspectiveMatrix(.78,1.4,.05,100);
 const vp=multiplyMatrices(projection,view);
 assert.equal(view.length,16);assert.equal(vp.length,16);
 assert.ok(vp.every(Number.isFinite));
 const projected=[vp[12],vp[13],vp[14],vp[15]];
 assert.ok(Math.abs(projected[0])<1e-6);
 assert.ok(Math.abs(projected[1])<1e-6);
 assert.ok(projected[3]>0);
});
