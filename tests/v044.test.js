import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPickBounds,PICK_BLOCK_INDICES,pickBlockIntersects} from '../src/terrain-pick-bounds.js';
import {pickRenderedRay} from '../src/terrain-3d-focus.js';
import {Terrain3DViewer} from '../src/terrain-3d.js';
import {buildAdaptiveTerrainLevels} from '../src/terrain-3d-lod.js';
import {buildElevationSurface} from '../src/terrain-3d-model.js';
import {buildMorphFields} from '../src/terrain-3d-morph.js';
import {DEFAULTS,generateStage} from '../src/engine.js';
function grid(cols=64,rows=32){
 const vertexData=new Float32Array((cols+1)*(rows+1)*7),insideMask=new Uint8Array((cols+1)*(rows+1)).fill(1);
 for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){
  const h=Math.sin(x/8)*Math.cos(y/6)*.08;
  vertexData.set([x/cols*4-2,h,y/rows*2-1,0,1,0,h],(y*(cols+1)+x)*7);
 }
 const s={cols,rows,planeWidth:4,planeDepth:2,vertexData,insideMask,heightScale:1,minY:-.08,maxY:.08,seaLevel:-.3,levels:buildAdaptiveTerrainLevels(cols,rows,insideMask,4,2)};
 s.morphFields=buildMorphFields(s);return s;
}
test('block bounds preserve exact picking over arbitrary draw ranges and morphed meshes',()=>{
 const s=grid();
 for(const l of s.levels){
  const pickBounds=buildPickBounds(s.vertexData,l.indices);
  for(const range of [l.tiles[0],{offset:0,count:l.indices.length}])for(const weight of [0,.43,1]){
   const draw={indices:l.indices,start:range.offset,count:range.count,morph:{mode:1,from:0,to:Math.log2(l.step),weight}};
   const bare={terrain:[draw],multiplier:4,near:.01,far:15};
   const indexed={...bare,terrain:[{...draw,pickBounds}]};
   for(let i=0;i<40;i++){
    const x=Math.sin(i*53)*2.1,z=Math.cos(i*89)*1.1;
    const eye=[x,2,z],ray=i%2?[.17,-.98,.09]:[0,-1,0];
    assert.deepEqual(pickRenderedRay(s,indexed,eye,ray),pickRenderedRay(s,bare,eye,ray));
   }
  }
 }
});
test('fine mesh bounds eliminate most triangle candidates and handle water, clipping, and parallel rays',()=>{
 const s=grid(256,256),l=s.levels[0],bounds=buildPickBounds(s.vertexData,l.indices);
 const eye=[.11,2,.11],ray=[0,-1,0];let candidates=0;
 for(let i=0;i<bounds.length;i+=4)if(pickBlockIntersects(bounds,i,eye,ray,0,10))candidates+=PICK_BLOCK_INDICES/3;
 assert.ok(candidates<l.indices.length/3*.02,`${candidates} candidate tris`);
 const water=new Float32Array([-2,.5,-1,2,.5,-1,2,.5,1,-2,.5,-1,2,.5,1,-2,.5,1]);s.ocean=water;s.waterPickBounds={ocean:buildPickBounds(water,null,3)};
 const frame={terrain:[{indices:l.indices,count:l.indices.length,pickBounds:bounds}],multiplier:1};
 assert.deepEqual(pickRenderedRay(s,frame,eye,ray),[.11,.5,.11]);
 assert.equal(pickRenderedRay(s,{...frame,far:.5},eye,ray),null);
 assert.equal(pickRenderedRay(s,frame,[3,2,3],ray),null);
});
test('production mesh construction skips redundant legacy index buffers but preserves stitched geometry',()=>{
 const locked=[];
 for(let stage=1;stage<=4;stage++)locked.push({stage,data:generateStage(stage,locked,{...DEFAULTS[stage],...(stage===2?{averageArea:locked[0].data.areaKm2/100}:{})})});
 const [g,m,,e]=locked.map(r=>r.data);
 const legacy=buildElevationSurface(g,m,e.elevations),next=buildElevationSurface(g,m,e.elevations,()=>{},{includeUniformLevels:false});
 assert.equal(next.uniformLevels.length,0);assert.equal(legacy.uniformLevels.length,4);
 assert.deepEqual(next.levels,legacy.levels);assert.deepEqual(next.vertexData,legacy.vertexData);
 assert.deepEqual(buildMorphFields(next),buildMorphFields(legacy));
});
test('camera clearance only repeats when the pose, relief or active patch morph changes',()=>{
 const v=Object.create(Terrain3DViewer.prototype);let calls=0;
 Object.assign(v,{surface:grid(),target:[0,0,0],distance:.1,pitch:.9,yaw:.2,heightMultiplier:1,detailPatches:new Map(),detailPlan:new Map(),_heightAt(){calls++;return .01;}});
 const a=v._cameraEye(),first=calls;assert.ok(first>0);
 assert.deepEqual(v._cameraEye(),a);assert.equal(calls,first);
 a[1]=99;assert.notEqual(v._cameraEye()[1],99);
 v.heightMultiplier=2;v._cameraEye();assert.ok(calls>first);
 const second=calls;const p={vertexData:new Float32Array(7),subdivisions:2,x0:0,y0:0,x1:32,y1:32,visible:true,phase:.3};
 v.morphTextures={};v.detailPatches.set(0,p);v._cameraEye();assert.ok(calls>second);
 const third=calls;p.phase=.6;v._cameraEye();assert.ok(calls>third);
});
test('worker response reuses overlapping exact-detail tiles but never uploads obsolete tiles',()=>{
 const prev=globalThis.Worker;class WorkerStub{postMessage(){}terminate(){}};globalThis.Worker=WorkerStub;
 try{
  const v=Object.create(Terrain3DViewer.prototype),tiles=[0,1,2].map(id=>({id,x0:id*32,x1:id*32+32,y0:0,y1:32,subdivisions:2}));
  Object.assign(v,{surface:grid(),detailSource:{},detailPlan:new Map([[1,2],[2,4]]),detailSignature:'new',detailPatches:new Map(),disposed:false,lost:false,_dispatchFocusedDetail(){},_trimFocusedPatches(){},drawSoon(){},_uploadFocusedPatch(id,patch){this.detailPatches.set(id,patch);}});
  v._startDetailWorker();Object.assign(v.detailState,{ready:true,busy:true,key:'old',requested:tiles});
  v.detailWorker.onmessage({data:{kind:'detail',key:'old',patches:tiles.map(t=>({...t,indices:new Uint32Array(3)}))}});
  assert.deepEqual([...v.detailPatches.keys()],[1]);assert.equal(v.detailState.busy,false);
 }finally{if(prev===undefined)delete globalThis.Worker;else globalThis.Worker=prev;}
});
