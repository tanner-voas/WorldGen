import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateGeometry,generateMesh,generateCoasts,generateStage,boundaryLandCapacity,cellArea,newWorld,upgradeWorld,validateWorld} from '../src/engine.js';
import {geometryConstraintReport,meshConstraintReport,coastConstraintReport} from '../src/generation-constraints.js';

function rectCell(x0,y0,x1,y1){return {x:(x0+x1)/2,y:(y0+y1)/2,poly:[x0,y0,x1,y0,x1,y1,x0,y1],neighbors:[]};}
function grid(widths,heights){
 const cells=[];let y=0;
 for(const h of heights){let x=0;for(const w of widths){cells.push(rectCell(x,y,x+w,y+h));x+=w;}y+=h;}
 return {shape:'rectangle',width:widths.reduce((a,b)=>a+b,0),height:heights.reduce((a,b)=>a+b,0),cells};
}
const off={...DEFAULTS[5],edgeOcean:0,setbackStrength:0};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const message=r=>r.messages.join('\n');

test('weighted threshold selection considers both endpoints and never splits equal heights',()=>{
 const mesh=grid([95,3,2],[100]),elevations=[0,1,2];
 assert.deepEqual(generateCoasts({elevations},{...off,land:.9},mesh).water,[0,0,0]);
 const reversed=grid([2,3,95],[100]);
 assert.deepEqual(generateCoasts({elevations},{...off,land:.05},reversed).water,[1,1,1]);
 for(const target of [.1,.5,.85]){
  const flat=generateCoasts({elevations:[0,0,0]},{...off,land:target},mesh);
  assert.equal(flat.landAreaFraction,target>=.5?1:0);
 }
});

test('coast threshold is globally closest among all attainable weighted partitions',()=>{
 for(const widths of [[1,1,1,1],[60,20,10,10],[1,5,17,8],[99,1,1,2]]){
  const mesh=grid(widths,[200]),total=widths.reduce((a,b)=>a+b,0);
  for(const elevations of [[0,1,2,3],[0,0,1,1],[1,1,1,1],[3,0,3,2]])for(const land of [.05,.1,.25,.38,.5,.65,.85,.9]){
   const thresholds=[Math.min(...elevations)-1,...[...new Set(elevations)].map(x=>x+.1)];
   const best=Math.min(...thresholds.map(t=>Math.abs(widths.reduce((a,w,i)=>a+(elevations[i]>=t?w:0),0)/total-land)));
   const result=generateCoasts({elevations},{...off,land},mesh);
   close(Math.abs(result.landAreaFraction-land),best);
   result.water.forEach((v,i)=>assert.equal(Boolean(v),result.elevations[i]<result.seaLevel));
  }
 }
});

test('rim capacity is geographic area rather than polygon count and never overrides boundary water',()=>{
 const mesh=grid([5,90,5],[10,80,10]);
 const capacity=boundaryLandCapacity(mesh);assert.equal(capacity.protectedCount,8);assert.equal(capacity.availableCount,1);close(capacity.maxLandFraction,.72);
 const heights={elevations:mesh.cells.map((_,i)=>i/10)};const before=JSON.stringify({mesh,heights});
 const result=generateCoasts(heights,{...DEFAULTS[5],land:.85},mesh);
 close(result.landAreaFraction,.72);close(result.coverage.maxLandFraction,.72);assert.equal(result.coverage.target,.85);assert.equal(result.edgeWaterCells,8);
 assert.deepEqual(result.water,[1,1,1,1,0,1,1,1,1]);assert.equal(JSON.stringify({mesh,heights}),before);
 const report=coastConstraintReport(mesh,{...DEFAULTS[5],land:.85},result);
 assert.ok(report.warning);assert.match(message(report),/Maximum.*72%/);assert.match(message(report),/impossible/);
});

