import test from 'node:test';
import assert from 'node:assert/strict';
import {rasterize} from '../src/raster.js';
import {createTerrainSampler,defaultRenderSettings,rasterDimensions,riverShorePoint} from '../src/render.js';

const cells=Array.from({length:9},(_,i)=>{
 const x=i%3,y=Math.floor(i/3);
 return {x:x+.5,y:y+.5,poly:[x,y,x+1,y,x+1,y+1,x,y+1]};
});
const mesh={width:3,height:3,shape:'rectangle',areaKm2:9,cells};
const state={mesh,elevations:cells.map((_,i)=>i===4?.5:-.5),water:cells.map((_,i)=>i!==4),
 seaLevel:0,maxLand:.5,minWater:-.5,avgRadius:Math.sqrt(1/Math.PI)};
const settings={...defaultRenderSettings(5),relief:0};
const job={geometry:mesh,width:45,height:45,state,settings};

test('a single-cell island survives broad blending in the exported pixels',async()=>{
 const data=await rasterize(job,()=>{});
 const rgb=(x,y)=>Array.from(data.slice(4*(y*45+x),4*(y*45+x)+3));
 const [r,,b]=rgb(22,22);
 assert.ok(r>b,'center of island should have land color');
 for(const [x,y] of [[7,7],[37,22],[7,37]]){
  const [red,,blue]=rgb(x,y);assert.ok(blue>red,'neighbor should retain ocean color');
 }
 assert.deepEqual(await rasterize(job,()=>{}),data);
});

test('river mouths and lake outlets end on the interpolated shore between sites',()=>{
 const sampler=createTerrainSampler(mesh);
 const lakes=cells.map(()=>-1);
 const mouth=riverShorePoint(sampler,state.water,lakes,4,5,1,.72);
 assert.ok(mouth.x>1.6&&mouth.x<2.4);
 assert.equal(mouth.y,1.5);
 lakes[5]=0;
 const bank=riverShorePoint(sampler,cells.map(()=>false),lakes,4,5,1,.72);
 assert.ok(bank.x>1.6&&bank.x<2.4);
 assert.equal(bank.y,1.5);
});

test('sample budgets preserve portrait/landscape symmetry and thin dimensions',()=>{
 for(const detail of ['preview','standard','high','ultra']){
  for(const [width,height] of [[4096,4096],[3072,1536],[4096,10]]){
   const a=rasterDimensions({width,height},detail),b=rasterDimensions({width:height,height:width},detail);
   assert.equal(a.width,b.height);assert.equal(a.height,b.width);
   assert.ok(a.width*a.height<=(detail==='ultra'?1250000:detail==='high'?900000:600000));
   assert.ok(a.width<=width&&a.height<=height);
   if(height===10)assert.equal(a.height,10);
  }
 }
});

test('change pixels preserve sign, neutral and symmetric saturation',async()=>{
 async function color(delta){
  const deltas=cells.map(()=>delta);
  const data=await rasterize({...job,state:{mesh,deltas},settings:{...settings,mode:'change'}},()=>{});
  return Array.from(data.slice(4*100,4*100+3));
 }
 assert.deepEqual(await color(0),[228,225,211]);
 assert.deepEqual(await color(-.1),[165,72,36]);
 assert.deepEqual(await color(.1),[27,112,119]);
 assert.deepEqual(await color(.5),await color(.1));
});

test('contours darken land slopes and leave open water and flat plateaus clear',async()=>{
 const rendered=(z,water,contours)=>rasterize({...job,state:{...state,elevations:z,water},settings:{...settings,contours}},()=>{});
 const land=cells.map(()=>false),sea=cells.map(()=>true);
 const rising=cells.map(c=>c.x*.2);
 const base=await rendered(rising,land,0),lines=await rendered(rising,land,.1);
 assert.ok(lines.some((v,i)=>v<base[i]));
 assert.ok(lines.every((v,i)=>v<=base[i]));
 assert.deepEqual(await rendered(rising,sea,.1),await rendered(rising,sea,0));
 const flat=cells.map(()=>.2);
 assert.deepEqual(await rendered(flat,land,.1),await rendered(flat,land,0));
});
