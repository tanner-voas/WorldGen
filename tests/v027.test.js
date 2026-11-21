import test from 'node:test';
import assert from 'node:assert/strict';
import {Terrain3DViewer,TERRAIN_VERTEX_SHADER} from '../src/terrain-3d.js';
import {cameraRay,pickTerrainRay} from '../src/terrain-3d-focus.js';
import {readFileSync} from 'node:fs';

function flatSurface(height=.4,seaLevel=0){
 const cols=10,rows=10,vertexData=new Float32Array((cols+1)*(rows+1)*7);
 for(let i=0;i<(cols+1)*(rows+1);i++)vertexData[i*7+1]=height;
 return {cols,rows,planeWidth:4,planeDepth:4,vertexData,insideMask:new Uint8Array((cols+1)*(rows+1)).fill(1),
  minY:height-.05,maxY:height+.05,seaLevel,heightScale:1};
}

test('height controls use reciprocal 5% factors, default 1x, without clamp on the number of taps',()=>{
 const viewer=Object.create(Terrain3DViewer.prototype);
 const scheduled=new Map();let nextId=0;const states=[];let drawings=0;
 Object.assign(viewer,{disposed:false,heightSteps:0,heightMultiplier:1,heightTimer:null,target:[0,.4,0],
  drawSoon(){drawings++;}});
 const setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout;
 globalThis.setTimeout=(fn,ms)=>{assert.equal(ms,2000);scheduled.set(++nextId,fn);return nextId;};
 globalThis.clearTimeout=(id)=>{scheduled.delete(id);};
 try{
  assert.equal(viewer.heightMultiplier,1);
  for(let i=0;i<100;i++)viewer.queueHeightStep(1,(steps,pending)=>states.push([steps,pending]));
  assert.equal(viewer.heightSteps,100);
  assert.equal(scheduled.size,1,'repeated taps must restart the pending timer');
  assert.equal(drawings,0,'render must not update before debounce');
  assert.equal(viewer.heightMultiplier,1);
  const callback=[...scheduled.values()][0];scheduled.clear();callback();
  assert.ok(Math.abs(viewer.heightMultiplier-1.05**100)<1e-12);
  assert.ok(Math.abs(viewer.target[1]-.4*1.05**100)<1e-12);
  assert.equal(drawings,1);
  assert.deepEqual(states.at(-1),[100,false]);
  for(let i=0;i<100;i++)viewer.queueHeightStep(-1,()=>{});
  [...scheduled.values()][0]();
  assert.equal(viewer.heightSteps,0);
  assert.equal(viewer.heightMultiplier,1);
  assert.equal(drawings,2);
 }finally{globalThis.setTimeout=setTimer;globalThis.clearTimeout=clearTimer;}
});

test('pending height update is cancelled when viewer is disposed',()=>{
 const viewer=Object.create(Terrain3DViewer.prototype);
 const scheduled=new Map();let nextId=0;
 Object.assign(viewer,{disposed:false,heightSteps:0,heightMultiplier:1,heightTimer:null,pendingFrame:0,gl:null,
  worker:null,detailWorker:null,detailPatches:new Map(),activeDetailIds:new Set(),canvas:{removeEventListener(){}},drawSoon(){throw Error('should not draw');}});
 const setTimer=globalThis.setTimeout,clearTimer=globalThis.clearTimeout;
 globalThis.setTimeout=(fn)=>{scheduled.set(++nextId,fn);return nextId;};
 globalThis.clearTimeout=id=>scheduled.delete(id);
 try{
  viewer.queueHeightStep(1,()=>{});
  assert.equal(scheduled.size,1);
  viewer.dispose();
  assert.equal(scheduled.size,0);
  assert.equal(viewer.heightMultiplier,1);
 }finally{globalThis.setTimeout=setTimer;globalThis.clearTimeout=clearTimer;}
});

test('GPU shader applies relief to all positions including oceans and rivers and adjusts normals',()=>{
 assert.match(TERRAIN_VERTEX_SHADER,/aPosition\.y\*uHeightMultiplier/);
 assert.match(TERRAIN_VERTEX_SHADER,/aNormal\.x\*uHeightMultiplier/);
 assert.match(TERRAIN_VERTEX_SHADER,/aNormal\.z\*uHeightMultiplier/);
 assert.match(TERRAIN_VERTEX_SHADER,/gl_Position=uCamera\*vec4\(position,1\.0\)/);
 assert.match(readFileSync(new URL('../src/terrain-3d.js',import.meta.url),'utf8'),/gl\.uniform1f\(this\.heightLocation,this\.heightMultiplier\?\?1\)/);
});

test('terrain and ocean picking track the same new height multiplier as GPU rendering',()=>{
 const s=flatSurface(.4,-.2);
 const eye=[0,3,3],target=[0,.8,0];
 const ray=cameraRay(eye,target,200,150,400,300);
 const point=pickTerrainRay(s,eye,ray,2);
 assert.ok(point);
 assert.ok(Math.abs(point[1]-.8)<.01);
 const water=flatSurface(-.4,-.2);
 const seaPoint=pickTerrainRay(water,eye,cameraRay(eye,[0,-.4,0],200,150,400,300),2);
 assert.ok(seaPoint);
 assert.ok(Math.abs(seaPoint[1]+.4)<.01);
});

test('height panel is collapsed initially and includes persistent 5% buttons and render state',()=>{
 const ui=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(ui,/id="wg-3d-height-panel"[^>]*hidden/);
 assert.match(ui,/data-action="3d-height-toggle" aria-expanded="false"/);
 assert.match(ui,/data-action="3d-height-up"/);
 assert.match(ui,/data-action="3d-height-down"/);
 assert.match(ui,/case '3d-height-up':case '3d-height-down'/);
 assert.match(ui,/World-aware baseline/);
});
