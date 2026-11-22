import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateStage} from '../src/engine.js';
import {createFocusedOutline,appendFocusedOutlineIndices} from '../src/terrain-3d-outline.js';
import {buildElevationSurface,buildFocusedTerrainPatch} from '../src/terrain-3d-model.js';
import {focusedTerrainTiles,planFocusedTerrainTiles,focusedTileTriangles,DETAIL_TRIANGLE_BUDGET} from '../src/terrain-3d-detail.js';
import {perspectiveMatrix,lookAtMatrix,multiplyMatrices,Terrain3DViewer} from '../src/terrain-3d.js';

const shapes=[{shape:'circle',radius:800},{shape:'ellipse',radiusX:1000,radiusY:500}];
function world(shape,sites=1200){
 const locked=[];
 for(let stage=1;stage<=11;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?shape:{}),...(stage===2?{averageArea:locked[0].data.areaKm2/sites}:{})};
  locked.push({stage,data:generateStage(stage,locked,settings)});
 }
 const [geometry,mesh,,,ocean,coast,,erosion,climate,hydrology]=locked.map(r=>r.data);
 const options={waterMask:coast.water,seaLevel:coast.seaLevel,hydrology,appearance:{stage:10,water:coast.water,climate}};
 const surface=buildElevationSurface(geometry,mesh,erosion.elevations,()=>{},options);
 surface.riverMask=surface.hydrology.riverMask;
 return {geometry,mesh,elevations:erosion.elevations,options,surface};
}
const near=(a,b,epsilon=2e-6)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} != ${b}`);
const partial=t=>t.count>0&&t.count<6*(t.x1-t.x0)*(t.y1-t.y0);

function boundaryEdges(s,tile){
 const edges=new Map(),indices=s.levels[0].indices;
 for(let i=tile.offset;i<tile.offset+tile.count;i+=3){
  const a=indices[i],b=indices[i+1],c=indices[i+2];
  for(const [u,v] of [[a,b],[b,c],[c,a]]){
   const key=`${Math.min(u,v)}:${Math.max(u,v)}`;
   if(edges.has(key))edges.delete(key);else edges.set(key,[u,v]);
  }
 }
 return [...edges.values()];
}
function gridPosition(s,index){return [index%(s.cols+1),Math.floor(index/(s.cols+1))];}
function planeHeight(s,gx,gy){
 const x=Math.min(s.cols-1,Math.floor(gx)),y=Math.min(s.rows-1,Math.floor(gy)),u=gx-x,v=gy-y;
 const h=(xx,yy)=>s.vertexData[(yy*(s.cols+1)+xx)*7+1];
 const a=h(x,y),b=h(x+1,y),c=h(x,y+1),d=h(x+1,y+1);
 return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
}

test('every possible coarse square mask is subdivided without adding or removing footprint',()=>{
 const geometry={shape:'rectangle',width:1,height:1},area={x0:0,y0:0,x1:1,y1:1};
 for(let mask=0;mask<16;mask++){
  const insideMask=Uint8Array.from([0,1,2,3],i=>(mask>>i)&1);
  const outline=createFocusedOutline(geometry,{cols:1,rows:1,insideMask},area);
  const lower=(mask&7)===7,upper=(mask&14)===14;
  for(const n of [2,3,4,6,8]){
   const indices=[];appendFocusedOutlineIndices(indices,outline,area,n);
   assert.equal(indices.length/3,(Number(lower)+Number(upper))*n*n);
   for(let i=0;i<indices.length;i+=3){
    const tri=indices.slice(i,i+3).map(k=>[k%(n+1),Math.floor(k/(n+1))]);
    assert.ok(tri.every(([x,y])=>x+y<=n)&&lower||tri.every(([x,y])=>x+y>=n)&&upper);
    const [[ax,ay],[bx,by],[cx,cy]]=tri;
    assert.equal((bx-ax)*(cy-ay)-(by-ay)*(cx-ax),-1);
   }
  }
 }
});

test('clipped tiles are selectable close to the world edge, empty tiles remain excluded and budgets stay bounded',()=>{
 for(const shape of shapes){
  const {surface:s}=world(shape,400);
  const t=s.levels[0].tiles.find(t=>partial(t)&&t.count>600);
  assert.ok(t);
  const k=s.levels[0].indices[t.offset+Math.floor(t.count/2/3)*3];
  const target=[s.vertexData[k*7],s.vertexData[k*7+1],s.vertexData[k*7+2]];
  // The old four-neighbor helper and the actual screen-space planner both
  // need to admit clipped tiles. Aim slightly inside this tile instead of
  // exactly at a shared tile boundary.
  const x0=(t.x0/s.cols-.5)*s.planeWidth,x1=(t.x1/s.cols-.5)*s.planeWidth,z0=(t.y0/s.rows-.5)*s.planeDepth,z1=(t.y1/s.rows-.5)*s.planeDepth;
  target[0]=Math.max(x0+1e-5,Math.min(x1-1e-5,target[0]));target[2]=Math.max(z0+1e-5,Math.min(z1-1e-5,target[2]));
  assert.ok(focusedTerrainTiles(s,target).some(p=>p.id===t.id));
  for(const [width,height] of [[680,1180],[1180,680]]){
   const eye=[target[0],target[1]+.025,target[2]+.004];
   const camera=multiplyMatrices(perspectiveMatrix(.77,width/height,.00035,100),lookAtMatrix(eye,target));
   const plan=planFocusedTerrainTiles(s,{camera,width,height});
   assert.ok(plan.some(p=>p.id===t.id));
   assert.ok(plan.every(p=>s.levels[0].tiles[p.id].count>0));
   assert.ok(plan.reduce((n,p)=>n+focusedTileTriangles(p),0)<=DETAIL_TRIANGLE_BUDGET);
  }
 }
});

test('generated circle and ellipse retain exact boundary height and material while adding interior geometry',()=>{
 for(const shape of shapes){
  const {geometry,mesh,elevations,options,surface:s}=world(shape);
  const before=JSON.stringify([elevations,options.hydrology]);
  const tile=s.levels[0].tiles.filter(t=>partial(t)&&boundaryEdges(s,t).some(([a,b])=>{
   const [ax,ay]=gridPosition(s,a),[bx,by]=gridPosition(s,b);return ax!==bx&&ay!==by;
  })).sort((a,b)=>Math.abs(a.count-3000)-Math.abs(b.count-3000))[0];
  assert.ok(tile&&tile.count>0);
  for(const n of [2,8]){
   const p=buildFocusedTerrainPatch(geometry,mesh,elevations,s,tile,{...options,subdivisions:n});
   assert.equal(p.indices.length,tile.count*n*n);
   assert.ok(p.vertexData.every(Number.isFinite)&&p.materialColors.every(Number.isFinite));
   const nx=(tile.x1-tile.x0)*n,stride=nx+1;
   const fineIndex=(x,y)=>Math.round((y-tile.y0)*n)*stride+Math.round((x-tile.x0)*n);
   let diagonal=0;
   for(const [a,b] of boundaryEdges(s,tile)){
    const [ax,ay]=gridPosition(s,a),[bx,by]=gridPosition(s,b);
    if(ax!==bx&&ay!==by)diagonal++;
    for(let k=0;k<=n;k++){
     const t=k/n,i=fineIndex(ax+(bx-ax)*t,ay+(by-ay)*t);
     for(const dim of [0,1,2,6])near(p.vertexData[i*7+dim],s.vertexData[a*7+dim]*(1-t)+s.vertexData[b*7+dim]*t);
     for(let dim=0;dim<3;dim++)near(p.materialColors[i*3+dim],s.materialColors[a*3+dim]*(1-t)+s.materialColors[b*3+dim]*t);
    }
   }
   assert.ok(diagonal>0,'test must include a clipped diagonal edge');
   let refined=0;
   for(let k=0;k<p.indices.length;k+=3){
    const i=p.indices[k],gx=tile.x0+(i%stride)/n,gy=tile.y0+Math.floor(i/stride)/n;
    const x=Math.min(s.cols-1,Math.floor(gx)),y=Math.min(s.rows-1,Math.floor(gy)),a=y*(s.cols+1)+x;
    const error=Math.abs(p.vertexData[i*7+1]-planeHeight(s,gx,gy));
    if(s.riverMask&&[a,a+1,a+s.cols+1,a+s.cols+2].every(i=>s.riverMask[i])){near(error,0);}
    else if(error>1e-6)refined++;
   }
   assert.ok(refined>0,'valid interior geometry must still refine');
  }
  assert.equal(JSON.stringify([elevations,options.hydrology]),before);
 }
});

test('worker uses the viewer base mask, including clipped mixed-resolution tiles',async()=>{
 const {geometry,mesh,elevations,options,surface:s}=world(shapes[1],400);
 const tiles=s.levels[0].tiles;
 const a=tiles.find(t=>partial(t)&&tiles.some(u=>u.count&&u.x0===t.x1&&u.y0===t.y0));
 const b=tiles.find(t=>t.count&&t.x0===a.x1&&t.y0===a.y0);
 const requests=[{...a,subdivisions:2},{...b,subdivisions:8}];
 const messages=[],originalSelf=globalThis.self,originalWorker=globalThis.Worker;
 let init;
 try{
  globalThis.Worker=class{postMessage(data){init=data;}terminate(){}};
  const viewer=Object.create(Terrain3DViewer.prototype);
  Object.assign(viewer,{surface:s,detailSource:{geometry,mesh,elevations,...options},disposed:false,lost:false});
  viewer._startDetailWorker();
  assert.deepEqual(init.grid.insideMask,s.insideMask);
  globalThis.self={postMessage:(data,transfer)=>messages.push({data,transfer})};
  await import('../src/terrain-3d-worker.js?v039');
  self.onmessage({data:init});assert.equal(messages.at(-1).data.kind,'detail-ready');
  self.onmessage({data:{kind:'detail',key:'edge',tiles:requests}});
  const answer=messages.at(-1);assert.equal(answer.data.kind,'detail');
  const [p,q]=answer.data.patches;
  for(const [patch,tile] of [[p,requests[0]],[q,requests[1]]]){
   assert.equal(patch.indices.length,tile.count*tile.subdivisions**2);
   assert.ok(answer.transfer.includes(patch.indices.buffer));
  }
  const pw=(a.x1-a.x0)*2+1,qw=(b.x1-b.x0)*8+1;
  // All vertices on the shared tile edge agree with the coarse edge polyline,
  // including where the edge crosses the world outline.
  for(let j=0;j<=(a.y1-a.y0)*8;j++){
   const base=Math.min((a.y1-a.y0)*2-1,Math.floor(j/4)),f=j/4-base;
   const u=base*pw+pw-1,v=u+pw,w=j*qw;
   for(const k of [0,1,2,6])near(q.vertexData[w*7+k],p.vertexData[u*7+k]*(1-f)+p.vertexData[v*7+k]*f);
   for(let k=0;k<3;k++)near(q.materialColors[w*3+k],p.materialColors[u*3+k]*(1-f)+p.materialColors[v*3+k]*f);
  }
 }finally{
  if(originalSelf===undefined)delete globalThis.self;else globalThis.self=originalSelf;
  if(originalWorker===undefined)delete globalThis.Worker;else globalThis.Worker=originalWorker;
 }
});
