import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAdaptiveTerrainLevels,buildUniformTerrainLevels,adaptiveTileLod,TERRAIN_TILE_CELLS,TERRAIN_LOD_STEPS} from '../src/terrain-3d-lod.js';
import {DEFAULTS,generateStage} from '../src/engine.js';
import {buildElevationSurface} from '../src/terrain-3d-model.js';

function planarArea(a,b,c,cols){
 const stride=cols+1;
 const ax=a%stride,ay=Math.floor(a/stride),bx=b%stride,by=Math.floor(b/stride),cx=c%stride,cy=Math.floor(c/stride);
 // Grid coordinates run right/east and down/south. Clockwise triangles
 // have an upward-facing normal in the 3D world coordinate frame.
 return ((cx-ax)*(by-ay)-(bx-ax)*(cy-ay))/2;
}

function boundaryVertices(level,tile,cols){
 const edge=[new Set(),new Set(),new Set(),new Set()];
 const stride=cols+1;
 for(const v of level.indices.subarray(tile.offset,tile.offset+tile.count)){
  const x=v%stride,y=Math.floor(v/stride);
  if(y===tile.y0)edge[0].add(x);
  if(x===tile.x1)edge[1].add(y);
  if(y===tile.y1)edge[2].add(x);
  if(x===tile.x0)edge[3].add(y);
 }
 return edge;
}

test('tile-local LOD covers a rectangular world exactly, with upward-facing triangles',()=>{
 const cols=72,rows=48,inside=new Uint8Array((cols+1)*(rows+1)).fill(1);
 const levels=buildAdaptiveTerrainLevels(cols,rows,inside,4.8,3.2);
 assert.equal(TERRAIN_TILE_CELLS,32);
 assert.deepEqual(levels.map(level=>level.step),TERRAIN_LOD_STEPS);
 const baseline=levels[0].indices.length;
 let before=Infinity;
 for(const level of levels){
  assert.ok(level.indices.length<before);
  before=level.indices.length;
  let sum=0;
  for(const tile of level.tiles){
   let tileArea=0;
   for(let k=tile.offset;k<tile.offset+tile.count;k+=3){
    const triangleArea=planarArea(level.indices[k],level.indices[k+1],level.indices[k+2],cols);
    assert.ok(triangleArea>0,`tile ${tile.id} step ${level.step}: triangle winding or zero area`);
    tileArea+=triangleArea;
   }
   assert.equal(tileArea,(tile.x1-tile.x0)*(tile.y1-tile.y0),`tile ${tile.id} step ${level.step}: exact surface coverage`);
   sum+=tileArea;
  }
  assert.equal(sum,cols*rows);
 }
 assert.ok(levels[3].indices.length<baseline/4);
 const uniform=buildUniformTerrainLevels(cols,rows,inside);
 assert.ok(uniform[3].indices.length<levels[3].indices.length/3,'uniform far view avoids dense stitched boundaries');
 for(const level of uniform){
  let area=0;
  for(let k=0;k<level.indices.length;k+=3)area+=planarArea(level.indices[k],level.indices[k+1],level.indices[k+2],cols);
  assert.equal(area,cols*rows);
 }
});

test('every tile LOD preserves all shared boundary vertices to eliminate T-junction cracks',()=>{
 const cols=72,rows=48,inside=new Uint8Array((cols+1)*(rows+1)).fill(1);
 const levels=buildAdaptiveTerrainLevels(cols,rows,inside,4.8,3.2);
 for(const level of levels)for(const tile of level.tiles){
  const edges=boundaryVertices(level,tile,cols);
  for(let x=tile.x0;x<=tile.x1;x++){
   assert.ok(edges[0].has(x),`top edge: tile ${tile.id} level ${level.step}, x=${x}`);
   assert.ok(edges[2].has(x),`bottom edge: tile ${tile.id} level ${level.step}, x=${x}`);
  }
  for(let y=tile.y0;y<=tile.y1;y++){
   assert.ok(edges[1].has(y),`right edge: tile ${tile.id} level ${level.step}, y=${y}`);
   assert.ok(edges[3].has(y),`left edge: tile ${tile.id} level ${level.step}, y=${y}`);
  }
 }
 const fine=levels[0],coarse=levels[3];
 // Check a neighboring fine and coarse tile share precisely the same edge.
 const a=fine.tiles.find(t=>t.x1===32&&t.y0===0),b=coarse.tiles.find(t=>t.x0===32&&t.y0===0);
 assert.ok(a&&b);
 assert.deepEqual([...boundaryVertices(fine,a,cols)[1]].sort((x,y)=>x-y),[...boundaryVertices(coarse,b,cols)[3]].sort((x,y)=>x-y));
});

