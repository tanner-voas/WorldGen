import test from 'node:test';
import assert from 'node:assert/strict';
import {Terrain3DViewer} from '../src/terrain-3d.js';
import {DEFAULTS,generateStage} from '../src/engine.js';
import {buildElevationSurface,buildFocusedTerrainPatch,sampleElevation,sampleTerrainFields} from '../src/terrain-3d-model.js';
import {closeUpCameraLimits,focusedTerrainTiles} from '../src/terrain-3d-detail.js';
import {stableLodStepForDistance,adaptiveTileLod} from '../src/terrain-3d-lod.js';
import {createTerrainSampler,nearestTerrainSite} from '../src/terrain-sampler.js';
import {buildTerrainSiteColors,sampleTerrainColor} from '../src/terrain-3d-material.js';
import {readFileSync} from 'node:fs';

function makeWorld(){
 const locked=[];
 for(let stage=1;stage<=4;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?{shape:'rectangle',width:800,height:500}:{}),
   ...(stage===2?{averageArea:locked[0].data.areaKm2/280}:{})};
  locked.push({stage,data:generateStage(stage,locked,settings)});
 }
 return locked.map(record=>record.data);
}
const gl={ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,STATIC_DRAW:35044,FLOAT:5126,
 createVertexArray:()=>({}),createBuffer:()=>({}),bindVertexArray(){},bindBuffer(){},
 bufferData(){},enableVertexAttribArray(){},vertexAttribPointer(){},disableVertexAttribArray(){},
 vertexAttrib3f(){},deleteBuffer(){},deleteVertexArray(){}};
function harness(world){
 const [geometry,mesh,,elevation]=world;
 const surface=buildElevationSurface(geometry,mesh,elevation.elevations);
 const viewer=Object.create(Terrain3DViewer.prototype);
 Object.assign(viewer,{surface,detailSource:{geometry,mesh,elevations:elevation.elevations,appearance:null},
  detailLimits:closeUpCameraLimits(surface.siteSpacing),distance:.07,target:[0,0,0],
  detailWorker:null,detailState:null,detailSignature:'',detailPatches:new Map(),activeDetailIds:new Set(),
  gl,lost:false,disposed:false,drawSoon(){},onStatus(){}});
 return viewer;
}

test('focused patch sampler/material context is reusable and yields identical geometry',()=>{
 const [geometry,mesh,,elevation]=makeWorld();
 const surface=buildElevationSurface(geometry,mesh,elevation.elevations);
 const tile=focusedTerrainTiles(surface,[0,0,0])[0];
 assert.ok(tile);
 const old=buildFocusedTerrainPatch(geometry,mesh,elevation.elevations,surface,tile,{subdivisions:3});
 const prepared={subdivisions:3,sampler:createTerrainSampler(mesh,.72),sourceColors:buildTerrainSiteColors(mesh,null)};
 const next=buildFocusedTerrainPatch(geometry,mesh,elevation.elevations,surface,tile,prepared);
 assert.deepEqual(next.indices,old.indices);
 assert.deepEqual(next.vertexData,old.vertexData);
 assert.deepEqual(next.materialColors,old.materialColors);
});

