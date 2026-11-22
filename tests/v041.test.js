import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceMaterialAtSite,buildSurfaceMaterialField,SURFACE_MATERIALS} from '../src/terrain-surface-materials.js';
import {createTerrainSampler} from '../src/terrain-sampler.js';
import {buildElevationSurface} from '../src/terrain-3d-model.js';
import {Terrain3DViewer,TERRAIN_FRAGMENT_SHADER} from '../src/terrain-3d.js';
const climate={meanTemp:[18,18,18,18,18,18,18,18],moisture:[.4,.4,.4,.4,.4,.4,.4,.4]};
const appearance={stage:13,climate,water:[0,0,0,0,0,0,0,1],soils:{soilType:[1,3,4,4,4,9,6,0],fertility:Array(8).fill(.6)},biomes:{biome:[14,9,10,7,6,2,15,0],treePotential:[0,0,0,0,.9,0,0,0]}};
const mesh={width:80,height:20,areaKm2:1600,cells:Array.from({length:8},(_,i)=>({x:5+i*10,y:10,poly:[i*10,0,i*10+10,0,i*10+10,20,i*10,20],neighbors:[i-1,i+1].filter(j=>j>=0&&j<8)}))};
const geometry={shape:'rectangle',width:80,height:20};
const elevations=[.5,.3,.4,.2,.4,.6,.1,-.5];
const profile=(a,i)=>surfaceMaterialAtSite(a,i);
const largest=w=>w.indexOf(Math.max(...w));
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('historical climate, soil, biome and vegetation profiles use only their own stage data',()=>{
 const a=structuredClone(appearance),before=JSON.stringify(a);
 const c={...a,stage:9}; assert.deepEqual(profile(c,0),profile(c,1));
 assert.deepEqual(profile(c,0),profile({...c,soils:undefined,biomes:undefined},0));
 const s={...a,stage:12};assert.equal(largest(profile(s,0)),0);assert.equal(largest(profile(s,1)),1);
 for(const [i,kind] of [[0,0],[1,1],[3,3],[4,4],[5,5],[6,6],[7,7]])assert.equal(largest(profile(a,i)),kind,SURFACE_MATERIALS[kind]);
 const v={...a,stage:13,vegetation:{canopyCover:Array(8).fill(.85),groundCover:Array(8).fill(.85)}};
 assert.ok(profile(v,3)[4]>profile(a,3)[4]);
 const bare={...v,vegetation:{canopyCover:Array(8).fill(0),groundCover:Array(8).fill(0)}};
 assert.equal(profile(bare,4)[4],0);assert.equal(profile(bare,4)[3],0);
 for(const p of [a,c,s,v,bare])for(let i=0;i<8;i++){
  const w=profile(p,i);assert.equal(w.length,8);assert.ok(w.every(x=>Number.isFinite(x)&&x>=0&&x<=1));near(w.reduce((a,b)=>a+b,0),1);
 }
 assert.deepEqual(surfaceMaterialAtSite({...a,stage:11},0,[0,-1,-1,-1,-1,-1,-1,-1]),[0,0,0,0,0,0,0,1]);
 assert.deepEqual(surfaceMaterialAtSite(c,0,[0,-1,-1,-1,-1,-1,-1,-1]),profile(c,0));
 assert.equal(JSON.stringify(a),before);
});

test('material field is deterministic, bounded and normalized even at sparse boundaries',()=>{
 const sampler=createTerrainSampler(mesh),f=buildSurfaceMaterialField(sampler,appearance,320,80);
 assert.equal(f.width,257);assert.equal(f.height,81);assert.equal(f.data.length,257*81*8);
 assert.deepEqual(buildSurfaceMaterialField(sampler,appearance,320,80),f);
 const count=f.width*f.height;
 for(let i=0;i<count;i++){
  let sum=0;for(let k=0;k<4;k++)sum+=f.data[i*4+k]+f.data[count*4+i*4+k];assert.equal(sum,255);
 }
 // At a source site, the dominant profile survives the interpolation.
 const i=40*f.width+16;assert.ok(f.data[i*4]>f.data[i*4+1]);
 assert.equal(buildSurfaceMaterialField(sampler,null,320,80),null);
});

test('surface profiles do not change terrain, coastlines or water meshes',()=>{
 const opts={seaLevel:0,waterMask:appearance.water};
 const before=JSON.stringify({mesh,elevations,appearance});
 const base=buildElevationSurface(geometry,mesh,elevations,()=>{},opts);
 const decorated=buildElevationSurface(geometry,mesh,elevations,()=>{},{...opts,appearance});
 assert.equal(base.surfaceMaterials,null);assert.ok(decorated.surfaceMaterials.data instanceof Uint8Array);
 assert.deepEqual(base.vertexData,decorated.vertexData);assert.deepEqual(base.levels,decorated.levels);assert.deepEqual(base.ocean,decorated.ocean);assert.deepEqual(base.hydrology,decorated.hydrology);
 assert.equal(JSON.stringify({mesh,elevations,appearance}),before);
});

