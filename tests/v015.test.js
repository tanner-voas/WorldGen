import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DEFAULTS,generateGeometry,generateMesh,generatePlates,generateElevation,
 generateOceans,refineCoastlines,generateLandforms,generateErosion,
 validateWorld,newWorld,snapshotThroughStage,prepareWorld
} from '../src/engine.js';

const shapes=[
 {shape:'rectangle',width:1100,height:650},
 {shape:'circle',radius:410},
 {shape:'ellipse',radiusX:660,radiusY:220}
];
function inputs(shape,seed=1234){
 const geometry=generateGeometry(shape);
 const mesh=generateMesh({...DEFAULTS[2],distribution:'jittered',averageArea:geometry.areaKm2/320,seed,relaxation:0},null,geometry);
 const territories=generatePlates(mesh,{...DEFAULTS[3],seed:seed+1});
 const heights=generateElevation(mesh,territories,{...DEFAULTS[4],seed:seed+2});
 const plates={...territories,plates:territories.plates.map((p,i)=>({...p,...heights.plateProperties[i]}))};
 const oceans=generateOceans(heights,DEFAULTS[5],mesh);
 return {geometry,mesh,plates,territories,heights,oceans};
}
function touchesOuterBoundary(cell,shape,geometry){
 for(let i=0;i<cell.poly.length;i+=2){
  const x=cell.poly[i],y=cell.poly[i+1];
  if(shape==='rectangle'){
   if(x<.002||y<.002||Math.abs(x-geometry.width)<.002||Math.abs(y-geometry.height)<.002)return true;
  }else if(((x-geometry.width/2)/(geometry.width/2))**2+((y-geometry.height/2)/(geometry.height/2))**2>.998)return true;
 }
 return false;
}

test('coastline shaping can enforce a water rim independently of oceans on every world shape',()=>{
 for(const shape of shapes){
  const {geometry,mesh,heights,oceans}=inputs(shape);
  const before=structuredClone(heights.elevations),oceanBefore=structuredClone(oceans);
  const coast=refineCoastlines(oceans,{...DEFAULTS[6],edgeOcean:1.2},mesh);
  let boundary=0;
  for(let i=0;i<mesh.cells.length;i++)if(touchesOuterBoundary(mesh.cells[i],shape.shape,geometry)){
   boundary++;
   assert.equal(coast.water[i],1,`${shape.shape} boundary cell ${i}`);
   assert.ok(coast.elevations[i]<0,`${shape.shape} boundary elevation ${i}`);
  }
  assert.ok(boundary>0);
  assert.equal(coast.edgeWaterCells,boundary);
  assert.deepEqual(heights.elevations,before);
  assert.deepEqual(oceans,oceanBefore);
 }
});

test('coastal adjustments preserve the interior and can be fully disabled',()=>{
 const {mesh,oceans}=inputs(shapes[0],2468);
 const coast=refineCoastlines(oceans,DEFAULTS[6],mesh);
 let unchanged=0,changed=0;
 for(let i=0;i<mesh.cells.length;i++){
  if(coast.elevations[i]===oceans.elevations[i])unchanged++;
  else changed++;
 }
 assert.ok(unchanged>mesh.cells.length/2);
 assert.ok(changed>0);
 const off=refineCoastlines(oceans,{...DEFAULTS[6],edgeOcean:0,setbackStrength:0},mesh);
 assert.deepEqual(off.elevations,oceans.elevations);
 assert.deepEqual(off.water,oceans.water);
 assert.ok(off.edgeWaterCells>=0);
});

test('coastline and landform stages never rewrite earlier ocean and relief layers',()=>{
 const {geometry,mesh,plates,territories,heights,oceans}=inputs(shapes[2]);
 const coast=refineCoastlines(oceans,DEFAULTS[6],mesh);
 const old=structuredClone({heights,oceans,coast});
 const land=generateLandforms(mesh,plates,heights,coast,DEFAULTS[7]);
 const eroded=generateErosion(mesh,coast,land,{...DEFAULTS[8],iterations:3});
 assert.deepEqual({heights,oceans,coast},old);
 for(let i=0;i<mesh.cells.length;i++){
  assert.equal(land.elevations[i]<=0,!!coast.water[i]);
  assert.equal(eroded.elevations[i]<=0,!!coast.water[i]);
 }
 const world=newWorld('Fresh world');
 for(const [index,data] of [geometry,mesh,territories,heights,oceans,coast,land,eroded].entries())world.locked.push({stage:index+1,settings:structuredClone(DEFAULTS[index+1]),data});
 world.working={stage:9,settings:{},data:null,dataSettings:null};
 assert.doesNotThrow(()=>validateWorld(world));
 assert.doesNotThrow(()=>prepareWorld(snapshotThroughStage(world,6)));
});

test('strict coast-save validation rejects missing or corrupted heightfields',()=>{
 const {geometry,mesh,territories,heights,oceans}=inputs(shapes[0]);
 const coast=refineCoastlines(oceans,DEFAULTS[6],mesh),world=newWorld('Coast validation');
 for(const [index,data] of [geometry,mesh,territories,heights,oceans,coast].entries())world.locked.push({stage:index+1,settings:structuredClone(DEFAULTS[index+1]),data});
 world.working={stage:7,settings:structuredClone(DEFAULTS[7]),data:null,dataSettings:null};
 for(const invalidField of [d=>d.elevations.pop(),d=>delete d.elevations,d=>d.seaLevel=.2]){
  const bad=structuredClone(world);invalidField(bad.locked[5].data);
  assert.throws(()=>validateWorld(bad),/Invalid coast data/);
 }
});
