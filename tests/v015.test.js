import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, generateGeometry, generateMesh, generatePlates,
  generateElevation, generateCoasts, generateLandforms, generateErosion,
  cellArea, validateWorld, newWorld, snapshotThroughStage, upgradeWorld
} from '../src/engine.js';

const shapes = [
  {shape:'rectangle',width:1100,height:650},
  {shape:'circle',radius:410},
  {shape:'ellipse',radiusX:660,radiusY:220}
];
function inputs(shape,seed=1234){
 const geometry=generateGeometry(shape);
 const mesh=generateMesh({...DEFAULTS[2],distribution:'jittered',averageArea:geometry.areaKm2/320,seed,relaxation:0},null,geometry);
 const plates=generatePlates(mesh,{...DEFAULTS[3],seed:seed+1});
 const heights=generateElevation(mesh,plates,{...DEFAULTS[4],seed:seed+2});
 return {geometry,mesh,plates,heights};
}
function touchesOuterBoundary(cell,shape,geometry){
 for(let i=0;i<cell.poly.length;i+=2){
  const x=cell.poly[i],y=cell.poly[i+1];
  if(shape==='rectangle'){
   if(x<.002||y<.002||Math.abs(x-geometry.width)<.002||Math.abs(y-geometry.height)<.002)return true;
  }else{
   // Elliptical map outlines consist of 128 straight clipped segments.
   const nx=(x-geometry.width/2)/(geometry.width/2),ny=(y-geometry.height/2)/(geometry.height/2);
   if(nx*nx+ny*ny>.998)return true;
  }
 }
 return false;
}

test('all three map outlines are separated from generated continents by water',()=>{
 for(const shape of shapes){
  const {geometry,mesh,heights}=inputs(shape);
  const before=structuredClone(heights.elevations);
  const coasts=generateCoasts(heights,DEFAULTS[5],mesh);
  let boundary=0;
  for(let i=0;i<mesh.cells.length;i++)if(touchesOuterBoundary(mesh.cells[i],shape.shape,geometry)){
   boundary++;
   assert.equal(coasts.water[i],1,`${shape.shape}, boundary cell ${i}`);
   assert.ok(coasts.elevations[i]<coasts.seaLevel,`${shape.shape}, boundary height ${i}`);
  }
  assert.ok(boundary>0,`${shape.shape} has boundary cells`);
  assert.equal(coasts.edgeWaterCells,boundary,`${shape.shape} reports boundary count`);
  assert.deepEqual(heights.elevations,before,`${shape.shape} does not rewrite locked elevations`);
  const areas=mesh.cells.map(cellArea);
  const allowedError=Math.max(...areas)/areas.reduce((a,b)=>a+b,0)+.0001;
  assert.ok(Math.abs(coasts.landAreaFraction-DEFAULTS[5].land)<allowedError,
   `${shape.shape}: land share ${coasts.landAreaFraction}`);
 }
});

test('edge falloff preserves inland heights and can be disabled',()=>{
 const {mesh,heights}=inputs(shapes[0],2468);
 const coasts=generateCoasts(heights,DEFAULTS[5],mesh);
 let unchanged=0,changed=0;
 for(let i=0;i<mesh.cells.length;i++){
  if(Math.abs(coasts.elevations[i]-heights.elevations[i])<1e-9)unchanged++;
  else changed++;
 }
 assert.ok(unchanged>mesh.cells.length/2,`interior untouched: ${unchanged}`);
 assert.ok(changed>0,'edge is adjusted');
 const off=generateCoasts(heights,{...DEFAULTS[5],edgeOcean:0,setbackStrength:0},mesh);
 assert.deepEqual(off.elevations,heights.elevations);
 assert.equal(off.edgeWaterCells,0);
 assert.equal(off.edgeWidthKm,0);
 assert.deepEqual(off.water,generateCoasts(heights,{land:DEFAULTS[5].land},mesh).water);
});

test('new coastal heights propagate through landforms and erosion without changing coastline',()=>{
 const {geometry,mesh,plates,heights}=inputs(shapes[2]);
 const coasts=generateCoasts(heights,DEFAULTS[5],mesh);
 const coastBefore=structuredClone(coasts);
 const land=generateLandforms(mesh,plates,heights,coasts,DEFAULTS[6]);
 const eroded=generateErosion(mesh,coasts,land,{...DEFAULTS[7],iterations:3});
 assert.deepEqual(coasts,coastBefore);
 for(let i=0;i<mesh.cells.length;i++){
  assert.equal(land.elevations[i]<coasts.seaLevel,!!coasts.water[i]);
  assert.equal(eroded.elevations[i]<coasts.seaLevel,!!coasts.water[i]);
 }
 const world=newWorld('New ocean rim');
 for(const [index,data] of [geometry,mesh,plates,heights,coasts,land,eroded].entries())world.locked.push({stage:index+1,settings:structuredClone(DEFAULTS[index+1]),data});
 world.working={stage:8,settings:{},data:null,dataSettings:null};
 assert.doesNotThrow(()=>validateWorld(world));
 const snap=snapshotThroughStage(world,5);
 assert.equal(snap.locked.length,5);
 assert.equal(snap.locked[4].data.edgeWaterCells,coasts.edgeWaterCells);
 assert.doesNotThrow(()=>validateWorld(upgradeWorld(snap)));
});

test('existing locked coastlines without edge fields remain valid and unmodified',()=>{
 const {geometry,mesh,plates,heights}=inputs(shapes[0]);
 const legacy=generateCoasts(heights,{land:.38},mesh);
 delete legacy.elevations;
 delete legacy.edgeWaterCells;
 delete legacy.edgeWidthKm;
 const world=newWorld('Old saved world');
 for(const [index,data] of [geometry,mesh,plates,heights,legacy].entries())world.locked.push({stage:index+1,settings:structuredClone(DEFAULTS[index+1]),data});
 world.working={stage:6,settings:structuredClone(DEFAULTS[6]),data:null,dataSettings:null};
 const preserved=JSON.stringify(world.locked);
 assert.doesNotThrow(()=>upgradeWorld(world));
 assert.equal(JSON.stringify(world.locked),preserved);
});

test('new coast import validation rejects mismatched or corrupted coastal elevation fields',()=>{
 const {geometry,mesh,plates,heights}=inputs(shapes[0]);
 const coast=generateCoasts(heights,DEFAULTS[5],mesh);
 const world=newWorld('Corrupt coasts');
 for(const [index,data] of [geometry,mesh,plates,heights,coast].entries())world.locked.push({stage:index+1,settings:structuredClone(DEFAULTS[index+1]),data});
 world.working={stage:6,settings:structuredClone(DEFAULTS[6]),data:null,dataSettings:null};
 const bad=structuredClone(world);bad.locked[4].data.elevations.pop();
 assert.throws(()=>validateWorld(bad),/Invalid coast data/);
});
