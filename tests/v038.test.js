import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAdaptiveTerrainLevels} from '../src/terrain-3d-lod.js';
import {planFocusedTerrainTiles,projectedTileFootprint,focusedTileTriangles,DETAIL_TRIANGLE_BUDGET,DETAIL_CACHE_BYTE_BUDGET,DETAIL_SUBDIVISIONS} from '../src/terrain-3d-detail.js';
import {Terrain3DViewer,perspectiveMatrix,lookAtMatrix,multiplyMatrices} from '../src/terrain-3d.js';
import {buildElevationSurface} from '../src/terrain-3d-model.js';

function surface(){
 const cols=320,rows=160,insideMask=new Uint8Array((cols+1)*(rows+1)).fill(1);
 return {cols,rows,insideMask,planeWidth:4.8,planeDepth:2.4,minY:-.01,maxY:.01,
  levels:buildAdaptiveTerrainLevels(cols,rows,insideMask,4.8,2.4)};
}
function view(target,distance,pitch=.93,width=680,height=1180,yaw=-.69){
 const eye=[target[0]+distance*Math.cos(pitch)*Math.sin(yaw),target[1]+distance*Math.sin(pitch),target[2]+distance*Math.cos(pitch)*Math.cos(yaw)];
 return {width,height,camera:multiplyMatrices(perspectiveMatrix(.77,width/height,Math.max(.00035,Math.min(.04,distance*.045)),100),lookAtMatrix(eye,target))};
}
const total=tiles=>tiles.reduce((n,t)=>n+focusedTileTriangles(t),0);

test('a polygon-scale interior view keeps maximum local resolution without generating unseen tiles',()=>{
 const s=surface(),options=view([.1,0,.1],.012);
 const plan=planFocusedTerrainTiles(s,options);
 assert.equal(plan.length,1);
 assert.equal(plan[0].subdivisions,8);
 assert.equal(total(plan),131072);
 const opposite=s.levels[0].tiles[0];
 assert.equal(projectedTileFootprint(s,opposite,options.camera,options.width,options.height),null);
 assert.ok(plan.every(t=>projectedTileFootprint(s,s.levels[0].tiles[t.id],options.camera,options.width,options.height)));
});

test('portrait, landscape, oblique and relief-adjusted views have deterministic bounded mixed-detail plans',()=>{
 const s=surface();let mixed=0;
 for(const pitch of [.22,.93,1.45])for(const distance of [.012,.05,.15,.35])for(const [width,height] of [[680,1180],[1180,680]])for(const heightMultiplier of [1,4]){
  const options={...view([.48,0,.24],distance,pitch,width,height),heightMultiplier};
  const plan=planFocusedTerrainTiles(s,options);
  assert.ok(plan.length>0);assert.ok(total(plan)<=DETAIL_TRIANGLE_BUDGET);
  assert.equal(new Set(plan.map(t=>t.id)).size,plan.length);
  assert.ok(plan.every(t=>DETAIL_SUBDIVISIONS.includes(t.subdivisions)));
  assert.deepEqual(planFocusedTerrainTiles(s,options),plan);
  if(new Set(plan.map(t=>t.subdivisions)).size>1)mixed++;
 }
 assert.ok(mixed>0);
 const none=planFocusedTerrainTiles(s,{...view([0,0,0],.12),budget:1});
 assert.deepEqual(none,[]);
});

test('tiles completely behind camera are excluded and near-plane intersections are finite',()=>{
 const s=surface(),camera=multiplyMatrices(perspectiveMatrix(.77,1,.01,100),lookAtMatrix([0,0,0],[0,0,-1]));
 const behind=s.levels[0].tiles.find(t=>t.y0>=96&&t.x0===128);
 assert.equal(projectedTileFootprint(s,behind,camera,500,500),null);
 const crossing=s.levels[0].tiles.find(t=>t.x0===128&&t.y0===64);
 const p=projectedTileFootprint(s,crossing,camera,500,500);
 assert.ok(p&&Object.values(p).every(Number.isFinite));
 assert.ok(p.coverage>=0&&p.coverage<=1);
});

