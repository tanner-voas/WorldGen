import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateStage} from '../src/engine.js';
import {terrainHeightScale,sampleElevation,buildElevationSurface,buildFocusedTerrainPatch} from '../src/terrain-3d-model.js';
import {createTerrainSampler} from '../src/render.js';
import {closeUpCameraLimits,focusedTerrainTiles,LOCAL_TERRAIN_SUBDIVISIONS} from '../src/terrain-3d-detail.js';

function world(shape,sites=260){
 const locked=[];
 for(let stage=1;stage<=4;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?shape:{}),...(stage===2?{averageArea:locked[0].data.areaKm2/sites}:{})};
  locked.push({stage,data:generateStage(stage,locked,settings)});
 }
 return locked.map(item=>item.data);
}

const shapes=[
 {shape:'rectangle',width:1000,height:600},
 {shape:'circle',radius:530},
 {shape:'ellipse',radiusX:750,radiusY:390}
];

test('physically scaled terrain relief does not produce world-sized mountains',()=>{
 for(const g of [{width:2048,height:1024},{width:800,height:500},{width:128,height:96}]){
  const h=terrainHeightScale(g),width=4.8;
  assert.ok(h>0&&h<=.24);
  assert.ok(1.8*h/width<.1,'render mountains must not reach 10% of world width');
 }
 assert.ok(terrainHeightScale({width:800,height:500})>terrainHeightScale({width:2048,height:1024}));
});

test('continuous kernel smooths site-centered impulses without changing source samples',()=>{
 const mesh={width:100,height:100,areaKm2:10000,cells:[
  {x:25,y:25},{x:50,y:25},{x:75,y:25},
  {x:25,y:50},{x:50,y:50},{x:75,y:50},
  {x:25,y:75},{x:50,y:75},{x:75,y:75}
 ]};
 const elevation=[0,0,0,0,1.5,0,0,0,0],snapshot=elevation.slice();
 const sampler=createTerrainSampler(mesh,.72);
 const h=sampleElevation(sampler,elevation,50,50),near=sampleElevation(sampler,elevation,50.001,50.001);
 assert.ok(h>0&&h<1.5,'central peak should be smoothed, not a needle');
 assert.ok(Math.abs(h-near)<1e-4,'sample must change continuously around the peak');
 assert.deepEqual(elevation,snapshot);
});

test('local detail tiles share the base grid edge exactly with finite heights and normals',()=>{
 for(const shape of shapes){
  const [geometry,mesh,,elevation]=world(shape);
  const original=JSON.stringify(elevation.elevations);
  const s=buildElevationSurface(geometry,mesh,elevation.elevations);
  assert.ok(s.heightScale>0);
  const candidates=s.levels[0].tiles.filter(t=>{
   const [stride,mask]=[s.cols+1,s.insideMask];
   return [[t.x0,t.y0],[t.x1,t.y0],[t.x0,t.y1],[t.x1,t.y1]].every(([x,y])=>mask[y*stride+x]);
  });
  assert.ok(candidates.length>0);
  const tile=candidates[Math.floor(candidates.length/2)];
  const patch=buildFocusedTerrainPatch(geometry,mesh,elevation.elevations,s,tile,{subdivisions:LOCAL_TERRAIN_SUBDIVISIONS});
  const dx=(tile.x1-tile.x0)*LOCAL_TERRAIN_SUBDIVISIONS,dy=(tile.y1-tile.y0)*LOCAL_TERRAIN_SUBDIVISIONS;
  assert.equal(patch.vertexCount,(dx+1)*(dy+1));
  assert.ok(patch.indices.length>tile.count*10,'detail patch should have many more triangles than coarse tile');
  assert.ok(patch.vertexData.every(Number.isFinite));
  assert.ok(patch.indices.every(i=>i<patch.vertexCount));
  const fineStride=dx+1;
  const check=(i,j)=>{
   const gx=tile.x0+i/LOCAL_TERRAIN_SUBDIVISIONS,gy=tile.y0+j/LOCAL_TERRAIN_SUBDIVISIONS;
   const bx=Math.floor(gx),by=Math.floor(gy),fx=gx-bx,fy=gy-by;
   const r=(xx,yy)=>s.vertexData[(yy*(s.cols+1)+xx)*7+1];
   const a=(r(bx,by)*(1-fx)+r(bx+1,by)*fx)*(1-fy)+
    (r(bx,by+1)*(1-fx)+r(bx+1,by+1)*fx)*fy;
   const actual=patch.vertexData[(j*fineStride+i)*7+1];
   assert.ok(Math.abs(a-actual)<1e-6,`coarse-fine edge mismatch at ${i},${j}: ${a},${actual}`);
   if(i%LOCAL_TERRAIN_SUBDIVISIONS===0&&j%LOCAL_TERRAIN_SUBDIVISIONS===0){
    const coarseId=(Math.round(gy)*(s.cols+1)+Math.round(gx))*7;
    const fineId=(j*fineStride+i)*7;
    for(let axis=3;axis<=5;axis++)assert.ok(
     Math.abs(patch.vertexData[fineId+axis]-s.vertexData[coarseId+axis])<1e-5,
     `lighting normal mismatch along edge at ${i},${j}`);
   }
  };
  for(let i=0;i<=dx;i++){check(i,0);check(i,dy);}
  for(let j=0;j<=dy;j++){check(0,j);check(dx,j);}
  assert.equal(JSON.stringify(elevation.elevations),original);
 }
});

