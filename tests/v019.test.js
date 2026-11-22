import test from 'node:test';
import assert from 'node:assert/strict';
import {generateGeometry,generateMesh,generateStage,DEFAULTS,newWorld,prepareWorld,validateWorld,snapshotThroughStage,cellArea} from '../src/engine.js';
import {buildCellIndex,cellsInBounds,cellAtPoint,polygonContainsPoint} from '../src/spatial.js';

const shapes=[
 {shape:'rectangle',width:1500,height:800},
 {shape:'circle',radius:620},
 {shape:'ellipse',radiusX:1100,radiusY:280}
];
const meshFor=(shape,count=450)=>{
 const geom=generateGeometry(shape);
 return generateMesh({...DEFAULTS[2],averageArea:geom.areaKm2/count,relaxation:1,distribution:'clustered',seed:2126},null,geom);
};
function linearCells(mesh,x0,y0,x1,y1){
 return mesh.cells.flatMap((c,i)=>{
  let a=Infinity,b=Infinity,d=-Infinity,e=-Infinity;
  for(let j=0;j<c.poly.length;j+=2){a=Math.min(a,c.poly[j]);b=Math.min(b,c.poly[j+1]);d=Math.max(d,c.poly[j]);e=Math.max(e,c.poly[j+1]);}
  return d>=x0&&a<=x1&&e>=y0&&b<=y1?[i]:[];
 });
}
test('spatial index finds exactly the same visible cells as a full scan for all world shapes',()=>{
 for(const shape of shapes){
  const mesh=meshFor(shape),index=buildCellIndex(mesh);
  let seed=137;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const cases=[[0,0,mesh.width,mesh.height],[-100,-100,150,150],[-200,-200,-10,-10]];
  for(let i=0;i<121;i++){
   const x=(random()*.95-.1)*mesh.width,y=(random()*.95-.1)*mesh.height;
   const w=(random()*.2+.005)*mesh.width,h=(random()*.2+.005)*mesh.height;
   cases.push([x,y,x+w,y+h]);
  }
  for(const [x0,y0,x1,y1] of cases){
   assert.deepEqual(cellsInBounds(index,x0,y0,x1,y1).sort((a,b)=>a-b),linearCells(mesh,x0,y0,x1,y1));
  }
 }
});
test('indexed cell picking honors saved polygon boundaries and matches site centers',()=>{
 for(const shape of shapes){
  const mesh=meshFor(shape,800),index=buildCellIndex(mesh);
  for(let i=0;i<mesh.cells.length;i++){
   const {x,y,poly}=mesh.cells[i];
   assert.equal(cellAtPoint(index,x,y),i,`site ${i} / ${shape.shape}`);
   assert.equal(polygonContainsPoint(poly,x,y),true);
  }
 }
});
test('spatial index handles extreme thin maps and edge coordinates without missing cells',()=>{
 const mesh=meshFor({shape:'ellipse',radiusX:2500,radiusY:90},230),index=buildCellIndex(mesh);
 for(const c of mesh.cells){
  assert.equal(cellAtPoint(index,c.x,c.y)!==null,true);
 }
 assert.deepEqual(cellsInBounds(index,-50,-50,-5,-5),[]);
 assert.deepEqual(cellsInBounds(index,mesh.width+1,0,mesh.width+20,mesh.height),[]);
});
test('Voronoi neighbor graph remains symmetric and reflects actual bisectors near clipped outlines',()=>{
 for(const shape of shapes){
  const mesh=meshFor(shape,750);
  const total=mesh.cells.reduce((sum,c)=>sum+cellArea(c),0);
  assert.ok(Math.abs(total/mesh.areaKm2-1)<.001);
  for(let i=0;i<mesh.cells.length;i++){
   const a=mesh.cells[i];
   for(const j of a.neighbors){
    assert.ok(mesh.cells[j].neighbors.includes(i),`${shape.shape}: ${i} -> ${j} is one sided`);
    const b=mesh.cells[j];let isBisector=false;
    for(let k=0;k<a.poly.length;k+=2){
     const x=(a.poly[k]+a.poly[(k+2)%a.poly.length])/2,y=(a.poly[k+1]+a.poly[(k+3)%a.poly.length])/2;
     const own=(x-a.x)**2+(y-a.y)**2,other=(x-b.x)**2+(y-b.y)**2;
     if(Math.abs(own-other)<=Math.max(1,own)*.0002){isBisector=true;break;}
    }
    assert.equal(isBisector,true,`${shape.shape} cell ${i} has non-geometric neighbor ${j}`);
   }
  }
 }
});
test('existing stage data, complete snapshots, and numeric units remain unchanged',()=>{
 const world=newWorld('Unmodified data');
 for(let stage=1;stage<=7;stage++){
  const settings={...DEFAULTS[stage],...(stage===2?{averageArea:15000,relaxation:0}:{})};
  const data=generateStage(stage,world.locked,settings);
  world.locked.push({stage,settings,data});
 }
 world.working={stage:8,settings:{...DEFAULTS[7]},data:null,dataSettings:null};
 const saved=JSON.stringify(world.locked);
 const copy=prepareWorld(structuredClone(world));
 assert.equal(JSON.stringify(copy.locked),saved);
 const snapshot=snapshotThroughStage(copy,4);
 assert.equal(snapshot.locked.length,4);
 assert.equal(snapshot.locked[0].data.unit,'km');
 assert.doesNotThrow(()=>validateWorld(snapshot));
});