test('actual worker includes transferable surface coverage once, not in per-tile buffers',async()=>{
 const old=globalThis.self,messages=[];
 try{
  globalThis.self={postMessage:(data,transfer)=>messages.push({data,transfer})};
  await import('../src/terrain-3d-worker.js?v041');
  self.onmessage({data:{geometry,mesh,elevations,appearance,waterMask:appearance.water,seaLevel:0}});
  const result=messages.at(-1);assert.equal(result.data.kind,'success');
  const surface=result.data.result;assert.ok(result.transfer.includes(surface.surfaceMaterials.data.buffer));
  assert.equal(surface.uniformLevels.length,0);
  assert.ok(surface.levels.every(l=>result.transfer.includes(l.pickBounds.buffer)));
  assert.ok(Object.values(surface.waterPickBounds).every(b=>result.transfer.includes(b.buffer)));
  const grid={cols:surface.cols,rows:surface.rows,planeWidth:surface.planeWidth,planeDepth:surface.planeDepth,heightScale:surface.heightScale};
  self.onmessage({data:{kind:'init-detail',geometry,mesh,elevations,appearance,waterMask:appearance.water,seaLevel:0,grid}});
  assert.equal(messages.at(-1).data.kind,'detail-ready');
  self.onmessage({data:{kind:'detail',key:'test',tiles:[{...surface.levels[0].tiles[0],subdivisions:2}]}});
  assert.equal(messages.at(-1).data.kind,'detail');assert.equal(messages.at(-1).data.patches[0].surfaceMaterials,undefined);
  assert.ok(messages.at(-1).transfer.includes(messages.at(-1).data.patches[0].pickBounds.buffer));
 }finally{if(old===undefined)delete globalThis.self;else globalThis.self=old;}
});

test('WebGL upload uses one bounded RGBA8 array with complete neutral fallback and linear filtering',()=>{
 const v=Object.create(Terrain3DViewer.prototype),calls=[];
 const gl={TEXTURE0:100,TEXTURE_2D_ARRAY:1,TEXTURE_MIN_FILTER:2,TEXTURE_MAG_FILTER:3,TEXTURE_WRAP_S:4,TEXTURE_WRAP_T:5,LINEAR:6,CLAMP_TO_EDGE:7,RGBA8:8,RGBA:9,UNSIGNED_BYTE:10,createTexture:()=>({}),activeTexture:(...a)=>calls.push(['unit',...a]),bindTexture:(...a)=>calls.push(['bind',...a]),texParameteri:(...a)=>calls.push(['param',...a]),texImage3D:(...a)=>calls.push(['image',...a])};
 const f=buildSurfaceMaterialField(createTerrainSampler(mesh),appearance,32,16);
 Object.assign(v,{gl,surface:{surfaceMaterials:f}});v._uploadSurfaceMaterials();
 let upload=calls.find(a=>a[0]==='image');assert.deepEqual(upload.slice(1,10),[1,0,8,33,17,2,0,9,10]);assert.equal(upload[10],f.data);
 assert.deepEqual(calls[0],['unit',102]);assert.deepEqual(calls.at(-1),['unit',100]);
 assert.ok(calls.some(a=>a[0]==='param'&&a[2]===gl.TEXTURE_MIN_FILTER&&a[3]===gl.LINEAR));
 calls.length=0;v.surface.surfaceMaterials=null;v._uploadSurfaceMaterials();upload=calls.find(a=>a[0]==='image');assert.deepEqual(upload.slice(4,7),[1,1,2]);assert.deepEqual([...upload[10]],[0,0,0,0,0,0,0,255]);
});

test('shader uses physically anchored distinct material patterns and filters detail using screen footprint',()=>{
 const shader=TERRAIN_FRAGMENT_SHADER;
 assert.match(shader,/vPosition\.xz\/uWorldScale/);assert.match(shader,/texture\(uSurfaceMaterials/);
 for(const material of ['rock','sand','soil','grass','forest','snow','wetland'])assert.match(shader,new RegExp(`${material}\\*`));
 assert.match(shader,/footprint\*\.75/);assert.match(shader,/rippleFade/);assert.match(shader,/crowns/);assert.match(shader,/strata/);
 assert.ok(shader.indexOf('if(uWater==1)')<shader.indexOf('texture(uSurfaceMaterials'));
});
