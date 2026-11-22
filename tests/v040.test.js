import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAdaptiveTerrainLevels} from '../src/terrain-3d-lod.js';
import {buildMorphFields,advanceLodMorph,advanceDetailMorph,morphWeight,LOD_MORPH_MS} from '../src/terrain-3d-morph.js';
import {Terrain3DViewer,TERRAIN_VERTEX_SHADER} from '../src/terrain-3d.js';
import {DETAIL_TRIANGLE_BUDGET,focusedTileTriangles} from '../src/terrain-3d-detail.js';

function synthetic(){
 const cols=64,rows=32,stride=cols+1,count=stride*(rows+1);
 const vertexData=new Float32Array(count*7),materialColors=new Float32Array(count*3),inside=new Uint8Array(count).fill(1),protectedMask=new Uint8Array(count);
 for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){
  const i=y*stride+x,h=Math.sin(x*.83)*Math.cos(y*.37);
  vertexData.set([x,h,y,Math.sin(x*.1),1,Math.cos(y*.1),h],i*7);
  materialColors.set([x/cols,y/rows,(h+1)/2],i*3);
  if(x>=8&&x<=16&&y>=8&&y<=16)protectedMask[i]=1;
  if(x<6&&y<6&&x+y<6)inside[i]=0;
 }
 const levels=buildAdaptiveTerrainLevels(cols,rows,inside,4.8,2.4,{lakeMask:protectedMask});
 return {cols,rows,vertexData,materialColors,levels,inside,protectedMask};
}
const near=(a,b,e=2e-6)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);

test('morph reference fields reproduce every indexed LOD vertex and preserve tile edges, protected water blocks and clipped boundaries',()=>{
 const s=synthetic(),{cols,rows,vertexData,materialColors,levels}=s,count=(cols+1)*(rows+1),stride=cols+1;
 const before=vertexData.slice(),beforeMaterial=materialColors.slice(),f=buildMorphFields(s);
 assert.equal(f.layers,4);assert.ok(f.terrain.every(Number.isFinite)&&f.material.every(Number.isFinite));
 const check=(layer,i)=>{
  const k=(layer*count+i)*4;
  for(const [j,v] of [[0,6],[1,3],[2,4],[3,5]])near(f.terrain[k+j],vertexData[i*7+v]);
  for(let j=0;j<3;j++)near(f.material[k+j],materialColors[i*3+j]);
 };
 for(let l=0;l<4;l++){
  for(const i of new Set(levels[l].indices))check(l,i);
  for(let y=0;y<=rows;y++)check(l,y*stride+32);
  for(let y=8;y<=16;y++)for(let x=8;x<=16;x++)check(l,y*stride+x);
 }
 // An interior discarded vertex must actually move, rather than the
 // transition degenerating into the original hard index swap.
 let changed=0;for(let i=0;i<count;i++)if(Math.abs(f.terrain[(3*count+i)*4]-vertexData[i*7+6])>1e-5)changed++;
 assert.ok(changed>100);
 assert.deepEqual(vertexData,before);assert.deepEqual(materialColors,beforeMaterial);
 assert.equal(buildMorphFields({...s,materialColors:null}).material,null);
});

test('projected coarse fields use triangle barycentric coordinates, not bilinear interpolation',()=>{
 const s=synthetic(),{cols,rows,vertexData,levels}=s,stride=cols+1,count=stride*(rows+1),f=buildMorphFields(s);
 const coarse=levels[3].indices;let checked=0;
 for(let k=0;k<coarse.length;k+=3){
  const a=coarse[k],b=coarse[k+1],c=coarse[k+2],ax=a%stride,ay=Math.floor(a/stride),bx=b%stride,by=Math.floor(b/stride),cx=c%stride,cy=Math.floor(c/stride);
  if((ax+bx)%2||(ay+by)%2)continue;
  const i=((ay+by)/2)*stride+(ax+bx)/2;
  near(f.terrain[(3*count+i)*4],(vertexData[a*7+6]+vertexData[b*7+6])/2);checked++;
 }
 assert.ok(checked>10);
});

