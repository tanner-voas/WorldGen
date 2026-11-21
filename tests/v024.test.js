import test from 'node:test';
import assert from 'node:assert/strict';
import {insideGeometry,DEFAULTS,generateStage} from '../src/engine.js';
import {buildAdaptiveTerrainLevels,buildUniformTerrainLevels,tileVisibleInFrustum} from '../src/terrain-3d-lod.js';
import {buildElevationSurface} from '../src/terrain-3d-model.js';
import {lookAtMatrix,perspectiveMatrix,multiplyMatrices} from '../src/terrain-3d.js';

function maskForShape(shape,cols,rows,withHole=false){
 const mask=new Uint8Array((cols+1)*(rows+1));
 for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){
  const wx=x/cols*shape.width,wy=y/rows*shape.height;
  let inside=insideGeometry(wx,wy,shape);
  if(withHole&&Math.hypot(x-cols/2,y-rows/2)<9)inside=false;
  mask[y*(cols+1)+x]=inside?1:0;
 }
 return mask;
}
function footprintArea(indices,cols){
 const stride=cols+1;
 let area=0;
 for(let i=0;i<indices.length;i+=3){
  const a=indices[i],b=indices[i+1],c=indices[i+2];
  const ax=a%stride,ay=Math.floor(a/stride),bx=b%stride,by=Math.floor(b/stride),cx=c%stride,cy=Math.floor(c/stride);
  const t=((cx-ax)*(by-ay)-(bx-ax)*(cy-ay))/2;
  assert.ok(t>0,'3D surface must have upward-facing, non-degenerate triangles');
  area+=t;
 }
 return area;
}

test('all 3D LODs retain the same physical outline, including curved and punctured masks',()=>{
 const cols=160,rows=128;
 for(const [shape,hole] of [
  [{shape:'rectangle',width:1600,height:1280},false],
  [{shape:'circle',width:1600,height:1280,radius:625},false],
  [{shape:'ellipse',width:1600,height:1280,radiusX:700,radiusY:510},false],
  [{shape:'ellipse',width:1600,height:1280,radiusX:700,radiusY:510},true]
 ]){
  const inside=maskForShape(shape,cols,rows,hole),original=inside.slice();
  const tiled=buildAdaptiveTerrainLevels(cols,rows,inside,4.8,3.8);
  const uniform=buildUniformTerrainLevels(cols,rows,inside);
  const reference=footprintArea(tiled[0].indices,cols);
  assert.ok(reference>0);
  for(const level of [...tiled,...uniform]){
   assert.equal(footprintArea(level.indices,cols),reference,`${shape.shape} at LOD ${level.step}${hole?' with hole':''}`);
  }
  for(const levels of [tiled,uniform]){
   const counts=levels.map(level=>level.indices.length);
   assert.ok(counts.every((count,i)=>count>0&&(!i||count<counts[i-1])),`${shape.shape} coarse meshes should remain cheaper`);
  }
  assert.deepEqual(inside,original,'LOD generation cannot modify its source mask');
 }
});

test('frustum culling rejects only fully off-screen boxes, with a safe fallback for near-plane cases',()=>{
 const surface={cols:64,rows:64,planeWidth:4,planeDepth:4,minY:-.3,maxY:.8};
 const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
 assert.equal(tileVisibleInFrustum(identity,{x0:25,x1:39,y0:25,y1:39},surface),true);
 assert.equal(tileVisibleInFrustum(identity,{x0:55,x1:64,y0:25,y1:39},surface),false);
 assert.equal(tileVisibleInFrustum(identity,{x0:0,x1:8,y0:25,y1:39},surface),false);
 // A taller tile can still be visible even if its footprint is beyond the
 // default vertical bounds; local bounds take priority over global bounds.
 const tilted=new Float32Array(identity);tilted[13]=-2.3;
 assert.equal(tileVisibleInFrustum(tilted,{x0:25,x1:39,y0:25,y1:39,minY:-.3,maxY:3},surface),true);
 assert.equal(tileVisibleInFrustum(tilted,{x0:25,x1:39,y0:25,y1:39},surface),false);
 const uncertain=new Float32Array(identity);uncertain[15]=-1;
 assert.equal(tileVisibleInFrustum(uncertain,{x0:60,x1:64,y0:25,y1:39},surface),true,'uncertain near-plane visibility must be kept');
 assert.equal(tileVisibleInFrustum(null,{x0:55,x1:64,y0:25,y1:39},surface),true,'missing clip data must not hide terrain');
});

