import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateStage,newWorld} from '../src/engine.js';
import {selectTerrainSource,buildElevationSurface} from '../src/terrain-3d-model.js';
import {selectTerrainAppearance,terrainAppearanceName,terrainMaterialAtSite,buildTerrainSiteColors,sampleTerrainColor} from '../src/terrain-3d-material.js';
import {createTerrainSampler} from '../src/render.js';

function completedWorld(shape,count=260){
 const world=newWorld('Materials test');
 for(let stage=1;stage<=12;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?shape:{}),...(stage===2?{averageArea:world.locked[0].data.areaKm2/count,relaxation:0}:{})};
  world.locked.push({stage,settings,data:generateStage(stage,world.locked,settings)});
 }
 return world;
}

const shapes=[{shape:'rectangle',width:1200,height:700},{shape:'circle',radius:600},{shape:'ellipse',radiusX:800,radiusY:430}];

function buildAt(world,stage){
 const get=n=>world.locked[n-1]?.data;
 const source=selectTerrainSource(stage,get),appearance=selectTerrainAppearance(stage,get);
 return buildElevationSurface(get(1),get(2),source.elevations,()=>{},{seaLevel:source.seaLevel,appearance,
  hydrology:stage>=9?get(9):null,waterMask:stage>=5?get(5).water:null});
}

test('3D appearance follows selected historical stage without leaking later environmental layers',()=>{
 const w=completedWorld(shapes[0]),get=n=>w.locked[n-1]?.data;
 for(let stage=4;stage<=7;stage++)assert.equal(selectTerrainAppearance(stage,get),null);
 const c8=selectTerrainAppearance(8,get),c9=selectTerrainAppearance(9,get),s10=selectTerrainAppearance(10,get),b11=selectTerrainAppearance(11,get),v12=selectTerrainAppearance(12,get);
 assert.ok(c8.climate.meanTemp);
 assert.equal(c8.soils,undefined);assert.equal(c8.biomes,undefined);assert.equal(c8.vegetation,undefined);
 assert.equal(c9.soils,undefined);assert.ok(s10.soils);assert.equal(s10.biomes,undefined);
 assert.ok(b11.biomes);assert.equal(b11.vegetation,undefined);assert.ok(v12.vegetation);
 assert.equal(terrainAppearanceName(8),'Climate');assert.equal(terrainAppearanceName(10),'Soils');
 assert.equal(terrainAppearanceName(11),'Biomes');assert.equal(terrainAppearanceName(12),'Vegetation');
});

test('3D material surfaces are deterministic, normalized and never modify historical data on every shape',()=>{
 for(const shape of shapes){
  const w=completedWorld(shape,230),saved=JSON.stringify(w.locked);
  const plain=buildAt(w,7);
  assert.equal(plain.materialColors,null);
  for(const stage of [8,10,11,12]){
   const a=buildAt(w,stage),b=buildAt(w,stage);
   assert.equal(a.materialColors.length,a.vertexCount*3);
   assert.ok(a.materialColors.every(v=>Number.isFinite(v)&&v>=0&&v<=1),`${shape.shape} stage ${stage}`);
   assert.deepEqual(a.materialColors,b.materialColors);
   assert.deepEqual(a.vertexData,b.vertexData);
   assert.equal(a.vertexData.length,a.vertexCount*7);
   assert.equal(a.hydrology.rivers.length,stage>=9?b.hydrology.rivers.length:0);
  }
  assert.equal(JSON.stringify(w.locked),saved,`${shape.shape}: no mutation`);
 }
});

test('stage transitions materially alter colors without changing elevations',()=>{
 const w=completedWorld(shapes[0]),a=buildAt(w,8),b=buildAt(w,10),c=buildAt(w,11),d=buildAt(w,12);
 assert.deepEqual(a.vertexData,b.vertexData);assert.deepEqual(b.vertexData,c.vertexData);assert.deepEqual(c.vertexData,d.vertexData);
 const changed=(x,y)=>x.reduce((count,v,i)=>count+(Math.abs(v-y[i])>.0001),0);
 assert.ok(changed(a.materialColors,b.materialColors)>100);
 assert.ok(changed(b.materialColors,c.materialColors)>100);
 assert.ok(changed(c.materialColors,d.materialColors)>100);
});

test('continuous color interpolation is finite and stable at sites and points across bisectors',()=>{
 const w=completedWorld(shapes[0]),mesh=w.locked[1].data,appearance=selectTerrainAppearance(12,n=>w.locked[n-1]?.data),sites=buildTerrainSiteColors(mesh,appearance),sampler=createTerrainSampler(mesh,.72);
 const site=mesh.cells[20],neighbor=mesh.cells[site.neighbors[0]];
 assert.ok(site&&neighbor);
 const midX=(site.x+neighbor.x)/2,midY=(site.y+neighbor.y)/2,eps=.0001;
 const left=sampleTerrainColor(sampler,sites,midX-eps,midY),right=sampleTerrainColor(sampler,sites,midX+eps,midY);
 assert.ok(left.every(Number.isFinite));assert.ok(right.every(Number.isFinite));
 assert.ok(Math.max(...left.map((v,i)=>Math.abs(v-right[i])))<.01);
 assert.deepEqual(sampleTerrainColor(sampler,sites,site.x,site.y),sampleTerrainColor(sampler,sites,site.x,site.y));
});

test('bad or mismatched environmental fields fail before GPU upload',()=>{
 const w=completedWorld(shapes[0]),get=n=>w.locked[n-1]?.data,mesh=get(2);
 assert.throws(()=>selectTerrainAppearance(8,n=>n===8?null:get(n)),/climate/);
 assert.throws(()=>selectTerrainAppearance(10,n=>n===10?null:get(n)),/soil/);
 assert.throws(()=>selectTerrainAppearance(11,n=>n===11?null:get(n)),/biome/);
 assert.throws(()=>selectTerrainAppearance(12,n=>n===12?null:get(n)),/vegetation/);
 const bad=structuredClone(selectTerrainAppearance(8,get));bad.climate.meanTemp.pop();
 assert.throws(()=>buildTerrainSiteColors(mesh,bad),/do not match/);
 const badColor=structuredClone(selectTerrainAppearance(12,get));badColor.vegetation.groundCover[0]=NaN;
 assert.throws(()=>terrainMaterialAtSite(badColor,0),/Invalid 3D vegetation/);
});