test('detail worker initializes source once, coalesces camera movement and ignores stale mesh',()=>{
 const viewer=harness(makeWorld());
 let workerCount=0,sourceSends=0,detailSends=0;
 class WorkerStub{
  constructor(){workerCount++;this.messages=[];this.terminated=false;}
  postMessage(data){
   this.messages.push(data);
   if(data.kind==='init-detail')sourceSends++;
   else if(data.kind==='detail')detailSends++;
  }
  finishReady(){this.onmessage({data:{kind:'detail-ready'}});}
  finishDetail(){
   const data=this.messages.at(-1);
   assert.equal(data.kind,'detail');
   const {geometry,mesh,elevations,appearance,grid}=this.messages[0];
   const patches=data.tiles.map(tile=>buildFocusedTerrainPatch(geometry,mesh,elevations,grid,tile,{appearance,subdivisions:tile.subdivisions}));
   this.onmessage({data:{kind:'detail',key:data.key,patches}});
  }
  terminate(){this.terminated=true;}
 }
 const prev=globalThis.Worker;globalThis.Worker=WorkerStub;
 try{
  viewer._requestFocusedDetail();
  const worker=viewer.detailWorker;
  assert.equal(sourceSends,1);assert.equal(detailSends,0);
  worker.finishReady();assert.equal(detailSends,1);
  const firstKey=viewer.detailSignature;
  viewer.target=[viewer.surface.planeWidth*.18,0,0];
  viewer._requestFocusedDetail();
  viewer.target=[viewer.surface.planeWidth*.4,0,viewer.surface.planeDepth*.2];
  viewer._requestFocusedDetail();
  const lastKey=viewer.detailSignature;
  assert.notEqual(firstKey,lastKey);
  assert.equal(detailSends,1,'worker must not queue intermediate requests');
  worker.finishDetail();
  assert.equal(detailSends,2,'when stale result arrives, dispatch only latest region');
  assert.equal(viewer.detailPatches.size,0,'stale geometry must not reach GPU');
  const latestRequest=worker.messages.at(-1);
  assert.deepEqual(Object.keys(latestRequest).sort(),['key','kind','tiles']);
  worker.finishDetail();
  assert.ok(viewer.detailPatches.size>0);
  assert.equal(workerCount,1);assert.equal(sourceSends,1);
  viewer.distance=15;viewer._requestFocusedDetail();
  assert.equal(worker.terminated,true);
  assert.equal(viewer.detailPatches.size,0);
 }finally{if(prev===undefined)delete globalThis.Worker;else globalThis.Worker=prev;}
});

test('pending initial world build rejects on disposal rather than leaking an unresolved promise',async()=>{
 const [geometry,mesh,,elevation]=makeWorld();
 let worker;
 class WorkerStub{
  constructor(){worker=this;this.terminated=false;}
  postMessage(){} // never responds
  terminate(){this.terminated=true;}
 }
 const prev=globalThis.Worker;globalThis.Worker=WorkerStub;
 const viewer=Object.create(Terrain3DViewer.prototype);
 Object.assign(viewer,{disposed:false,worker:null,detailWorker:null,detailPatches:new Map(),
  activeDetailIds:new Set(),pendingFrame:0,canvas:{removeEventListener(){}},onStatus(){}});
 try{
  const pending=viewer.initialize(geometry,mesh,elevation.elevations);
  assert.ok(viewer.cancelInitialization);
  viewer.dispose();
  await assert.rejects(pending,error=>error.name==='AbortError');
  assert.equal(worker.terminated,true);
  assert.equal(viewer.worker,null);
  assert.equal(viewer.cancelInitialization,null);
 }finally{if(prev===undefined)delete globalThis.Worker;else globalThis.Worker=prev;}
});