test('all-boundary meshes give explicit zero-land reports, while opting out restores capacity',()=>{
 const mesh=grid([100,100,100],[10]);const settings={...DEFAULTS[5],land:.85};const heights={elevations:[-.3,0,.3]};
 const result=generateCoasts(heights,settings,mesh);
 assert.equal(result.landAreaFraction,0);assert.equal(result.coverage.availableCount,0);assert.equal(result.coverage.maxLandFraction,0);
 assert.ok(result.elevations.every(h=>h<result.seaLevel));
 assert.match(message(meshConstraintReport(mesh)),/No land is possible/);
 const report=coastConstraintReport(mesh,settings,result);assert.ok(report.warning);assert.match(message(report),/No land is possible/);assert.match(message(report),/Generated land area: 0%/);
 assert.match(message(report),/capped by world size/);
 const disabled={...settings,edgeOcean:0};const pending=coastConstraintReport(mesh,disabled,result,{pending:true});
 assert.match(message(pending),/Maximum.*100%/);assert.match(message(pending),/Waiting for a preview/);assert.doesNotMatch(message(pending),/Generated land area|No land is possible/);
 const optOut=generateCoasts(heights,disabled,mesh);assert.equal(optOut.edgeWaterCells,0);assert.equal(optOut.coverage.maxLandFraction,1);assert.ok(optOut.landAreaFraction>0);
});

test('historical coverage remains read-only and does not invent a capacity for old saves',()=>{
 const mesh=grid([100,100,100],[10]);const data={water:[1,0,1],seaLevel:0};const before=JSON.stringify(data);
 const report=coastConstraintReport(mesh,DEFAULTS[5],data,{historical:true});
 assert.match(message(report),/Generated land area: 33.33%/);assert.doesNotMatch(message(report),/Maximum|closest achievable/);
 assert.equal(JSON.stringify(data),before);
 assert.equal(geometryConstraintReport({width:100,height:100}),null);
 assert.match(message(geometryConstraintReport({width:20000,height:50})),/400:1/);
});

test('real extreme shape worlds retain the exact protected rim and survive all twelve layers',()=>{
 for(const shape of [{shape:'rectangle',width:20000,height:50},{shape:'ellipse',radiusX:20000,radiusY:50},{shape:'circle',radius:50}])for(const edgeOcean of [.9,0]){
  const w=newWorld('Constraint test');
  for(let stage=1;stage<=12;stage++){
   const settings={...DEFAULTS[stage],...(stage===1?shape:stage===2?{averageArea:w.locked[0].data.areaKm2/100,relaxation:0}:stage===5?{land:.85,edgeOcean}: {})};
   const data=generateStage(stage,w.locked,settings);w.locked.push({stage,settings,data});
  }
  const mesh=w.locked[1].data,coasts=w.locked[4].data,cap=boundaryLandCapacity(mesh);
  close(coasts.coverage.maxLandFraction,edgeOcean?cap.maxLandFraction:1);
  assert.ok(coasts.landAreaFraction<=coasts.coverage.maxLandFraction+1e-9);
  if(edgeOcean)assert.equal(coasts.edgeWaterCells,cap.protectedCount);
  for(let i=0;i<mesh.cells.length;i++)assert.equal(w.locked[6].data.elevations[i]<coasts.seaLevel,!!coasts.water[i]);
  w.working={stage:13,settings:{},data:null,dataSettings:null};w.viewStage=12;
  assert.doesNotThrow(()=>validateWorld(w));const before=JSON.stringify(w.locked);assert.equal(JSON.stringify(upgradeWorld(JSON.parse(JSON.stringify(w))).locked),before);
 }
});

test('new locked results report saved capacity and tolerate missing or malformed optional metadata',()=>{
 const mesh=grid([5,90,5],[10,80,10]);const settings={...DEFAULTS[5],land:.85};
 const data=generateCoasts({elevations:mesh.cells.map((_,i)=>i/10)},settings,mesh);
 const report=coastConstraintReport(mesh,settings,data,{historical:true});
 assert.match(message(report),/Saved boundary limit: 72%/);
 assert.match(message(report),/Generated land area: 72%/);
 const corrupted={...data,coverage:{maxLandFraction:'invalid'}};
 assert.doesNotMatch(message(coastConstraintReport(mesh,settings,corrupted,{historical:true})),/Saved boundary limit/);
});
