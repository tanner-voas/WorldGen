import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ELEVATION_KM_PER_UNIT,ELEVATION_METRES_PER_UNIT,elevationToKm,elevationToMetres,metresToElevation,physicalSlope,sedimentToKm3,displayParameter,storedParameter,terrainVerticalScales} from '../src/elevation-units.js';
import {DEFAULTS,generateStage,generateClimate,generateHydrology,newWorld,upgradeWorld,SCHEMA_VERSION} from '../src/engine.js';
import {buildElevationSurface,selectTerrainSource} from '../src/terrain-3d-model.js';
import {Terrain3DViewer} from '../src/terrain-3d.js';
const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);

test('canonical physical units, signed datum, depth and slope agree',()=>{
 assert.equal(ELEVATION_KM_PER_UNIT,2.7);assert.equal(ELEVATION_METRES_PER_UNIT,2700);
 close(elevationToMetres(.5,.1),1080);close(elevationToMetres(-.5,.1),-1620);
 close(metresToElevation(1080,.1),.5);close(elevationToKm(.1),.27);
 close(physicalSlope(.5,10),.135);close(sedimentToKm3(.5*10),13.5);
});

test('metre controls round trip legacy settings and preserve non-height controls',()=>{
 for(const [key,values] of [['continentalHeight',[.05,.025,.8,DEFAULTS[4].continentalHeight]],['lakeDepth',[.002,.3,DEFAULTS[9].lakeDepth]],['averageArea',[100.3,10000]],['equatorTemp',[29,40]]]){
  for(const value of values)close(storedParameter(key,displayParameter(key,value)),value);
 }
 close(displayParameter('lakeDepth',DEFAULTS[9].lakeDepth),21.6);
 close(displayParameter('continentalHeight',.025),67.5);
 close(displayParameter('lakeDepth',.002),5.4);
 const code=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(code,/Minimum lake depth \(m\)/);assert.match(code,/Crust elevation \(m\)/);
 assert.match(code,/storedParameter\(key,Number\(el.value\)\)/);
 assert.match(code,/elevationToMetres\(height,datum\)/);
});

test('physical vertical scene scale uses horizontal kilometres regardless of visual bounds',()=>{
 for(const geometry of [{width:50,height:50},{width:2048,height:1024},{width:20000,height:50},{width:40000,height:40000}]){
  const s=terrainVerticalScales(geometry);
  close(s.physicalHeightScale/s.worldScale,2.7);
  close(s.heightScale,s.physicalHeightScale*s.baseExaggeration);
  close(s.heightScale,Math.max(.004,Math.min(.24,4.8/Math.max(geometry.width,geometry.height)*18)));
 }
 assert.throws(()=>terrainVerticalScales({width:0,height:0}),/Invalid/);
});

test('climate lapse rate uses the physical height relative to saved sea level',()=>{
 const mesh={width:100,height:100,areaKm2:10000,cells:[{x:50,y:50,poly:[0,0,100,0,100,100,0,100],neighbors:[]}]};
 const coasts={water:[0],seaLevel:.2},low={elevations:[.2]},high={elevations:[.7]};
 const a=generateClimate(mesh,coasts,low,DEFAULTS[8]);const b=generateClimate(mesh,coasts,high,DEFAULTS[8]);
 close(a.meanTemp[0]-b.meanTemp[0],6.2*elevationToKm(.7,.2),.011);
 assert.deepEqual(generateClimate(mesh,{water:[0],seaLevel:-.3},{elevations:[.2]},DEFAULTS[8]).meanTemp,b.meanTemp);
});

test('lake threshold in metres maps to the stored basin depth at a nonzero datum',()=>{
 const cells=Array.from({length:3},(_,i)=>({x:i+.5,y:.5,poly:[i,0,i+1,0,i+1,1,i,1],neighbors:[i-1,i+1].filter(j=>j>=0&&j<3)}));
 const mesh={width:3,height:1,areaKm2:3,cells},coasts={water:[1,0,0],seaLevel:.1},erosion={elevations:[0,.5,.4]};
 const climate={precipitation:[1500,1500,1500],meanTemp:[15,15,15],moisture:[.8,.8,.8]};
 const wet=generateHydrology(mesh,coasts,erosion,climate,{...DEFAULTS[9],lakeDepth:storedParameter('lakeDepth',250),minLakeCells:1});
 const dry=generateHydrology(mesh,coasts,erosion,climate,{...DEFAULTS[9],lakeDepth:storedParameter('lakeDepth',280),minLakeCells:1});
 assert.equal(wet.lakes.length,1);close(elevationToMetres(wet.lakeDepth[2]),270);close(elevationToMetres(wet.lakeLevel[2],coasts.seaLevel),1080);assert.equal(dry.lakes.length,0);
});

test('legacy encoded data survives save validation and the mesh exposes physical and display scales independently',()=>{
 const world=newWorld('Legacy elevation');
 for(let stage=1;stage<=8;stage++){
  const settings={...DEFAULTS[stage],...(stage===2?{averageArea:world.locked[0].data.areaKm2/100}:{})};
  world.locked.push({stage,settings,data:generateStage(stage,world.locked,settings)});
 }
 const settings={...DEFAULTS[9]};world.working={stage:9,settings,data:generateStage(9,world.locked,settings),dataSettings:{...settings}};world.viewStage=9;
 const before=JSON.stringify(world),loaded=upgradeWorld(JSON.parse(before));assert.equal(loaded.schema,SCHEMA_VERSION);assert.deepEqual(loaded.locked,world.locked);assert.deepEqual(loaded.working,world.working);
 const get=stage=>world.locked[stage-1]?.data||(stage===9?world.working.data:null);
 const source=selectTerrainSource(9,get),surface=buildElevationSurface(get(1),get(2),source.elevations,()=>{},{seaLevel:source.seaLevel,hydrology:get(9),waterMask:get(5).water});
 close(surface.physicalHeightScale/surface.worldScale,2.7);close(surface.heightScale,surface.physicalHeightScale*surface.baseExaggeration);
 for(let i=1;i<surface.ocean.length;i+=3)close(surface.ocean[i]/surface.heightScale,source.seaLevel,1e-6);
 const sample=surface.vertexData[6];close(surface.vertexData[1]/surface.heightScale,sample,1e-6);
 const viewer=Object.create(Terrain3DViewer.prototype);Object.assign(viewer,{surface,heightSteps:7,heightMultiplier:1,target:[0,0,0],drawSoon(){}});viewer.applyHeightSteps();
 close(viewer.heightMultiplier,1.05**7);close(surface.physicalHeightScale/surface.worldScale,2.7);
 assert.equal(JSON.stringify(world),before);
});
