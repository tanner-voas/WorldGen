import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULTS,generateStage,newWorld,upgradeWorld,validateWorld,snapshotThroughStage} from '../src/engine.js';
import {createStartupStorage} from '../src/startup-storage.js';
import {Terrain3DViewer} from '../src/terrain-3d.js';
import {buildElevationSurface,selectTerrainSource} from '../src/terrain-3d-model.js';
import {selectTerrainAppearance} from '../src/terrain-3d-material.js';

function world(shape,count=100,seed=49,extreme=false){
 const w=newWorld('Stabilization');
 for(let stage=1;stage<=12;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?shape:stage===2?{averageArea:w.locked[0].data.areaKm2/count, distribution:extreme?'clustered':'jittered', relaxation:extreme?0:1}:stage===5&&extreme?{land:.85,edgeOcean:1.5}:stage===7&&extreme?{iterations:40,hydraulic:1.6,thermal:1.6}:{}),...(stage!==1?{seed:seed+stage}: {})};
  w.locked.push({stage,settings,data:generateStage(stage,w.locked,settings)});
 }
 w.working={stage:13,settings:{},data:null,dataSettings:null};w.viewStage=12;return w;
}
const shapes=[{shape:'rectangle',width:2048,height:1024},{shape:'circle',radius:800},{shape:'ellipse',radiusX:1000,radiusY:500}];

test('malformed geometry and mesh metadata cannot bypass saved-world validation',()=>{
 const w=world(shapes[1]);
 for(const corrupt of [g=>delete g.width,g=>delete g.areaKm2,g=>g.shape='unknown',g=>g.radiusY=23,g=>g.height=NaN,g=>g.areaKm2='2010619.298']){
  const broken=structuredClone(w);corrupt(broken.locked[0].data);assert.throws(()=>validateWorld(broken),/geometry/);
 }
 for(const value of [undefined,NaN,-1,Infinity,1]){
  const broken=structuredClone(w);broken.locked[1].data.areaKm2=value;assert.throws(()=>validateWorld(broken),/Mesh geometry/);
 }
 const broken=structuredClone(w);broken.working.data={};assert.throws(()=>validateWorld(broken),/working layer data/);
});

test('corrupt geometry enters fail-closed startup recovery with the original record retained',async()=>{
 const w=newWorld();w.working.data={shape:'rectangle',width:2048,height:1024};let writes=0;
 const storage=createStartupStorage({read:async k=>k==='workspace'?structuredClone(w):undefined,commit:async()=>{writes++;}});
 const result=await storage.load();assert.equal(result.kind,'recovery');assert.deepEqual(result.raw,w);assert.equal(writes,0);
});

test('imported and restored interface state is normalized without touching generated layers',()=>{
 const w=world(shapes[0]);const before=structuredClone(w.locked);
 for(const value of [-9,1e9,Infinity,NaN,'invalid',null]){
  const broken=structuredClone(w);broken.viewStage=value;broken.viewport={scale:0,centerX:3,centerY:8};
  const next=upgradeWorld(broken);assert.ok(Number.isInteger(next.viewStage)&&next.viewStage>=1&&next.viewStage<=12);assert.equal(next.viewport,undefined);assert.deepEqual(next.locked,before);
 }
 const older=snapshotThroughStage(w,4);older.viewStage=12;assert.equal(upgradeWorld(older).viewStage,5);
});

test('message decoding failures terminate an initial terrain worker and settle its promise',async()=>{
 const old=globalThis.Worker;let job;globalThis.Worker=class{constructor(){job=this;}postMessage(){}terminate(){this.terminated=true;}};
 try{
  const v=Object.create(Terrain3DViewer.prototype);Object.assign(v,{disposed:false,onStatus(){}});
  const pending=v.initialize({}, {}, []);job.onmessageerror();await assert.rejects(pending,/could not be decoded/);assert.equal(job.terminated,true);assert.equal(v.worker,null);assert.equal(v.cancelInitialization,null);
 }finally{if(old===undefined)delete globalThis.Worker;else globalThis.Worker=old;}
});