test('adaptive LOD respects camera distance and does not require regeneration',()=>{
 const tile={x:1,z:0};
 assert.equal(adaptiveTileLod([1,1,0],tile),1);
 assert.equal(adaptiveTileLod([1,7,0],tile),2);
 assert.equal(adaptiveTileLod([1,14,0],tile),4);
 assert.equal(adaptiveTileLod([1,21,0],tile),8);
 assert.ok(adaptiveTileLod([1,7,0],tile,2)<=adaptiveTileLod([1,7,0],tile));
 assert.throws(()=>buildAdaptiveTerrainLevels(15,16,[],4,4),/Invalid adaptive terrain grid/);
});

test('adaptive tile ranges and geometry stay compatible with all map shapes',()=>{
 for(const shape of [{shape:'rectangle',width:1000,height:600},{shape:'circle',radius:550},{shape:'ellipse',radiusX:800,radiusY:420}]){
  const locked=[];
  for(let stage=1;stage<=4;stage++){
   const settings={...DEFAULTS[stage],...(stage===1?shape:{}),...(stage===2?{averageArea:locked[0].data.areaKm2/220}:{})};
   locked.push({stage,data:generateStage(stage,locked,settings)});
  }
  const [geometry,mesh,,height]=locked.map(x=>x.data);
  const original=JSON.stringify(height.elevations);
  const surface=buildElevationSurface(geometry,mesh,height.elevations);
  assert.equal(JSON.stringify(height.elevations),original);
  assert.ok(surface.levels.length===4);
  assert.ok(surface.uniformLevels.length===4);
  for(const level of surface.levels){
   assert.ok(level.tiles?.length>0);
   let end=0;
   for(const tile of level.tiles){
    assert.equal(tile.offset,end);
    assert.equal(tile.count%3,0);
    end+=tile.count;
    assert.ok(Number.isFinite(tile.x)&&Number.isFinite(tile.z));
   }
   assert.equal(end,level.indices.length);
   assert.ok(level.indices.every(index=>index<surface.vertexCount));
  }
 }
});

test('3D draw path uses a single call for uniform LOD and tile draws only when mixed',async()=>{
 const {Terrain3DViewer}=await import('../src/terrain-3d.js');
 const cols=64,rows=64,inside=new Uint8Array((cols+1)*(rows+1)).fill(1);
 const s={cols,rows,planeWidth:4.8,planeDepth:4.8,
  levels:buildAdaptiveTerrainLevels(cols,rows,inside,4.8,4.8),
  uniformLevels:buildUniformTerrainLevels(cols,rows,inside),
  ocean:new Float32Array(18),hydrology:null,seaLevel:0,materialColors:null};
 const calls=[];
 const gl={COLOR_BUFFER_BIT:1,DEPTH_BUFFER_BIT:2,TRIANGLES:4,UNSIGNED_INT:5125,ELEMENT_ARRAY_BUFFER:34963,
  BLEND:3042,SRC_ALPHA:770,ONE_MINUS_SRC_ALPHA:771,
  viewport(){},clear(){},useProgram(){},uniformMatrix4fv(){},uniform3fv(){},uniform1f(){},uniform1i(){},
  disable(){},enable(){},depthMask(){},bindVertexArray(){},bindBuffer(){},blendFunc(){},
  drawArrays(){},drawElements(mode,count,type,offset){calls.push({mode,count,type,offset});}};
 const viewer=Object.create(Terrain3DViewer.prototype);
 viewer.canvas={width:0,height:0,getBoundingClientRect(){return {width:540,height:350};}};
 Object.assign(viewer,{gl,surface:s,disposed:false,lost:false,program:{},target:[0,0,0],pitch:.94,yaw:-.72,
  terrainVAO:{},waterVAO:{},hydroGeometry:[],onStatus(){},lastDrawStatus:'',
  levelBuffers:s.levels.map(level=>({step:level.step,tiles:level.tiles,count:level.indices.length,buffer:{step:level.step}})),
  uniformLevelBuffers:s.uniformLevels.map(level=>({step:level.step,count:level.indices.length,buffer:{step:level.step}}))});
 const oldWindow=globalThis.window;
 try{
  globalThis.window={devicePixelRatio:1};
  viewer.distance=25;viewer.draw();assert.equal(calls.length,1,'far overview should use one uniform draw');
  assert.equal(calls[0].count,s.uniformLevels[3].indices.length);
  assert.equal(viewer.renderedFrame.terrain.length,1);
  assert.equal(viewer.renderedFrame.terrain[0].indices,s.uniformLevels[3].indices);
  calls.length=0;
  viewer.distance=5.5;viewer.draw();
  assert.ok(calls.length>1,'mixed nearby and distant tiles should use multiple stitched draws');
  assert.ok(calls.every(call=>call.count>0&&call.count%3===0));
  assert.deepEqual(viewer.renderedFrame.terrain.map(d=>[d.count,d.start*4]),calls.map(c=>[c.count,c.offset]));
 }finally{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
});
