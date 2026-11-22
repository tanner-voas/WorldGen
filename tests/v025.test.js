import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraRay,surfaceHeightAt,pickTerrainRay} from '../src/terrain-3d-focus.js';
import {buildElevationSurface} from '../src/terrain-3d-model.js';
import {generateStage,DEFAULTS} from '../src/engine.js';
import {TERRAIN_FRAGMENT_SHADER,Terrain3DViewer} from '../src/terrain-3d.js';

function flatSurface(height=.5,water=0){
 const cols=8,rows=8,vertexData=new Float32Array((cols+1)*(rows+1)*7);
 for(let i=0;i<(cols+1)*(rows+1);i++)vertexData[i*7+1]=height;
 return {cols,rows,planeWidth:4,planeDepth:4,vertexData,insideMask:new Uint8Array((cols+1)*(rows+1)).fill(1),
  minY:height-.1,maxY:height+.1,seaLevel:water};
}

test('3D center ray matches camera target and picking hits the actual height field',()=>{
 const surface=flatSurface(.5);
 const eye=[0,3,6],target=[0,.5,0],ray=cameraRay(eye,target,200,150,400,300);
 assert.ok(ray&&ray.every(Number.isFinite));
 const targetVector=target.map((v,i)=>v-eye[i]),len=Math.hypot(...targetVector);
 for(let k=0;k<3;k++)assert.ok(Math.abs(ray[k]-targetVector[k]/len)<1e-6);
 const hit=pickTerrainRay(surface,eye,ray);
 assert.ok(hit,'Center focus ray should hit the visible terrain');
 assert.ok(Math.abs(hit[0])<.01&&Math.abs(hit[2])<.01);
 assert.ok(Math.abs(hit[1]-.5)<.01);
 assert.equal(pickTerrainRay(surface,eye,[0,1,0]),null,'Upward ray must not pick below the camera');
 assert.equal(surfaceHeightAt(surface,4,0),null,'Outside map cannot be picked');
});

test('3D camera picking respects world boundary exclusion and ocean surface',()=>{
 const water=flatSurface(-.5,0);
 const downward=cameraRay([0,3,5],[0,0,0],200,150,400,300);
 const atSea=pickTerrainRay(water,[0,3,5],downward);
 assert.ok(atSea&&Math.abs(atSea[1])<.01,'Ocean should be selected at sea level');
 water.insideMask.fill(0);
 assert.equal(pickTerrainRay(water,[0,3,5],downward),null,'Excluded area is not traversable');
});

test('generated terrain exposes immutable shape mask used for precise focus',()=>{
 const locked=[];
 for(let stage=1;stage<=4;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?{shape:'circle',radius:530}:{}),...(stage===2?{averageArea:locked[0].data.areaKm2/150}:{})};
  locked.push({stage,data:generateStage(stage,locked,settings)});
 }
 const [geometry,mesh,,elevation]=locked.map(item=>item.data);
 const before=JSON.stringify(elevation.elevations);
 const surface=buildElevationSurface(geometry,mesh,elevation.elevations);
 assert.equal(surface.insideMask.length,surface.vertexCount);
 assert.ok(surface.insideMask.includes(0)&&surface.insideMask.includes(1));
 assert.equal(JSON.stringify(elevation.elevations),before);
 assert.equal(surfaceHeightAt(surface,surface.planeWidth/2,surface.planeDepth/2),null,'Excluded map corner is not selectable');
 assert.ok(Number.isFinite(surfaceHeightAt(surface,0,0)));
});

test('viewer double tap focuses without changing generated geometry or requiring a GPU context',()=>{
 const surface=flatSurface(.5);
 const viewer=Object.create(Terrain3DViewer.prototype);
 Object.assign(viewer,{surface,disposed:false,canvas:{getBoundingClientRect:()=>({left:10,top:20,width:400,height:300})},
  target:[0,.5,0],pitch:.9,yaw:0,distance:6,lastFocusTime:0,drawSoon:()=>{viewer.drawCalls++;},drawCalls:0});
 // Focus uses the real camera orientation. The center ray intersects the surface.
 const initialDistance=viewer.distance;
 assert.equal(viewer.focusAt(210,170),true);
 assert.ok(viewer.distance<initialDistance);
 assert.equal(viewer.drawCalls,1);
 assert.equal(viewer.focusAt(210,170),false,'Rapid repeated click event must not zoom again');
 assert.equal(viewer.focusAt(-100,-100),false,'Off-canvas focus is ignored');
});

test('terrain shader has stable scale-aware fine detail but leaves water materials untouched',()=>{
 assert.match(TERRAIN_FRAGMENT_SHADER,/surfaceNoise\(position\*\.16\)/);
 assert.match(TERRAIN_FRAGMENT_SHADER,/surfaceNoise\(position\*\.75\)/);
 assert.match(TERRAIN_FRAGMENT_SHADER,/fwidth|dFdx/);
 assert.match(TERRAIN_FRAGMENT_SHADER,/if\(uWater==1\)/);
 assert.match(TERRAIN_FRAGMENT_SHADER,/if\(uWater==2\)/);
});

test('touch double-tap triggers exactly one local focus without changing the original terrain buffer',()=>{
 const surface=flatSurface(.5),source=new Float32Array(surface.vertexData);
 const viewer=Object.create(Terrain3DViewer.prototype);
 Object.assign(viewer,{surface,disposed:false,canvas:{getBoundingClientRect:()=>({left:0,top:0,width:400,height:300}),
  setPointerCapture(){},hasPointerCapture(){return false;}},pointers:new Map(),gesture:null,tapStart:null,lastTap:null,lastFocusTime:0,
  target:[0,.5,0],pitch:.9,yaw:0,distance:6,mode:'orbit',drawSoon:()=>{}});
 const e={pointerId:3,pointerType:'touch',clientX:200,clientY:150,type:'pointerup',preventDefault(){}};
 viewer.pointerDown(e);viewer.pointerUp(e);
 const before=viewer.distance;
 viewer.pointerDown(e);viewer.pointerUp(e);
 assert.ok(viewer.distance<before);
 assert.deepEqual(surface.vertexData,source);
});

test('world-shape picker rejects a point outside the circular outline but inside the rectangular grid',()=>{
 const surface=flatSurface(.5);
 surface.outline={shape:'circle',width:4,height:4,radius:2};
 assert.equal(surfaceHeightAt(surface,1.7,1.7),null);
 assert.ok(Number.isFinite(surfaceHeightAt(surface,1,1)));
 surface.outline={shape:'ellipse',width:4,height:4,radiusX:2,radiusY:1.5};
 assert.equal(surfaceHeightAt(surface,1.7,1.7),null);
 assert.ok(Number.isFinite(surfaceHeightAt(surface,.8,.5)));
});
