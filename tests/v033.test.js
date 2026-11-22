import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateStage,generateMesh,generateGeometry,refineCoastlines,generateClimate,generateHydrology,generateErosion,generateVegetation,geographicDistances,newWorld,prepareWorld,validateWorld} from '../src/engine.js';
import {REFERENCE_AREA_KM2,distanceLoss} from '../src/geographic-units.js';
import {displayParameter,storedParameter} from '../src/elevation-units.js';
const close=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} (tolerance ${tol})`);
// Two regular sampling graphs of the same physical strip, sharing positions.
// The end cells cover half a step so both grids have exactly the same area.
function strip(step){
 const width=336,height=100,n=width/step+1;
 const cells=Array.from({length:n},(_,i)=>{
  const x=i*step,a=Math.max(0,x-step/2),b=Math.min(width,x+step/2);
  return {x,y:25,poly:[a,0,b,0,b,100,a,100],neighbors:[i-1,i+1].filter(j=>j>=0&&j<n)};
 });
 return {shape:'rectangle',width,height,areaKm2:width*height,cells};
}
const values=(mesh,fn)=>mesh.cells.map((c,i)=>fn(c,i));
const indexAt=(mesh,x)=>mesh.cells.findIndex(c=>c.x===x);

test('distance traversals use actual edge lengths and respect disconnected or blocked cells',()=>{
 const a=strip(42),b=strip(21);
 for(const mesh of [a,b]){
  const {distance,source}=geographicDistances(mesh.cells,[0,mesh.cells.length-1]);
  mesh.cells.forEach((c,i)=>close(distance[i],Math.min(c.x,mesh.width-c.x)));
  assert.equal(source[0],0);assert.equal(source.at(-1),mesh.cells.length-1);
  const blocked=geographicDistances(mesh.cells,[0],i=>mesh.cells[i].x!==168);
  assert.equal(blocked.distance.at(-1),Infinity);assert.equal(blocked.source.at(-1),-1);
  assert.ok(geographicDistances(mesh.cells,[]).distance.every(x=>x===Infinity));
 }
});

test('physical controls retain their stored encoding and distance losses compose correctly',()=>{
 assert.equal(REFERENCE_AREA_KM2,1764);
 assert.equal(displayParameter('edgeFade',1.5),63);
 assert.equal(displayParameter('setbackWidth',10),420);
 assert.equal(displayParameter('riverThreshold',4),7056);
 for(const key of ['edgeFade','setbackWidth','riverThreshold'])close(storedParameter(key,displayParameter(key,3.25)),3.25);
 for(const rate of [.06,.09,.44]){
  close(distanceLoss(rate,42),rate);
  close(1-(1-distanceLoss(rate,21))**2,rate);
  close(distanceLoss(rate,0),0);
 }
});

test('coastal fade and setback distances are independent of polygon density',()=>{
 const g=generateGeometry(DEFAULTS[1]);
 for(const count of [100,1200,5000]){
  const mesh=generateMesh({...DEFAULTS[2],averageArea:g.areaKm2/count,relaxation:0},null,g);
  const heights=values(mesh,c=>.5*Math.sin(c.x/100));const coastal=refineCoastlines({elevations:heights},DEFAULTS[6],mesh);
  close(coastal.edgeWidthKm,63);close(coastal.retreatWidthKm,163.84);
 }
});

test('flat coastal climate has the same humidity and temperatures at shared coordinates',()=>{
 const a=strip(42),b=strip(21);
 const weather=mesh=>generateClimate(mesh,{water:values(mesh,(_,i)=>Number(i===0)),seaLevel:0},{elevations:values(mesh,()=>0)},{...DEFAULTS[9],windDirection:0,rainShadow:0});
 const x=weather(a),y=weather(b);
 for(let i=0;i<a.cells.length;i++)for(const key of ['humidity','seasonalRange','meanTemp','precipitation'])close(x[key][i],y[key][i*2]);
 assert.ok(x.humidity[0]>x.humidity.at(-1));
});

test('moisture transport and precipitation on constant slopes survive edge subdivision',()=>{
 const run=mesh=>generateClimate(mesh,{water:values(mesh,(_,i)=>Number(i===0)),seaLevel:0},{elevations:values(mesh,c=>c.x/500)},{...DEFAULTS[9],windDirection:0,rainShadow:.9});
 const a=run(strip(42)),b=run(strip(21));
 for(let i=0;i<a.humidity.length;i++)for(const key of ['humidity','precipitation','meanTemp'])close(a[key][i],b[key][i*2]);
 assert.ok(a.humidity[0]>a.humidity.at(-1));
});

test('river eligibility depends on one physical catchment area and discharge threshold',()=>{
 for(const mesh of [strip(42),strip(21)]){
  const coasts={water:values(mesh,(_,i)=>Number(i===0)),seaLevel:0},erosion={elevations:values(mesh,c=>c.x/1000)},climate={precipitation:values(mesh,()=>1500),meanTemp:values(mesh,()=>15),moisture:values(mesh,()=>.8)};
  const h=generateHydrology(mesh,coasts,erosion,climate,{...DEFAULTS[10],infiltration:0,evaporation:0});
  assert.ok(h.channels.length>0);
  const threshold=DEFAULTS[10].riverThreshold*REFERENCE_AREA_KM2;
  for(let i=1;i<mesh.cells.length;i++)assert.equal(h.channels.includes(i),h.catchmentArea[i]>=threshold&&h.discharge[i]>=threshold*.00012&&h.flowTo[i]>=0);
  assert.ok(h.channels.includes(indexAt(mesh,84)));assert.ok(!h.channels.includes(indexAt(mesh,294)));
 }
});

test('erosion runoff integrates physical area rather than counting cells',()=>{
 const run=mesh=>generateErosion(mesh,{water:values(mesh,()=>0),seaLevel:-1},{elevations:values(mesh,c=>c.x/1000)},{...DEFAULTS[8],iterations:1,hydraulic:0,thermal:0});
 const coarse=run(strip(42)),fine=run(strip(21));
 assert.ok(Math.abs(coarse.discharge[0]/fine.discharge[0]-1)<.02);
 assert.ok(coarse.erosionDepth.every(x=>x===0));assert.ok(fine.erosionDepth.every(x=>x===0));
});

test('vegetation patch and riparian influence agree at shared coordinates',()=>{
 const run=mesh=>{
  const v=x=>values(mesh,()=>x);
  return generateVegetation(mesh,{water:v(0)},{precipitation:v(1200),meanTemp:v(15)},{lakeId:v(-1),channels:[0]},{fertility:v(.7),groundwater:v(.65)},{biome:v(6),treePotential:v(.6),productivity:v(.7),ecotone:v(0)},DEFAULTS[13]);
 };
 const a=run(strip(42)),b=run(strip(21));
 for(let i=0;i<a.riparian.length;i++)for(const key of ['riparian','canopyCover','groundCover','biomass'])close(a[key][i],b[key][i*2]);
 close(a.riparian[1],.53,.0001);assert.equal(a.riparian[4],0);
});

test('all twelve stages remain valid at three resolutions and world shapes',()=>{
 for(const shape of [{shape:'rectangle',width:2048,height:1024},{shape:'circle',radius:750},{shape:'ellipse',radiusX:1100,radiusY:600}]){
  for(const count of [100,1200,5000]){
   const w=newWorld('Resolution test');
   for(let stage=1;stage<=13;stage++){
    const settings={...DEFAULTS[stage],...(stage===1?shape:stage===2?{averageArea:w.locked[0].data.areaKm2/count,relaxation:0}: {})};
    const before=JSON.stringify(w.locked),data=generateStage(stage,w.locked,settings);
    assert.equal(JSON.stringify(w.locked),before);
    w.locked.push({stage,settings,data});
   }
   w.working={stage:14,settings:{},data:null,dataSettings:null};w.viewStage=12;
   assert.doesNotThrow(()=>validateWorld(w));
   const before=JSON.stringify(w.locked),loaded=prepareWorld(JSON.parse(JSON.stringify(w)));
   assert.equal(JSON.stringify(loaded.locked),before);
  }
 }
});
