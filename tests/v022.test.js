import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateStage,newWorld} from '../src/engine.js';
import {selectTerrainSource,buildElevationSurface} from '../src/terrain-3d-model.js';
import {selectTerrainAppearance,terrainAppearanceName,terrainMaterialAtSite,buildTerrainSiteColors,sampleTerrainColor} from '../src/terrain-3d-material.js';
import {createTerrainSampler} from '../src/terrain-sampler.js';

function completedWorld(shape,count=260){
 const world=newWorld('Materials test');
 for(let stage=1;stage<=13;stage++){
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
  hydrology:stage>=10?get(10):null,waterMask:stage>=6?get(6).water:null,includeUniformLevels:false});
}

test('3D appearance follows selected historical stage without leaking later environmental layers',()=>{
 const w=completedWorld(shapes[0]),get=n=>w.locked[n-1]?.data;
 for(let stage=4;stage<=8;stage++)assert.equal(selectTerrainAppearance(stage,get),null);
 const c8=selectTerrainAppearance(9,get),c9=selectTerrainAppearance(10,get),s10=selectTerrainAppearance(11,get),b11=selectTerrainAppearance(12,get),v12=selectTerrainAppearance(13,get);
 assert.ok(c8.climate.meanTemp);
 assert.equal(c8.soils,undefined);assert.equal(c8.biomes,undefined);assert.equal(c8.vegetation,undefined);
 assert.equal(c9.soils,undefined);assert.ok(s10.soils);assert.equal(s10.biomes,undefined);
 assert.ok(b11.biomes);assert.equal(b11.vegetation,undefined);assert.ok(v12.vegetation);
 assert.equal(terrainAppearanceName(9),'Climate');assert.equal(terrainAppearanceName(11),'Soils');
 assert.equal(terrainAppearanceName(12),'Biomes');assert.equal(terrainAppearanceName(13),'Vegetation');
});

test('3D materials are finite and deterministic for climate and vegetation stages',()=>{
 const w=completedWorld(shapes[0],120),saved=JSON.stringify(w.locked),mesh=w.locked[1].data;
 const plain=buildAt(w,7);assert.equal(plain.materialColors,null);
 for(const stage of [9,13]){
  const appearance=selectTerrainAppearance(stage,n=>w.locked[n-1]?.data);
  const a=buildTerrainSiteColors(mesh,appearance),b=buildTerrainSiteColors(mesh,appearance);
  assert.deepEqual(a,b);
  assert.ok(a.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
 }
 const decorated=buildAt(w,13);
 assert.equal(decorated.materialColors.length,decorated.vertexCount*3);
 assert.equal(decorated.vertexData.length,decorated.vertexCount*7);
 assert.ok(decorated.materialColors.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
 assert.equal(JSON.stringify(w.locked),saved);
});

test('climate, soils, biomes and vegetation materially change site colors without rewriting terrain',()=>{
 const w=completedWorld(shapes[0],130),get=n=>w.locked[n-1]?.data,mesh=get(2);
 const raw=JSON.stringify(w.locked);
 const colors=[9,11,12,13].map(stage=>buildTerrainSiteColors(mesh,selectTerrainAppearance(stage,get)));
 const changed=(x,y)=>x.reduce((count,v,i)=>count+(Math.abs(v-y[i])>.0001),0);
 for(let i=1;i<colors.length;i++)assert.ok(changed(colors[i-1],colors[i])>10);
 assert.equal(JSON.stringify(w.locked),raw);
});

test('continuous color interpolation is finite and stable at sites and points across bisectors',()=>{
 const w=completedWorld(shapes[0]),mesh=w.locked[1].data,appearance=selectTerrainAppearance(13,n=>w.locked[n-1]?.data),sites=buildTerrainSiteColors(mesh,appearance),sampler=createTerrainSampler(mesh,.72);
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
 assert.throws(()=>selectTerrainAppearance(9,n=>n===9?null:get(n)),/climate/);
 assert.throws(()=>selectTerrainAppearance(13,n=>n===11?null:get(n)),/soil/);
 assert.throws(()=>selectTerrainAppearance(13,n=>n===12?null:get(n)),/biome/);
 assert.throws(()=>selectTerrainAppearance(13,n=>n===13?null:get(n)),/vegetation/);
 const bad=structuredClone(selectTerrainAppearance(9,get));bad.climate.meanTemp.pop();
 assert.throws(()=>buildTerrainSiteColors(mesh,bad),/do not match/);
 const badColor=structuredClone(selectTerrainAppearance(13,get));badColor.vegetation.groundCover[0]=NaN;
 assert.throws(()=>terrainMaterialAtSite(badColor,0),/Invalid 3D vegetation/);
});