test('cache respects byte budget and never draws old higher-resolution geometry after a downgrade',()=>{
 const viewer=Object.create(Terrain3DViewer.prototype);
 const size=4*1024*1024;
 Object.assign(viewer,{detailPlan:new Map([[1,8],[2,2],[3,8]]),detailPatches:new Map([
  [0,{bytes:size,subdivisions:8}],[1,{bytes:size,subdivisions:4}],[2,{bytes:size,subdivisions:8}],
  [3,{bytes:size,subdivisions:8}],[4,{bytes:size,subdivisions:8}],[5,{bytes:size,subdivisions:8}]]),
  _deleteFocusedPatch(id){this.detailPatches.delete(id);}});
 assert.ok(viewer._activeFocusedPatch(1),'lower-resolution mesh may remain during upgrade');
 assert.equal(viewer._activeFocusedPatch(2),null,'old dense mesh must not exceed active budget');
 viewer._trimFocusedPatches();
 assert.ok([...viewer.detailPatches.values()].reduce((n,p)=>n+p.bytes,0)<=DETAIL_CACHE_BYTE_BUDGET);
 assert.ok(viewer.detailPatches.has(1)&&viewer.detailPatches.has(3));
 assert.ok(!viewer.detailPatches.has(0)&&!viewer.detailPatches.has(2));
});

test('actual detail worker honors mixed subdivisions and both resolutions agree on the shared edge',async()=>{
 const geometry={shape:'rectangle',width:60,height:30};
 const mesh={width:60,height:30,areaKm2:1800,cells:Array.from({length:6},(_,i)=>({x:i*10+5,y:15,poly:[i*10,0,i*10+10,0,i*10+10,30,i*10,30],neighbors:[i-1,i+1].filter(j=>j>=0&&j<6)}))};
 const elevations=[-.5,.9,.35,.48,1.7,1.2],waterMask=[1,0,0,0,0,0],seaLevel=0;
 const appearance={stage:10,water:waterMask,climate:{meanTemp:[8,2,25,-9,17,5],moisture:[.9,.2,1,.1,.8,.4]}};
 const s=buildElevationSurface(geometry,mesh,elevations,()=>{},{waterMask,seaLevel,appearance});
 const [a,b]=s.levels[0].tiles;assert.equal(a.x1,b.x0);
 const tiles=[{...a,subdivisions:2},{...b,subdivisions:8}];
 const grid={cols:s.cols,rows:s.rows,planeWidth:s.planeWidth,planeDepth:s.planeDepth,heightScale:s.heightScale};
 const original=globalThis.self,messages=[];
 try{
  globalThis.self={postMessage:(data,transfer)=>messages.push({data,transfer})};
  await import('../src/terrain-3d-worker.js?v038');
  self.onmessage({data:{kind:'init-detail',geometry,mesh,elevations,grid,waterMask,seaLevel,appearance}});
  assert.equal(messages.at(-1).data.kind,'detail-ready');
  self.onmessage({data:{kind:'detail',key:'mixed',tiles}});
  const answer=messages.at(-1);assert.equal(answer.data.kind,'detail');
  const [coarse,fine]=answer.data.patches;
  assert.equal(coarse.subdivisions,2);assert.equal(fine.subdivisions,8);
  for(const [patch,tile] of [[coarse,tiles[0]],[fine,tiles[1]]]){
   assert.equal(patch.indices.length/3,focusedTileTriangles(tile));
   assert.ok(patch.vertexData.every(Number.isFinite));
   assert.ok(answer.transfer.includes(patch.indices.buffer));
  }
  const cw=(a.x1-a.x0)*2+1,fw=(b.x1-b.x0)*8+1;
  for(let y=0;y<=(a.y1-a.y0)*2;y++){
   const c=(y*cw+cw-1)*7,f=(y*4*fw)*7;
   for(const k of [0,1,2,6])assert.ok(Math.abs(coarse.vertexData[c+k]-fine.vertexData[f+k])<1e-6);
  }
  // All fine edge vertices are on the exact polyline of the lower-detail edge.
  for(let y=0;y<(a.y1-a.y0)*8;y++){
   const cy=Math.floor(y/4),fraction=(y%4)/4,c=(cy*cw+cw-1)*7,next=c+cw*7,f=y*fw*7;
   assert.ok(Math.abs(fine.vertexData[f+1]-(coarse.vertexData[c+1]*(1-fraction)+coarse.vertexData[next+1]*fraction))<1e-6);
   for(let k=0;k<3;k++)assert.ok(Math.abs(fine.materialColors[f/7*3+k]-(coarse.materialColors[c/7*3+k]*(1-fraction)+coarse.materialColors[next/7*3+k]*fraction))<1e-6);
  }
  assert.deepEqual(elevations,[-.5,.9,.35,.48,1.7,1.2]);
 }finally{if(original===undefined)delete globalThis.self;else globalThis.self=original;}
});