test('worker retains one immutable sampler context for repeated tile requests',()=>{
 const worker=readFileSync(new URL('../src/terrain-3d-worker.js',import.meta.url),'utf8');
 assert.match(worker,/data\.kind==='init-detail'/);
 assert.match(worker,/detailContext=\{/);
 assert.match(worker,/createSurfaceSampler\(mesh,elevations,\{waterMask,seaLevel,hydrology\}\)/);
 assert.match(worker,/data\.kind==='detail'/);
 assert.match(worker,/detailContext/);
});

test('indexed nearest-site search agrees with exhaustive scan, including sparse curved-world corners',()=>{
 const sites=[];
 for(let i=0;i<1801;i++){
  const angle=i*2.399963229728653;
  const radius=Math.sqrt((i+.5)/1800);
  sites.push({x:500+400*radius*Math.cos(angle),y:300+280*radius*Math.sin(angle)});
 }
 const sampler=createTerrainSampler({width:1000,height:600,areaKm2:600000,cells:sites});
 for(let k=0;k<220;k++){
  const x=k%5===0?0:(k*191)%1001,y=k%7===0?600:(k*83)%601;
  let distance=Infinity,best=-1;
  for(let i=0;i<sites.length;i++){
   const site=sites[i],d=(site.x-x)**2+(site.y-y)**2;
   if(d<distance){distance=d;best=i;}
  }
  assert.equal(nearestTerrainSite(sampler,x,y),best,`nearest mismatch at (${x}, ${y})`);
 }
});


test('LOD selection has distance hysteresis but preserves original initial thresholds',()=>{
 assert.equal(stableLodStepForDistance(5.2,null),2);
 assert.equal(stableLodStepForDistance(5.2,1),1);
 assert.equal(stableLodStepForDistance(5.2,2),2);
 assert.equal(stableLodStepForDistance(5.8,1),2);
 assert.equal(stableLodStepForDistance(4.8,2),2);
 assert.equal(stableLodStepForDistance(4.2,2),1);
 assert.equal(stableLodStepForDistance(12.4,2),4);
 assert.equal(stableLodStepForDistance(9.6,4),2);
 const tile={x:0,z:0};
 assert.equal(adaptiveTileLod([0,5.2,0],tile,0,1),1);
 assert.equal(adaptiveTileLod([0,5.8,0],tile,0,1),2);
 assert.equal(stableLodStepForDistance(32,1),8,'large jumps should catch up in one draw');
});

test('actual 3D worker module accepts one world initialization and multiple compact tile requests',async()=>{
 const [geometry,mesh,,elevation]=makeWorld();
 const surface=buildElevationSurface(geometry,mesh,elevation.elevations);
 const tile=focusedTerrainTiles(surface,[0,0,0])[0];
 const original=globalThis.self,messages=[];
 globalThis.self={postMessage:(data,transfer)=>messages.push({data,transfer})};
 try{
  await import('../src/terrain-3d-worker.js?integration-v028');
  const grid={cols:surface.cols,rows:surface.rows,planeWidth:surface.planeWidth,
   planeDepth:surface.planeDepth,heightScale:surface.heightScale};
  const rawElevations=Array.from(elevation.elevations);
  globalThis.self.onmessage({data:{kind:'init-detail',geometry,mesh,elevations:elevation.elevations,
   appearance:null,grid}});
  assert.equal(messages.at(-1).data.kind,'detail-ready');
  globalThis.self.onmessage({data:{kind:'detail',key:'first',tiles:[tile]}});
  const first=messages.at(-1);
  assert.equal(first.data.kind,'detail');assert.equal(first.data.key,'first');
  assert.ok(first.data.patches[0].indices.length>0);
  assert.ok(first.transfer.includes(first.data.patches[0].indices.buffer));
  globalThis.self.onmessage({data:{kind:'detail',key:'second',tiles:[tile]}});
  assert.equal(messages.at(-1).data.key,'second');
  assert.deepEqual(messages.at(-1).data.patches[0].vertexData,first.data.patches[0].vertexData);
  assert.deepEqual(Array.from(elevation.elevations),rawElevations,'read-only worker must not mutate world data');
 }finally{if(original===undefined)delete globalThis.self;else globalThis.self=original;}
});


test('combined height/material sampler preserves the old independent blended fields',()=>{
 const [geometry,mesh,,elevation]=makeWorld();
 const sampler=createTerrainSampler(mesh,.72);
 const colors=new Float32Array(mesh.cells.length*3);
 for(let i=0;i<mesh.cells.length;i++)colors.set([(i%11)/11,(i%13)/13,(i%17)/17],i*3);
 for(let i=0;i<121;i++){
  const x=geometry.width*(i*0.06731%1),y=geometry.height*(i*0.03197%1);
  const joint=sampleTerrainFields(sampler,elevation.elevations,colors,x,y);
  const height=sampleElevation(sampler,elevation.elevations,x,y);
  const color=sampleTerrainColor(sampler,colors,x,y);
  assert.ok(Math.abs(joint.height-height)<1e-7);
  for(let channel=0;channel<3;channel++)assert.ok(Math.abs(joint.color[channel]-color[channel])<1e-7);
 }
});