test('message decoding failures stop further local refinement instead of leaving the worker busy',()=>{
 const old=globalThis.Worker;let job;globalThis.Worker=class{constructor(){job=this;}postMessage(){}terminate(){this.terminated=true;}};
 try{
  const v=Object.create(Terrain3DViewer.prototype);Object.assign(v,{disposed:false,lost:false,onStatus(){},detailSource:{},surface:{cols:2,rows:2,planeWidth:1,planeDepth:1,heightScale:1}});
  v._startDetailWorker();job.onmessageerror();assert.equal(job.terminated,true);assert.equal(v.detailWorker,null);assert.equal(v.detailState,null);assert.match(v.detailFailure,/could not be decoded/);
 }finally{if(old===undefined)delete globalThis.Worker;else globalThis.Worker=old;}
});

test('context interruption cancels pending redraws and releases obsolete local CPU geometry',()=>{
 const events=new Map(),canvas={addEventListener:(name,fn)=>events.set(name,fn)},status=[];let cancelled=null,terminated=false;
 const prev=globalThis.cancelAnimationFrame;globalThis.cancelAnimationFrame=id=>cancelled=id;
 try{
  const v=new Terrain3DViewer(canvas,{onStatus:s=>status.push(s)});v.pendingFrame=29;v.detailPatches.set(1,{vertexData:new Float32Array(7)});v.detailWorker={terminate(){terminated=true;}};
  events.get('webglcontextlost')({preventDefault(){}});assert.equal(cancelled,29);assert.equal(v.pendingFrame,0);assert.equal(v.detailPatches.size,0);assert.equal(v.lost,true);assert.equal(terminated,true);
  v.surface={};v._initializeGL=()=>{throw Error('GPU failed');};events.get('webglcontextrestored')();assert.equal(v.lost,true);assert.match(status.at(-1),/Graphics recovery failed/);
  v._initializeGL=()=>{};v._uploadSurface=()=>{};let frames=0;v.drawSoon=()=>frames++;events.get('webglcontextrestored')();assert.equal(v.lost,false);assert.equal(frames,1);
 }finally{if(prev===undefined)delete globalThis.cancelAnimationFrame;else globalThis.cancelAnimationFrame=prev;}
});

test('normal and extreme worlds round-trip through all 12 stages and all historical checkpoints',()=>{
 const cases=[...shapes.map(s=>[s,100,false]),...shapes.map(s=>[s,1200,false]),...shapes.map(s=>[s,5000,false]),[{shape:'rectangle',width:20000,height:50},100,true],[{shape:'ellipse',radiusX:20000,radiusY:50},100,true],[{shape:'circle',radius:50},100,true]];
 for(const [shape,count,extreme] of cases){
  const w=world(shape,count,2048+count,extreme);validateWorld(w);
  const raw=JSON.parse(JSON.stringify(w.locked)),loaded=upgradeWorld(JSON.parse(JSON.stringify(w)));assert.deepEqual(loaded.locked,raw);
  for(let stage=1;stage<=12;stage++){const snap=snapshotThroughStage(loaded,stage);const restored=upgradeWorld(JSON.parse(JSON.stringify(snap)));assert.deepEqual(restored.locked,raw.slice(0,stage));assert.equal(restored.viewStage,stage);}
  const get=stage=>raw[stage-1]?.data;
  // The production stage selection, terrain and material path must work on every shape.
  for(const stage of count===100?[4,5,6,7,8,9,10,11,12]:[12]){
   const source=selectTerrainSource(stage,get),surface=buildElevationSurface(get(1),get(2),source.elevations,()=>{},{seaLevel:source.seaLevel,waterMask:stage>=5?get(5).water:null,hydrology:stage>=9?get(9):null,appearance:selectTerrainAppearance(stage,get),includeUniformLevels:false});
   assert.ok(surface.vertexData.length>0);assert.ok(surface.vertexData.every(Number.isFinite));assert.ok(surface.ocean.every(Number.isFinite));assert.ok(surface.hydrology.rivers.every(Number.isFinite));assert.ok(surface.hydrology.lakes.every(Number.isFinite));
   for(const level of surface.levels){assert.ok(level.indices.length%3===0);assert.ok(level.indices.every(i=>i<surface.vertexData.length/7));}
  }
  assert.equal(JSON.stringify(w.locked),JSON.stringify(loaded.locked));
 }
});

test('application validates replacement before stopping generation and handles 2D lost capture',()=>{
 const code=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(code,/function changeWorld\(world\)\{if\(!startupReady\)return;const next=upgradeWorld\(world\);requestId\+\+;stopWorker\(\)/);
 assert.match(code,/job\.onmessageerror=/);assert.match(code,/addEventListener\('lostpointercapture',pointerEnd\)/);
});
