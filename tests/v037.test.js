import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateStage} from '../src/engine.js';
import {buildElevationSurface,buildFocusedTerrainPatch} from '../src/terrain-3d-model.js';
import {createRiverProjector,riverEdgeCrossing} from '../src/terrain-rivers.js';

function planeHeight(s,x,z){
 const gx=Math.max(0,Math.min(s.cols,(x/s.planeWidth+.5)*s.cols)),gy=Math.max(0,Math.min(s.rows,(z/s.planeDepth+.5)*s.rows));
 const i=Math.min(s.cols-1,Math.floor(gx)),j=Math.min(s.rows-1,Math.floor(gy)),fx=gx-i,fy=gy-j;
 const h=(a,b)=>s.vertexData[(b*(s.cols+1)+a)*7+1];
 const a=h(i,j),b=h(i+1,j),c=h(i,j+1),d=h(i+1,j+1);
 return fx+fy<=1?a+(b-a)*fx+(c-a)*fy:d+(c-d)*(1-fx)+(b-d)*(1-fy);
}
function fixture(){
 const geometry={shape:'rectangle',width:60,height:30};
 const cells=Array.from({length:6},(_,i)=>({x:i*10+5,y:15,poly:[i*10,0,i*10+10,0,i*10+10,30,i*10,30],neighbors:[i-1,i+1].filter(j=>j>=0&&j<6)}));
 const mesh={width:60,height:30,areaKm2:1800,cells},elevations=[-.5,.9,.35,.48,1.7,1.2];
 const hydrology={lakeId:[-1,-1,0,0,-1,-1],lakeDepth:[0,0,.25,.12,0,0],lakes:[{id:0,level:.6,cells:[2,3]}],flowTo:[-1,0,1,2,3,4],discharge:[0,5,4,3,2,1],channels:[1,2,3,4,5],summary:{maxDischarge:5}};
 return {geometry,mesh,elevations,hydrology,options:{hydrology,waterMask:[1,0,0,0,0,0],seaLevel:0}};
}

test('river projector splits ribbons at actual terrain creases and sea level',()=>{
 const vertexData=new Float32Array(4*7);[1,-1,2,4].forEach((h,i)=>vertexData[i*7+1]=h);
 const grid={cols:1,rows:1,planeWidth:1,planeDepth:1,vertexData,insideMask:new Uint8Array(4).fill(1)};
 const p=createRiverProjector(grid,0);p.emit([[0,0],[1,0],[1,1]]);p.emit([[0,0],[1,1],[0,1]]);
 const {rivers,riverMask}=p.finish();assert.ok(rivers.length>18);assert.deepEqual(Array.from(riverMask),[1,1,1,1]);
 let shore=0;
 for(let i=0;i<rivers.length;i+=9){
  const x=(rivers[i]+rivers[i+3]+rivers[i+6])/3,y=(rivers[i+1]+rivers[i+4]+rivers[i+7])/3,z=(rivers[i+2]+rivers[i+5]+rivers[i+8])/3;
  assert.ok(Math.abs(y-planeHeight(grid,x,z))<1e-6);
  for(let j=i+1;j<i+9;j+=3){assert.ok(rivers[j]>=-1e-7);if(Math.abs(rivers[j])<1e-7)shore++;}
 }
 assert.ok(shore>0);
});

test('non-Gabriel drainage edges cross the actual shared polygon edge instead of the site midpoint',()=>{
 // Sites at (0,0) and (4,0); their shared edge starts at y=3, not y=0.
 const a={x:0,y:0,poly:[-4,-4,0,-4,2,3,2,7,-4,7]},b={x:4,y:0};
 const [x,y]=riverEdgeCrossing(a,b);assert.equal(x,2);assert.ok(y>3&&y<7);
});

test('river ribbons reach the rendered ocean and both sides of a saved lake, but not across its interior',()=>{
 const {geometry,mesh,elevations,hydrology,options}=fixture(),snapshot=JSON.stringify([mesh,elevations,hydrology]);
 const s=buildElevationSurface(geometry,mesh,elevations,()=>{},options),r=s.hydrology.rivers;
 const at=[];let shore=0;
 for(let i=0;i<r.length;i+=3){
  const x=(r[i]/s.planeWidth+.5)*geometry.width;
  at.push(x);assert.ok(r[i+1]>=-1e-7);
  if(Math.abs(r[i+1])<1e-7){shore++;assert.ok(Math.abs(x-10)<1);}
 }
 assert.ok(shore>0,'ocean outlet must reach the sea intersection');
 assert.ok(at.some(x=>x>20&&x<23),'lake outlet overlaps the lake shoreline');
 assert.ok(at.some(x=>x<40&&x>37),'lake inlet overlaps the lake shoreline');
 assert.ok(!at.some(x=>x>24&&x<36),'lake interior must not carry a river ribbon');
 assert.equal(JSON.stringify([mesh,elevations,hydrology]),snapshot);
});

