import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SCHEMA_VERSION,IMPLEMENTED,DEFAULTS,STAGES,newWorld,generateStage,generateOceans,validateWorld,prepareWorld,snapshotThroughStage,cellArea} from '../src/engine.js';
import {selectTerrainSource} from '../src/terrain-3d-model.js';

function makeHistory(last=13,count=180){
 const world=newWorld('Signed altitude and oceans');
 for(let stage=1;stage<=last;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?{shape:'ellipse',radiusX:770,radiusY:540}:{}),
   ...(stage===2?{averageArea:Math.PI*770*540/count,relaxation:0}:{}),
   ...(stage===3?{plates:14}:{}),...(stage===8?{iterations:2}:{})};
  const frozen=JSON.stringify(world.locked);
  const data=generateStage(stage,world.locked,settings);
  assert.equal(JSON.stringify(world.locked),frozen,`stage ${stage} may not rewrite prior layers`);
  world.locked.push({stage,settings,data});
 }
 world.working={stage:last+1,settings:{...DEFAULTS[last+1]},data:null,dataSettings:null};
 world.viewStage=last;
 return world;
}

test('v0.2.3 defines thirteen independent stage boundaries',()=>{
 assert.equal(SCHEMA_VERSION,3);assert.equal(IMPLEMENTED,13);
 assert.equal(STAGES[3][0],'Tectonic plates');assert.equal(STAGES[4][0],'Elevation');
 assert.equal(STAGES[5][0],'Oceans');assert.equal(STAGES[6][0],'Coastlines');
 assert.equal(STAGES[13][0],'Vegetation & habitats');
 const world=makeHistory(13,160);
 assert.doesNotThrow(()=>validateWorld(world));
 for(let stage of [2,3,4,5,6,8,10,13]){
  const snap=snapshotThroughStage(world,stage);
  assert.equal(snap.locked.length,stage);
  assert.equal(snap.working.stage,stage+1);
  assert.doesNotThrow(()=>validateWorld(prepareWorld(structuredClone(snap))));
 }
});

test('plate geometry contains no water, height, crust classification or velocities',()=>{
 const world=makeHistory(4,250),record=world.locked[2];
 assert.deepEqual(Object.keys(record.data).sort(),['owners','plates']);
 assert.ok(record.data.plates.every(p=>Object.keys(p).sort().join(',')==='id,x,y'));
 assert.deepEqual(Object.keys(record.settings).sort(),['plates','seed']);
 const layer4=world.locked[3].data;
 assert.equal(layer4.plateProperties.length,record.data.plates.length);
 assert.ok(layer4.elevations.some(h=>h<-.03)&&layer4.elevations.some(h=>h>.03));
 assert.ok(layer4.elevations.every(Number.isFinite));
});

test('raising boundary stress changes signed relief, never stage-3 cell ownership',()=>{
 const world=makeHistory(3,280),original=JSON.stringify(world.locked[2].data);
 const low=generateStage(4,world.locked,{...DEFAULTS[4],motion:0});
 const high=generateStage(4,world.locked,{...DEFAULTS[4],motion:2});
 assert.notDeepEqual(high.elevations,low.elevations);
 assert.deepEqual(high,generateStage(4,world.locked,{...DEFAULTS[4],motion:2}));
 assert.equal(JSON.stringify(world.locked[2].data),original);
 assert.ok(low.plateProperties.every(p=>p.vx===0&&p.vy===0));
});

test('ocean offset is a monotonic global shift, flooding precisely elevations <= zero',()=>{
 const world=makeHistory(4,340),mesh=world.locked[1].data,elevation=world.locked[3].data;
 const sea=generateOceans(elevation,{oceanOffset:0},mesh);
 const raised=generateOceans(elevation,{oceanOffset:.2},mesh);
 const lowered=generateOceans(elevation,{oceanOffset:-.2},mesh);
 assert.ok(raised.landAreaFraction>sea.landAreaFraction);
 assert.ok(sea.landAreaFraction>lowered.landAreaFraction);
 for(const [offset,record] of [[0,sea],[.2,raised],[-.2,lowered]]){
  assert.equal(record.seaLevel,0);
  for(let i=0;i<mesh.cells.length;i++){
   assert.equal(record.water[i],Number(record.elevations[i]<=0));
   assert.equal(record.elevations[i],+Math.max(-1.8,Math.min(1.8,elevation.elevations[i]+offset)).toFixed(4));
  }
 }
 assert.equal(sea.landAreaFraction,
  mesh.cells.reduce((a,c,i)=>a+(sea.water[i]?0:cellArea(c)),0)/mesh.cells.reduce((a,c)=>a+cellArea(c),0));
 assert.deepEqual(elevation,world.locked[3].data);
});

test('stage-6 coast edits preserve stage-5 flood map and stage-4 relief',()=>{
 const world=makeHistory(5,250),previous=JSON.stringify(world.locked);
 const noCoast=generateStage(6,world.locked,{...DEFAULTS[6],edgeOcean:0,setbackStrength:0});
 const shaped=generateStage(6,world.locked,{...DEFAULTS[6],edgeOcean:1.2,setbackStrength:1.2});
 assert.deepEqual(noCoast.water,world.locked[4].data.water);
 assert.deepEqual(noCoast.elevations,world.locked[4].data.elevations);
 assert.ok(shaped.landAreaFraction<=noCoast.landAreaFraction);
 assert.notDeepEqual(shaped.water,noCoast.water);
 assert.equal(JSON.stringify(world.locked),previous);
});

test('older world schemas are rejected rather than migrated',()=>{
 const current=makeHistory(6,180);
 for(const oldSchema of [1,2]){
  const unsupported={...structuredClone(current),schema:oldSchema};
  assert.throws(()=>prepareWorld(unsupported),/Unsupported or invalid world save/);
  assert.equal(unsupported.schema,oldSchema);
 }
});

test('map controls use a right rail on tall maps, and mesh-off mode strokes no dark lines',()=>{
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
 assert.match(css,/wg-map-short[\s\S]*flex-direction:row/);
 assert.match(app,/mapHeight<260/);
 assert.match(css,/wg-map-buttons[\s\S]*flex-direction:column/);
 assert.match(app,/else if\(stage>=3\)\{ctx\.strokeStyle=colorCache\.colors\[i\]/);
 assert.match(app,/const altitudeColors=.*\[\.5,\[248,249,246\]\]/);
 assert.doesNotMatch(app,/APP_VERSION='0\.2\.2'/);
 assert.match(app,/showOcean:terrain\.hasCoast/);
 const source=selectTerrainSource(4,n=>n===4?{elevations:[-.5,.5]}:null);
 assert.equal(source.hasCoast,false);
});
