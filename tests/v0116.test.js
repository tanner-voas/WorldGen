import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTerrainSampler,visitTerrainSites} from '../src/render.js';

const makeMesh=(cols,rows,step=25)=>({
 width:cols*step,height:rows*step,areaKm2:cols*rows*step*step,
 cells:Array.from({length:cols*rows},(_,i)=>({x:((i%cols)+.5)*step,y:(Math.floor(i/cols)+.5)*step}))
});
const interpolated=(sampler,x,y)=>{
 let total=0,field=0;
 const count=visitTerrainSites(sampler,x,y,(i,w)=>{total+=w;field+=(i%2?1:0)*w;});
 return {count,field:field/total,weight:total};
};

test('spatial sampling is deterministic and continuous when crossing former Voronoi boundaries',()=>{
 const mesh=makeMesh(10,10),s=createTerrainSampler(mesh,.8);
 for(const [x,y] of [[125,120],[50,50],[25,75],[225,190],[99.9,99.9]]){
  const a=interpolated(s,x,y),b=interpolated(s,x+.00001,y+.00001);
  assert.ok(a.count>0&&a.count<mesh.cells.length);
  assert.ok(a.weight>0&&Number.isFinite(a.field));
  assert.ok(Math.abs(a.field-b.field)<.00001,`${x},${y} had an interpolation seam`);
  assert.deepEqual(a,interpolated(s,x,y),'identical world positions must produce identical weights');
 }
});

test('smoothing control influences local radius while keeping candidate counts bounded',()=>{
 const mesh=makeMesh(25,25);
 const narrow=createTerrainSampler(mesh,0),wide=createTerrainSampler(mesh,1);
 assert.ok(wide.radius>narrow.radius);
 const one=interpolated(narrow,290,291),two=interpolated(wide,290,291);
 assert.ok(two.count>one.count);
 assert.ok(two.count<mesh.cells.length/3);
});

test('spatial sampler works on very long, thin maps and sparse site layouts',()=>{
 const thin=makeMesh(50,1,20),s=createTerrainSampler(thin,.7);
 for(const x of [1,20,200,500,999])assert.ok(interpolated(s,x,10).count>0);
 const sparse={width:1000,height:1000,areaKm2:1e6,cells:[{x:100,y:100},{x:900,y:100},{x:500,y:900}]};
 const odd=createTerrainSampler(sparse,.8);
 let total=0;visitTerrainSites(odd,500,500,(_,w)=>{total+=w;});
 assert.ok(Number.isFinite(total)&&total>=0);
});

test('render uses continuous sampler and directly mounts its output bitmap',()=>{
 const code=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(code,/visitTerrainSites\(state\.sampler,wx,wy,collect\)/);
 assert.doesNotMatch(code,/buildRenderNeighborhoods\(mesh/);
 assert.match(code,/replaceWith\(canvasOut\)/);
 assert.match(code,/inspectRenderedCoordinate\(viewer/);
});