test('global LOD reversals retrace the current surface, finish, and queue a different target without resetting',()=>{
 let s=advanceLodMorph(null,8,0);s=advanceLodMorph(s,1,0);assert.equal(s.phase,0);
 s=advanceLodMorph(s,1,55);near(s.phase,.25);near(morphWeight(s.phase),.15625);
 s=advanceLodMorph(s,8,82.5);near(s.phase,.125);
 s=advanceLodMorph(s,8,110);assert.equal(s.from,8);assert.equal(s.to,8);
 s=advanceLodMorph(s,2,110);s=advanceLodMorph(s,4,220);near(s.phase,.5);assert.equal(s.to,2);
 s=advanceLodMorph(s,4,330);assert.equal(s.from,2);assert.equal(s.to,4);assert.equal(s.phase,0);
 s=advanceLodMorph(s,4,330+LOD_MORPH_MS);assert.equal(s.from,4);assert.equal(s.to,4);
 assert.equal(advanceDetailMorph(0,null,true,100000),0);assert.equal(advanceDetailMorph(.5,0,false,110),0);
});

function detailHarness(){
 const v=Object.create(Terrain3DViewer.prototype);
 Object.assign(v,{detailPatches:new Map(),detailPlan:new Map(),detailTiles:[],globalMorphs:new Map(),morphTextures:{},activeDetailIds:new Set(),_trimFocusedPatches(){},_dispatchFocusedDetail(){},_releaseFocusedPatches(){this.detailPatches.clear();}});
 return v;
}
function tile(id,n){return {id,x0:0,y0:0,x1:32,y1:32,subdivisions:n};}
function patch(n,phase=1,visible=true){return {subdivisions:n,phase,visible,morphTime:0,count:focusedTileTriangles(tile(0,n))*3};}

test('local patches enter at base height, wait for global refinement, and fade out before replacement',()=>{
 const v=detailHarness(),p=patch(4,0,false);p.morphTime=null;v.detailTiles=[tile(0,4)];v.detailPlan.set(0,4);v.detailPatches.set(0,p);
 v.globalMorphs.set(0,{from:8,to:1});assert.equal(v._updateFocusedMorphs(0),true);assert.equal(p.visible,false);
 v.globalMorphs.set(0,{from:1,to:1});v._updateFocusedMorphs(10);assert.equal(p.phase,0);assert.equal(p.visible,true);
 v._updateFocusedMorphs(120);near(p.phase,.5);v._updateFocusedMorphs(230);assert.equal(p.phase,1);
 v.detailTiles=[tile(0,8)];v.detailPlan.set(0,8);v._updateFocusedMorphs(340);near(p.phase,.5);assert.equal(p.visible,true);
 v._updateFocusedMorphs(450);assert.equal(p.phase,0);assert.equal(p.visible,false);
});

test('retiring patches never exceed the requested close-up triangle budget and are released after zoom-out',()=>{
 const v=detailHarness();v.detailTiles=[tile(0,8),tile(1,8)];v.detailPlan=new Map([[0,8],[1,8]]);
 v.detailPatches.set(0,patch(8));v.detailPatches.set(1,patch(8));v.detailPatches.set(2,patch(8));
 v._updateFocusedMorphs(110);assert.equal(v.detailPatches.get(2).visible,false);
 assert.ok([...v.detailPatches.values()].filter(p=>p.visible).reduce((a,p)=>a+p.count/3,0)<=DETAIL_TRIANGLE_BUDGET);
 v.detailTiles=[];v.detailPlan.clear();v.detailDraining=true;
 v._updateFocusedMorphs(220);assert.equal(v.detailPatches.get(0).phase,.5);
 v._updateFocusedMorphs(330);assert.equal(v.detailPatches.size,0);assert.equal(v.detailDraining,false);
});

test('vertex shader blends reference geometry before applying relief and keeps the original static path',()=>{
 assert.match(TERRAIN_VERTEX_SHADER,/texelFetch\(uTerrainFields/);
 assert.match(TERRAIN_VERTEX_SHADER,/mix\(sourceField,destField,uMorphWeight\)/);
 assert.match(TERRAIN_VERTEX_SHADER,/blended\.x\*uBaseHeightScale\*uHeightMultiplier/);
 assert.match(TERRAIN_VERTEX_SHADER,/if\(uMorphMode!=0\)/);
});
