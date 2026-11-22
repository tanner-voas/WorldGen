import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateStage} from '../src/engine.js';
import {createTerrainSampler} from '../src/terrain-sampler.js';
import {createSurfaceSampler,sampleElevation,sampleTerrainFields,buildElevationSurface,buildFocusedTerrainPatch} from '../src/terrain-3d-model.js';
import {buildAdaptiveTerrainLevels,buildUniformTerrainLevels} from '../src/terrain-3d-lod.js';

const shapes=[{shape:'rectangle',width:2048,height:1024},{shape:'circle',radius:800},{shape:'ellipse',radiusX:1000,radiusY:500}];
function world(shape,count){
 const locked=[];
 for(let stage=1;stage<=7;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?shape:{}),...(stage===2?{averageArea:locked[0].data.areaKm2/count,distribution:'jittered'}:{})};
  locked.push({stage,data:generateStage(stage,locked,settings)});
 }
 return locked.map(x=>x.data);
}
function baseHeight(surface,geometry,x,y){
 const gx=x/geometry.width*surface.cols,gy=y/geometry.height*surface.rows;
 const i=Math.min(surface.cols-1,Math.floor(gx)),j=Math.min(surface.rows-1,Math.floor(gy));
 const fx=gx-i,fy=gy-j,h=(a,b)=>surface.vertexData[(b*(surface.cols+1)+a)*7+6];
 const a=h(i,j),b=h(i+1,j),c=h(i,j+1),d=h(i+1,j+1);
 return fx+fy<=1?a+(b-a)*fx+(c-a)*fy:d+(c-d)*(1-fx)+(b-d)*(1-fy);
}
const mesh={width:20,height:10,areaKm2:200,cells:[{x:5,y:5},{x:15,y:5}]};

test('land and ocean meet continuously at their shared Voronoi boundary even for contradictory legacy elevations',()=>{
 const seaLevel=.25,elevations=[-1,1],waterMask=[0,1];
 const sampler=createSurfaceSampler(mesh,elevations,{waterMask,seaLevel});
 const colors=new Float32Array([1,0,0,0,0,1]);
 assert.equal(sampleElevation(sampler,elevations,10,5),seaLevel);
 for(const y of [0,5,10]){
  for(const dx of [4,1,.01,.00001]){
   const left=sampleElevation(sampler,elevations,10-dx,y),right=sampleElevation(sampler,elevations,10+dx,y);
   assert.ok(left>seaLevel&&right<seaLevel);
   assert.equal(sampleTerrainFields(sampler,elevations,colors,10-dx,y).height,left);
   assert.equal(sampleTerrainFields(sampler,elevations,colors,10+dx,y).height,right);
  }
  assert.ok(Math.abs(sampleElevation(sampler,elevations,10+.00001,y)-seaLevel)<1e-7);
 }
 assert.deepEqual(elevations,[-1,1]);assert.deepEqual(waterMask,[0,1]);
});

test('all-land and all-ocean masks are finite and preserve their signs; omitted mask leaves elevation-only sampling unchanged',()=>{
 const heights=[-1,.9];
 for(const mask of [[0,0],[1,1]]){
  const sampler=createSurfaceSampler(mesh,heights,{waterMask:mask,seaLevel:.25});
  for(let x=0;x<=20;x++){
   const h=sampleElevation(sampler,heights,x,5);
   assert.ok(Number.isFinite(h));assert.equal(+(h<.25),mask[0]);
  }
 }
 const old=createTerrainSampler(mesh,.72),next=createSurfaceSampler(mesh,heights);
 for(let x=0;x<=20;x++)assert.equal(sampleElevation(next,heights,x,5),sampleElevation(old,heights,x,5));
 assert.throws(()=>createSurfaceSampler(mesh,heights,{waterMask:[0]}),/coastline mask/);
});

test('all six generated coastlines retain every cell-center land/ocean classification in the actual base mesh',()=>{
 let oldDisagreement=0,checked=0;
 for(const shape of shapes)for(const count of [1200,5000]){
  const [g,m,,,c,,e]=world(shape,count),snapshot=JSON.stringify([m,c,e]);
  const options={waterMask:c.water,seaLevel:c.seaLevel};
  const sampler=createSurfaceSampler(m,e.elevations,options),old=createTerrainSampler(m,.72);
  const surface=buildElevationSurface(g,m,e.elevations,()=>{},options);
  for(let i=0;i<m.cells.length;i++){
   const {x,y}=m.cells[i];
   if(+(sampleElevation(old,e.elevations,x,y)<c.seaLevel)!==c.water[i])oldDisagreement++;
   assert.equal(+(sampleElevation(sampler,e.elevations,x,y)<c.seaLevel),c.water[i]);
   assert.equal(+(baseHeight(surface,g,x,y)<c.seaLevel),c.water[i],`${shape.shape}/${count} cell ${i}`);
   checked++;
  }
  assert.equal(JSON.stringify([m,c,e]),snapshot);
 }
 assert.ok(oldDisagreement>0&&checked>18000);
});