test('all generated river triangles conform to base terrain and survive every global LOD',()=>{
 for(const shape of [{shape:'rectangle',width:2048,height:1024},{shape:'circle',radius:800},{shape:'ellipse',radiusX:1000,radiusY:500}]){
  const locked=[];for(let stage=1;stage<=9;stage++){
   const settings={...DEFAULTS[stage],...(stage===1?shape:{}),...(stage===2?{averageArea:locked[0].data.areaKm2/1200}:{})};
   locked.push({stage,data:generateStage(stage,locked,settings)});
  }
  const [geometry,mesh,,,coast,,erosion,,hydrology]=locked.map(r=>r.data);
  const s=buildElevationSurface(geometry,mesh,erosion.elevations,()=>{},{waterMask:coast.water,seaLevel:coast.seaLevel,hydrology});
  const r=s.hydrology.rivers,m=s.hydrology.riverMask;assert.ok(r.length>0&&m);
  let error=0;for(let i=0;i<r.length;i+=9){
   for(const [x,y,z] of [[r[i],r[i+1],r[i+2]],[r[i+3],r[i+4],r[i+5]],[r[i+6],r[i+7],r[i+8]],[(r[i]+r[i+3]+r[i+6])/3,(r[i+1]+r[i+4]+r[i+7])/3,(r[i+2]+r[i+5]+r[i+8])/3]]){
    error=Math.max(error,Math.abs(y-planeHeight(s,x,z)));
   }
  }
  assert.ok(error<2e-6,`${shape.shape} maximum river deviation ${error}`);
  const stride=s.cols+1,required=[];
  for(let y=0;y<s.rows;y++)for(let x=0;x<s.cols;x++){
   const a=y*stride+x,b=a+1,c=a+stride,d=c+1;
   if(![a,b,c,d].every(i=>m[i]))continue;
   if([a,c,b].every(i=>s.insideMask[i]))required.push(`${a},${c},${b}`);
   if([b,c,d].every(i=>s.insideMask[i]))required.push(`${b},${c},${d}`);
  }
  for(const level of [...s.levels,...s.uniformLevels]){
   const tris=new Set();for(let i=0;i<level.indices.length;i+=3)tris.add(`${level.indices[i]},${level.indices[i+1]},${level.indices[i+2]}`);
   for(const key of required)assert.ok(tris.has(key),`step ${level.step}: lost protected triangle ${key}`);
  }
 }
});

test('close-up worker receives the river mask and preserves the exact terrain beneath channels',async()=>{
 const {geometry,mesh,elevations,options}=fixture();
 const s=buildElevationSurface(geometry,mesh,elevations,()=>{},options),riverMask=s.hydrology.riverMask;
 const tile=s.levels[0].tiles.find(t=>t.x0>=32&&t.x1<=128&&t.y0<=40&&t.y1>=40);
 const grid={cols:s.cols,rows:s.rows,planeWidth:s.planeWidth,planeDepth:s.planeDepth,heightScale:s.heightScale,riverMask};
 const messages=[],original=globalThis.self;
 try{
  globalThis.self={postMessage:m=>messages.push(m)};
  await import('../src/terrain-3d-worker.js?v037');
  self.onmessage({data:{kind:'init-detail',geometry,mesh,elevations,grid,...options}});
  assert.equal(messages.at(-1).kind,'detail-ready');
  self.onmessage({data:{kind:'detail',key:'river',tiles:[tile]}});
  assert.equal(messages.at(-1).kind,'detail');
  const patch=messages.at(-1).patches[0],direct=buildFocusedTerrainPatch(geometry,mesh,elevations,grid,tile,options);
  assert.deepEqual(patch.vertexData,direct.vertexData);
  const nx=(tile.x1-tile.x0)*patch.subdivisions,ny=(tile.y1-tile.y0)*patch.subdivisions;
  let protectedCount=0,freeCount=0;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
   const gx=tile.x0+i/patch.subdivisions,gy=tile.y0+j/patch.subdivisions,a=Math.floor(gy)*(s.cols+1)+Math.floor(gx);
   const k=(j*(nx+1)+i)*7,v=patch.vertexData,error=Math.abs(v[k+1]-planeHeight(s,v[k],v[k+2]));
   const marked=[a,a+1,a+s.cols+1,a+s.cols+2].map(i=>riverMask[i]);
   if(marked.every(Boolean)){assert.ok(error<1e-6);protectedCount++;}
   else if(marked.every(x=>!x)&&error>1e-6)freeCount++;
  }
  assert.ok(protectedCount>0&&freeCount>0,'refinement should remain active away from channels');
 }finally{if(original===undefined)delete globalThis.self;else globalThis.self=original;}
});
