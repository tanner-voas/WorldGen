import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateStage} from '../src/engine.js';
import {createSurfaceSampler,sampleElevation,sampleTerrainFields,buildElevationSurface,buildFocusedTerrainPatch} from '../src/terrain-3d-model.js';
import {buildAdaptiveTerrainLevels,buildUniformTerrainLevels} from '../src/terrain-3d-lod.js';

const shapes=[{shape:'rectangle',width:2048,height:1024},{shape:'circle',radius:800},{shape:'ellipse',radiusX:1000,radiusY:500}];
function world(shape,count){
 const locked=[];
 for(let stage=1;stage<=9;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?shape:{}),...(stage===2?{averageArea:locked[0].data.areaKm2/count}:{})};
  locked.push({stage,data:generateStage(stage,locked,settings)});
 }
 return locked.map(x=>x.data);
}
function fixture(){
 const geometry={shape:'rectangle',width:60,height:30};
 const cells=Array.from({length:6},(_,i)=>({x:i*10+5,y:15,poly:[i*10,0,i*10+10,0,i*10+10,30,i*10,30],neighbors:[i-1,i+1].filter(j=>j>=0&&j<6)}));
 const mesh={width:60,height:30,areaKm2:1800,cells},elevations=[-.5,.9,.35,.48,1.7,1.2];
 const hydrology={lakeId:[-1,-1,0,0,-1,-1],lakeDepth:[0,0,.25,.12,0,0],lakes:[{id:0,level:.6,cells:[2,3]}],flowTo:[-1,0,1,2,3,4],discharge:[0,0,0,0,1,1],channels:[]};
 return {geometry,mesh,elevations,hydrology};
}
function baseHeight(surface,geometry,x,y){
 const gx=x/geometry.width*surface.cols,gy=y/geometry.height*surface.rows;
 const i=Math.min(surface.cols-1,Math.floor(gx)),j=Math.min(surface.rows-1,Math.floor(gy));
 const fx=gx-i,fy=gy-j,h=(a,b)=>surface.vertexData[(b*(surface.cols+1)+a)*7+6];
 const a=h(i,j),b=h(i+1,j),c=h(i,j+1),d=h(i+1,j+1);
 return fx+fy<=1?a+(b-a)*fx+(c-a)*fy:d+(c-d)*(1-fx)+(b-d)*(1-fy);
}

test('lake basin sampling remains submerged, continuous between its member sites, and meets the saved shore level',()=>{
 const {mesh,elevations,hydrology}=fixture(),snapshot=JSON.stringify([mesh,elevations,hydrology]);
 const sampler=createSurfaceSampler(mesh,elevations,{hydrology});
 const colors=new Float32Array(mesh.cells.length*3).fill(.5);
 for(let x=20.01;x<40;x+=.1){
  const height=sampleElevation(sampler,elevations,x,15);
  assert.ok(height<.6);assert.equal(sampleTerrainFields(sampler,elevations,colors,x,15).height,height);
 }
 for(const edge of [20,40]){
  assert.ok(Math.abs(sampleElevation(sampler,elevations,edge,15)-.6)<1e-9);
  for(const delta of [-.00001,.00001])assert.ok(Math.abs(sampleElevation(sampler,elevations,edge+delta,15)-.6)<1e-7);
 }
 assert.ok(Math.abs(sampleElevation(sampler,elevations,30-.00001,15)-sampleElevation(sampler,elevations,30+.00001,15))<1e-6);
 assert.equal(JSON.stringify([mesh,elevations,hydrology]),snapshot);
});

test('six generated worlds retain ocean classification and show every recorded lake center below its saved water surface',()=>{
 let total=0,previouslyObscured=0;
 for(const shape of shapes)for(const count of [1200,5000]){
  const [geometry,mesh,,,coast,,erosion,,hydrology]=world(shape,count),elevations=erosion.elevations;
  const options={waterMask:coast.water,seaLevel:coast.seaLevel};
  const snapshot=JSON.stringify([mesh,coast,erosion,hydrology]);
  const old=buildElevationSurface(geometry,mesh,elevations,()=>{},options);
  const next=buildElevationSurface(geometry,mesh,elevations,()=>{},{...options,hydrology});
  for(let i=0;i<mesh.cells.length;i++){
   const {x,y}=mesh.cells[i],height=baseHeight(next,geometry,x,y);
   assert.equal(+(height<coast.seaLevel),coast.water[i]);
   if(hydrology.lakeId[i]<0)continue;
   const level=hydrology.lakes[hydrology.lakeId[i]].level;
   if(baseHeight(old,geometry,x,y)>=level)previouslyObscured++;
   assert.ok(height<level,`${shape.shape}/${count} lake cell ${i}`);total++;
  }
  assert.equal(JSON.stringify([mesh,coast,erosion,hydrology]),snapshot);
 }
 assert.ok(total>100&&previouslyObscured>0);
});