test('close camera permits a cell larger than screen and chooses up to four interior tiles',()=>{
 const [geometry,mesh,,elevation]=world({shape:'rectangle',width:800,height:500},360);
 const surface=buildElevationSurface(geometry,mesh,elevation.elevations);
 const limits=closeUpCameraLimits(surface.siteSpacing);
 assert.ok(limits.minimumDistance<surface.siteSpacing*.3);
 assert.ok(limits.detailDistance>limits.minimumDistance);
 const tiles=focusedTerrainTiles(surface,[0,0,0]);
 assert.ok(tiles.length>=1&&tiles.length<=4);
 assert.deepEqual(tiles,focusedTerrainTiles(surface,[0,0,0]));
 for(const tile of tiles)assert.ok(tile.x1<=surface.cols&&tile.y1<=surface.rows);
 assert.deepEqual(focusedTerrainTiles(surface,[1000,0,1000]).filter(t=>t.x0<0),[]);
});

test('close-up worker supplies stitched patches, reuses cached tiles and releases them on zoom out',async()=>{
 const {Terrain3DViewer}=await import('../src/terrain-3d.js');
 const [geometry,mesh,,elevation]=world({shape:'rectangle',width:800,height:500},300);
 const surface=buildElevationSurface(geometry,mesh,elevation.elevations);
 const sourceBefore=JSON.stringify(elevation.elevations);
 let launches=0,uploads=0,deletions=0,draws=0;
 class FakeWorker{
  constructor(){launches++;}
  postMessage(data){
   assert.equal(data.kind,'detail');
   const patches=data.tiles.map(tile=>buildFocusedTerrainPatch(data.geometry,data.mesh,data.elevations,data.grid,tile,{appearance:data.appearance}));
   this.onmessage({data:{kind:'detail',key:data.key,patches}});
  }
  terminate(){}
 }
 const gl={ARRAY_BUFFER:34962,ELEMENT_ARRAY_BUFFER:34963,STATIC_DRAW:35044,FLOAT:5126,
  createVertexArray:()=>({}),createBuffer:()=>({}),bindVertexArray(){},bindBuffer(){},
  bufferData(){uploads++;},enableVertexAttribArray(){},vertexAttribPointer(){},
  disableVertexAttribArray(){},vertexAttrib3f(){},deleteBuffer(){deletions++;},deleteVertexArray(){deletions++;}};
 const viewer=Object.create(Terrain3DViewer.prototype);
 Object.assign(viewer,{surface,detailSource:{geometry,mesh,elevations:elevation.elevations,appearance:null},
  detailLimits:closeUpCameraLimits(surface.siteSpacing),distance:.08,target:[0,0,0],
  detailWorker:null,detailSignature:'',detailPatches:new Map(),activeDetailIds:new Set(),
  gl,lost:false,disposed:false,drawSoon(){draws++;},onStatus(){}});
 const original=globalThis.Worker;globalThis.Worker=FakeWorker;
 try{
  viewer._requestFocusedDetail();
  assert.equal(launches,1);
  assert.ok(uploads>0&&viewer.detailPatches.size>0&&draws>0);
  const savedLaunches=launches;
  viewer._requestFocusedDetail();
  assert.equal(launches,savedLaunches,'revisiting the current focus must not rebuild tiles');
  viewer.distance=20;viewer._requestFocusedDetail();
  assert.equal(viewer.detailPatches.size,0);
  assert.ok(deletions>0,'GPU resources should be released on exit from close zoom');
  assert.equal(JSON.stringify(elevation.elevations),sourceBefore);
 }finally{if(original===undefined)delete globalThis.Worker;else globalThis.Worker=original;}
});