function crossingTriangles(indices,mask){
 const found=[];
 for(let i=0;i<indices.length;i+=3){
  const tri=Array.from(indices.subarray(i,i+3));
  if(tri.some(id=>mask[id]!==mask[tri[0]]))found.push(tri.sort((a,b)=>a-b).join(','));
 }
 return found.sort();
}
function assertWatertight(indices,cols,rows){
 const edges=new Map(),stride=cols+1;
 for(let i=0;i<indices.length;i+=3){
  const tri=indices.subarray(i,i+3);
  for(let j=0;j<3;j++){
   const a=Math.min(tri[j],tri[(j+1)%3]),b=Math.max(tri[j],tri[(j+1)%3]);
   const key=`${a},${b}`;edges.set(key,(edges.get(key)||0)+1);
  }
 }
 for(const [key,n] of edges){
  const [a,b]=key.split(',').map(Number),ax=a%stride,bx=b%stride,ay=Math.floor(a/stride),by=Math.floor(b/stride);
  const outer=(ax===bx&&(ax===0||ax===cols))||(ay===by&&(ay===0||ay===rows));
  assert.equal(n,outer?1:2,`unstitched edge ${key}`);
 }
}
test('all global and adaptive LODs retain identical shoreline-crossing triangles and stitch to adjacent coarse blocks',()=>{
 const cols=64,rows=64,inside=new Uint8Array((cols+1)*(rows+1)).fill(1),mask=new Uint8Array(inside.length);
 for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++)mask[y*(cols+1)+x]=+(x<20||Math.hypot(x-46,y-42)<5);
 const levels=[...buildAdaptiveTerrainLevels(cols,rows,inside,4.8,4.8,{coastMask:mask}),...buildUniformTerrainLevels(cols,rows,inside,{coastMask:mask})];
 const baseline=crossingTriangles(levels[0].indices,mask);assert.ok(baseline.length);
 for(const level of levels){
  assert.deepEqual(crossingTriangles(level.indices,mask),baseline);
  assertWatertight(level.indices,cols,rows);
 }
 assert.ok(levels.at(-1).indices.length<levels[0].indices.length);
});

test('focused worker uses the same locked coastline as the base mesh and preserves its outer seams',async()=>{
 const [geometry,m,,,coast]=world(shapes[0],600),elevations=coast.elevations;
 const options={waterMask:coast.water,seaLevel:coast.seaLevel};
 const surface=buildElevationSurface(geometry,m,elevations,()=>{},options);
 // Select a tile actually containing a shoreline.
 const tile=surface.levels[0].tiles.find(t=>{
  let land=false,wet=false;
  for(let y=t.y0;y<=t.y1;y++)for(let x=t.x0;x<=t.x1;x++){
   if(surface.vertexData[(y*(surface.cols+1)+x)*7+6]<coast.seaLevel)wet=true;else land=true;
  }
  return land&&wet;
 });assert.ok(tile);
 const messages=[],original=globalThis.self;
 try{
  globalThis.self={postMessage:data=>messages.push(data)};
  await import('../src/terrain-3d-worker.js?v035');
  const grid={cols:surface.cols,rows:surface.rows,planeWidth:surface.planeWidth,planeDepth:surface.planeDepth,heightScale:surface.heightScale};
  self.onmessage({data:{kind:'init-detail',geometry,mesh:m,elevations,grid,...options}});
  assert.equal(messages.at(-1).kind,'detail-ready');
  self.onmessage({data:{kind:'detail',key:'coast',tiles:[tile]}});
  const message=messages.at(-1);assert.equal(message.kind,'detail');
  const patch=message.patches[0],direct=buildFocusedTerrainPatch(geometry,m,elevations,grid,tile,options);
  assert.deepEqual(patch.vertexData,direct.vertexData);
  const nx=(tile.x1-tile.x0)*patch.subdivisions,ny=(tile.y1-tile.y0)*patch.subdivisions;
  const sampler=createSurfaceSampler(m,elevations,options);
  let wet=0,land=0;
  for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
   const gx=tile.x0+i/patch.subdivisions,gy=tile.y0+j/patch.subdivisions;
   const x=geometry.width*gx/surface.cols,y=geometry.height*gy/surface.rows;
   const value=patch.vertexData[(j*(nx+1)+i)*7+6];
   const border=Math.min(i,nx-i,j,ny-j)/patch.subdivisions;
   if(border===0)assert.ok(Math.abs(value-baseHeight(surface,geometry,x,y))<2e-7);
   if(border>=.5){
    const expected=sampleElevation(sampler,elevations,x,y);
    assert.ok(Math.abs(value-expected)<2e-7);
    if(value<coast.seaLevel)wet++;else land++;
   }
  }
  assert.ok(wet>0&&land>0);
 }finally{if(original===undefined)delete globalThis.self;else globalThis.self=original;}
});