test('lake-free hydrology leaves the entire height and LOD geometry unchanged',()=>{
 const {geometry,mesh,elevations,hydrology}=fixture();
 const opts={waterMask:[1,0,0,0,0,0],seaLevel:0};
 const a=buildElevationSurface(geometry,mesh,elevations,()=>{},opts);
 const b=buildElevationSurface(geometry,mesh,elevations,()=>{},{...opts,hydrology:{...hydrology,lakes:[],lakeId:Array(6).fill(-1)}});
 assert.deepEqual(a.vertexData,b.vertexData);assert.deepEqual(a.levels,b.levels);assert.deepEqual(a.uniformLevels,b.uniformLevels);
 assert.equal(b.hydrology.lakes.length,0);
});

test('lake blocks retain every original triangle in uniform and tiled LODs without gaps',()=>{
 const cols=32,rows=32,stride=cols+1,inside=new Uint8Array(stride*(rows+1)).fill(1),lakeMask=new Uint8Array(inside.length);
 lakeMask[12*stride+12]=1;
 const base=buildUniformTerrainLevels(cols,rows,inside,{lakeMask});
 const adaptive=buildAdaptiveTerrainLevels(cols,rows,inside,4.8,4.8,{lakeMask});
 const key=(a,b,c)=>[a,b,c].sort((x,y)=>x-y).join(',');
 const fine=[];for(let y=8;y<16;y++)for(let x=8;x<16;x++){
  const a=y*stride+x;fine.push(key(a,a+stride,a+1),key(a+1,a+stride,a+stride+1));
 }
 for(const level of [...base,...adaptive]){
  const tris=new Set(),edges=new Map();
  for(let i=0;i<level.indices.length;i+=3){
   const tri=Array.from(level.indices.subarray(i,i+3));tris.add(key(...tri));
   for(let j=0;j<3;j++){
    const edge=[tri[j],tri[(j+1)%3]].sort((a,b)=>a-b).join(',');edges.set(edge,(edges.get(edge)||0)+1);
   }
  }
  for(const tri of fine)assert.ok(tris.has(tri));
  for(const [edge,count] of edges){
   const [a,b]=edge.split(',').map(Number),ax=a%stride,bx=b%stride,ay=Math.floor(a/stride),by=Math.floor(b/stride);
   const outside=(ax===bx&&(ax===0||ax===cols))||(ay===by&&(ay===0||ay===rows));
   assert.equal(count,outside?1:2);
  }
 }
 assert.ok(base.at(-1).indices.length<base[0].indices.length);
});

test('local refinement worker preserves the lake basin, and shares exact base tile edges',async()=>{
 const {geometry,mesh,elevations,hydrology}=fixture();
 const options={hydrology,waterMask:[1,0,0,0,0,0],seaLevel:0};
 const surface=buildElevationSurface(geometry,mesh,elevations,()=>{},options);
 const tile=surface.levels[0].tiles.find(t=>t.x0<surface.cols*.5&&t.x1>=surface.cols*.5&&t.y0<surface.rows*.5&&t.y1>=surface.rows*.5);
 assert.ok(tile);
 const grid={cols:surface.cols,rows:surface.rows,planeWidth:surface.planeWidth,planeDepth:surface.planeDepth,heightScale:surface.heightScale};
 const messages=[],original=globalThis.self;
 try{
  globalThis.self={postMessage:m=>messages.push(m)};
  await import('../src/terrain-3d-worker.js?v036');
  self.onmessage({data:{kind:'init-detail',geometry,mesh,elevations,grid,...options}});
  assert.equal(messages.at(-1).kind,'detail-ready');
  self.onmessage({data:{kind:'detail',key:'lake',tiles:[tile]}});
  const {kind,patches}=messages.at(-1);assert.equal(kind,'detail');
  const patch=patches[0],direct=buildFocusedTerrainPatch(geometry,mesh,elevations,grid,tile,options);
  assert.deepEqual(patch.vertexData,direct.vertexData);
  const nx=(tile.x1-tile.x0)*patch.subdivisions,ny=(tile.y1-tile.y0)*patch.subdivisions;
  let interior=0;
  for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
   const gx=tile.x0+i/patch.subdivisions,gy=tile.y0+j/patch.subdivisions,x=gx/surface.cols*geometry.width,y=gy/surface.rows*geometry.height;
   const v=patch.vertexData[(j*(nx+1)+i)*7+6];
   const border=Math.min(i,j,nx-i,ny-j)/patch.subdivisions;
   if(border===0)assert.ok(Math.abs(v-baseHeight(surface,geometry,x,y))<2e-7);
   if(border>=.5&&x>21&&x<39){assert.ok(v<.6);interior++;}
  }
  assert.ok(interior>0);
 }finally{if(original===undefined)delete globalThis.self;else globalThis.self=original;}
});
