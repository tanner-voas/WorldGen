import test from 'node:test';
import assert from 'node:assert/strict';
import {cellArea,landAreaFraction,generateMesh,generateStage,generateCoasts,DEFAULTS,WORLD_WIDTH,WORLD_HEIGHT,newWorld,upgradeWorld,validateWorld,snapshotThroughStage} from '../src/engine.js';

function buildWorld(count=150){
 const world=newWorld('v0.1.2 audit');
 for(let stage=1;stage<=5;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?{count,seed:7758,distribution:'clustered',jitter:1.6,relaxation:0}: {})};
  const data=generateStage(stage,world.locked,settings);
  world.locked.push({stage,settings,data});
 }
 world.working={stage:6,settings:{},data:null,dataSettings:null};
 return world;
}

test('Voronoi polygon areas cover the world without gaps and have varying sizes',()=>{
 const mesh=generateMesh({...DEFAULTS[1],count:500,distribution:'clustered',jitter:1.6,relaxation:0,seed:2026});
 const areas=mesh.cells.map(cellArea),sum=areas.reduce((a,b)=>a+b,0);
 assert.ok(Math.abs(sum-WORLD_WIDTH*WORLD_HEIGHT)<WORLD_WIDTH*WORLD_HEIGHT*.00005,`area total ${sum}`);
 assert.ok(Math.max(...areas)>Math.min(...areas)*1.5);
});

test('coastline land target is calculated from true polygon area, not number of polygons',()=>{
 const widths=[60,20,10,10],cells=[],elevations=[0,1,2,3];let left=0;
 for(const width of widths){cells.push({poly:[left,0,left+width,0,left+width,1,left,1]});left+=width;}
 const mesh={cells},coast=generateCoasts({elevations},{land:0.4},mesh);
 assert.deepEqual(coast.water,[1,0,0,0]);
 assert.equal(coast.landFraction,0.75);
 assert.equal(coast.landAreaFraction,0.4);
 assert.equal(landAreaFraction(mesh,coast.water),0.4);
 const legacy=generateCoasts({elevations},{land:0.5});
 assert.equal(legacy.landFraction,0.5,'direct callers without a mesh retain count-based weighting');
});

test('new stage-4 generation reports accurate area coverage and stage 5 still preserves the coast',()=>{
 const world=buildWorld();const mesh=world.locked[0].data,coasts=world.locked[3].data,land=world.locked[4].data;
 const maxShare=Math.max(...mesh.cells.map(cellArea))/(WORLD_WIDTH*WORLD_HEIGHT);
 assert.ok(Math.abs(coasts.landAreaFraction-DEFAULTS[4].land)<=maxShare+.0001);
 assert.ok(Math.abs(coasts.landAreaFraction-landAreaFraction(mesh,coasts.water))<1e-10);
 for(let i=0;i<coasts.water.length;i++)assert.equal(land.elevations[i]<coasts.seaLevel,Boolean(coasts.water[i]));
 const snapshot=snapshotThroughStage(world,4);
 assert.equal(snapshot.locked.length,4);
 assert.equal(snapshot.locked[3].data.landAreaFraction,coasts.landAreaFraction);
 assert.doesNotThrow(()=>validateWorld(snapshot));
});

test('legacy coast records remain unchanged and report derived geographic area',()=>{
 const world=buildWorld();delete world.locked[3].data.landAreaFraction;
 const before=JSON.stringify(world.locked);
 upgradeWorld(world);
 assert.equal(JSON.stringify(world.locked),before);
 assert.ok(landAreaFraction(world.locked[0].data,world.locked[3].data.water)>0);
});

test('import rejects malformed plate velocities, ruggedness, and inconsistent class counts',()=>{
 const world=buildWorld();
 const badPlate=structuredClone(world);badPlate.locked[1].data.plates[0].vx=Infinity;
 assert.throws(()=>validateWorld(badPlate),/Invalid plate/);
 const badSlope=structuredClone(world);badSlope.locked[4].data.ruggedness.pop();
 assert.throws(()=>validateWorld(badSlope),/Invalid landform/);
 const badCount=structuredClone(world);badCount.locked[4].data.counts[0]++;
 assert.throws(()=>validateWorld(badCount),/Invalid landform/);
});

test('older working-stage numeric settings are constrained; locked history is not altered',()=>{
 const world=buildWorld();world.locked=world.locked.slice(0,1);
 world.working={stage:2,settings:{plates:1e9,continental:-2,motion:Infinity,seed:'bad'},data:null,dataSettings:null};
 const before=JSON.stringify(world.locked);
 upgradeWorld(world);
 assert.equal(JSON.stringify(world.locked),before);
 assert.equal(world.working.settings.plates,50);
 assert.equal(world.working.settings.continental,.1);
 assert.equal(world.working.settings.motion,DEFAULTS[2].motion);
 assert.equal(world.working.settings.seed,DEFAULTS[2].seed);
});