test('3D worker mesh records conservative per-tile vertical ranges for camera culling',()=>{
 const locked=[];
 for(let stage=1;stage<=4;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?{shape:'ellipse',radiusX:830,radiusY:470}:{}),...(stage===2?{averageArea:locked[0].data.areaKm2/220}:{})};
  locked.push({stage,data:generateStage(stage,locked,settings)});
 }
 const [geometry,mesh,,elevation]=locked.map(row=>row.data);
 const original=JSON.stringify(elevation.elevations);
 const surface=buildElevationSurface(geometry,mesh,elevation.elevations);
 assert.equal(JSON.stringify(elevation.elevations),original);
 for(const tile of surface.levels[0].tiles){
  assert.ok(Number.isFinite(tile.minY)&&Number.isFinite(tile.maxY));
  assert.ok(tile.minY<=tile.maxY);
  for(let y=tile.y0;y<=tile.y1;y++)for(let x=tile.x0;x<=tile.x1;x++){
   const vertex=(y*(surface.cols+1)+x)*7;
   const height=surface.vertexData[vertex+1];
   assert.ok(height>=tile.minY&&height<=tile.maxY,`tile ${tile.id} cannot exclude its own vertex height`);
  }
 }
 const camera=multiplyMatrices(perspectiveMatrix(.77,1.3,.04,100),lookAtMatrix([1.1,2.4,3.2],[0,0,0]));
 const visible=surface.levels[0].tiles.filter(tile=>tileVisibleInFrustum(camera,tile,surface));
 assert.ok(visible.length>0);
});

test('3D mixed-LOD draw skips off-screen terrain without dropping the visible map',async()=>{
 const {Terrain3DViewer}=await import('../src/terrain-3d.js');
 const cols=256,rows=256,inside=new Uint8Array((cols+1)*(rows+1)).fill(1);
 const levels=buildAdaptiveTerrainLevels(cols,rows,inside,4.8,4.8);
 const uniformLevels=buildUniformTerrainLevels(cols,rows,inside);
 const surface={cols,rows,planeWidth:4.8,planeDepth:4.8,minY:-.2,maxY:.4,levels,uniformLevels,
  ocean:new Float32Array(18),hydrology:null,seaLevel:0,materialColors:null};
 for(const tile of levels[0].tiles){tile.minY=-.2;tile.maxY=.4;}
 const drawCounts=[];
 const gl={COLOR_BUFFER_BIT:1,DEPTH_BUFFER_BIT:2,TRIANGLES:4,UNSIGNED_INT:5125,ELEMENT_ARRAY_BUFFER:34963,
  BLEND:3042,SRC_ALPHA:770,ONE_MINUS_SRC_ALPHA:771,
  viewport(){},clear(){},useProgram(){},uniformMatrix4fv(){},uniform3fv(){},uniform1f(){},uniform1i(){},
  disable(){},enable(){},depthMask(){},bindVertexArray(){},bindBuffer(){},blendFunc(){},drawArrays(){},
  drawElements(_mode,count){drawCounts.push(count);}};
 const viewer=Object.create(Terrain3DViewer.prototype);
 viewer.canvas={width:0,height:0,getBoundingClientRect(){return {width:320,height:580};}};
 Object.assign(viewer,{gl,surface,disposed:false,lost:false,program:{},target:[2.2,0,1.9],pitch:.75,yaw:-.72,distance:4,
  terrainVAO:{},waterVAO:{},hydroGeometry:[],onStatus(){},lastDrawStatus:'',
  levelBuffers:levels.map(level=>({step:level.step,tiles:level.tiles,count:level.indices.length,buffer:{}})),
  uniformLevelBuffers:uniformLevels.map(level=>({step:level.step,count:level.indices.length,buffer:{}}))});
 const originalWindow=globalThis.window;
 try{
  globalThis.window={devicePixelRatio:1};
  viewer.draw();
  assert.ok(drawCounts.length>0&&drawCounts.length<levels[0].tiles.length/2,
   'panning toward a world corner should skip most invisible terrain tiles');
  assert.ok(drawCounts.every(count=>count>0&&count%3===0));
  // An overview remains the cheaper single-draw uniform mode.
  drawCounts.length=0;viewer.target=[0,0,0];viewer.distance=25;viewer.draw();
  assert.equal(drawCounts.length,1);
 }finally{
  if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;
 }
});
