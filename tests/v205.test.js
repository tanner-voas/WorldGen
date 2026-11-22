import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,IMPLEMENTED,generateStage,generateGeometry,meshTargetCount,validateWorld,newWorld} from '../src/engine.js';
import {stagePresets,applyStagePreset,matchingPreset} from '../src/presets.js';
import {clampRelief,readReliefPreference,writeReliefPreference,formatRelief} from '../src/relief-setting.js';
import {Terrain3DViewer} from '../src/terrain-3d.js';

const geometry=generateGeometry({...DEFAULTS[1],width:2400,height:1100});

test('all thirteen stages offer distinct descriptive presets and retain the seed',()=>{
 for(let stage=1;stage<=IMPLEMENTED;stage++){
  const choices=stagePresets(stage,geometry);
  assert.ok(choices.length>=3,`stage ${stage}: expected several choices`);
  assert.equal(new Set(choices.map(c=>c.id)).size,choices.length);
  for(const c of choices){
   assert.ok(c.label.length>4&&c.description.length>35,`stage ${stage} should explain ${c.id}`);
   assert.ok(Object.values(c.values).every(v=>typeof v!=='number'||Number.isFinite(v)));
   assert.deepEqual(Object.keys(c.values).sort(),Object.keys(DEFAULTS[stage]).sort(),`stage ${stage} no hidden settings`);
  }
  const baseline={...DEFAULTS[stage],seed:12345};
  for(const choice of choices){
   const applied=applyStagePreset(stage,baseline,geometry,choice.id);
   assert.equal(applied.seed,baseline.seed,'changing presets may not reroll the seed');
   assert.equal(matchingPreset(stage,applied,geometry)?.id,choice.id);
  }
 }
});

test('physical area adapts density, plate counts, uplift reach and river threshold',()=>{
 const small=generateGeometry({...DEFAULTS[1],width:600,height:500});
 const large=generateGeometry({...DEFAULTS[1],width:12000,height:9000});
 for(const g of [small,large]){
  const setting=stagePresets(2,g).find(p=>p.id==='detailed').values;
  assert.equal(meshTargetCount(g,setting.averageArea),5000);
 }
 const get=(stage,id,key,g)=>stagePresets(stage,g).find(p=>p.id===id).values[key];
 assert.ok(get(3,'fragmented','plates',large)>get(3,'fragmented','plates',small));
 assert.ok(get(4,'mountains','upliftWidth',large)>get(4,'mountains','upliftWidth',small));
 assert.ok(get(10,'dry','riverThreshold',large)>get(10,'dry','riverThreshold',small));
});

function prepared(stages=13){
 const locked=[];
 for(let stage=1;stage<=stages;stage++){
  const settings={...DEFAULTS[stage]};
  if(stage===1)Object.assign(settings,{width:850,height:700});
  if(stage===2)Object.assign(settings,{averageArea:850*700/330,relaxation:0});
  if(stage===8)Object.assign(settings,{iterations:4});
  const data=generateStage(stage,locked,settings);
  locked.push({stage,settings,data});
 }
 return locked;
}

test('the balanced preset generates a full, finite, connected thirteen-stage world',()=>{
 const locked=prepared(13);
 assert.equal(locked.length,13);
 assert.equal(locked[1].data.cells.length,330);
 assert.ok(locked[3].data.elevations.every(Number.isFinite));
 assert.ok(locked[4].data.water.includes(0)&&locked[4].data.water.includes(1));
 assert.equal(locked[12].data.coverClass.length,330);
 const world=newWorld();world.locked=locked;world.working={stage:14,settings:{},data:null,dataSettings:null};
 assert.doesNotThrow(()=>validateWorld(world));
});

test('layer 7–13 presets visibly change their own saved-map or inspected attributes',()=>{
 const locked=prepared(13),mesh=locked[1].data;
 const prev=JSON.stringify(locked);
 const keyFields={7:'elevations',8:'erosionDepth',9:'precipitation',10:'localRunoff',11:'depthM',12:'biome',13:'canopyCover'};
 const ids={7:['rolling','alpine'],8:['pristine','rivers'],9:['desert','rainforest'],10:['dry','rivers'],11:['thin','fertile'],12:['arid','forested'],13:['sparse','old']};
 for(let stage=7;stage<=13;stage++){
  const [low,high]=ids[stage];
  const settingsA=applyStagePreset(stage,DEFAULTS[stage],geometry,low);
  const settingsB=applyStagePreset(stage,DEFAULTS[stage],geometry,high);
  if(stage===8){settingsA.iterations=4;settingsB.iterations=8;}
  const prefix=locked.slice(0,stage-1);
  const a=generateStage(stage,prefix,settingsA);
  const b=generateStage(stage,prefix,settingsB);
  assert.equal(a[keyFields[stage]].length,mesh.cells.length);
  assert.notDeepEqual(a[keyFields[stage]],b[keyFields[stage]],`stage ${stage} profiles must affect currently visible data`);
 }
 assert.equal(JSON.stringify(locked),prev,'preset generation must not mutate already locked layers');
});

test('typed 3D relief preserves exact multiplier and can be restored during a session',()=>{
 const saved=new Map(),storage={getItem:k=>saved.has(k)?saved.get(k):null,setItem:(k,v)=>saved.set(k,v)};
 assert.equal(readReliefPreference(storage),1);
 writeReliefPreference(15.37,storage);
 assert.equal(readReliefPreference(storage),15.37);
 assert.equal(formatRelief(15.37),'15.37×');
 assert.equal(clampRelief(2000),1000);
 const viewer=Object.create(Terrain3DViewer.prototype);let frames=0;
 Object.assign(viewer,{disposed:false,heightSteps:0,heightMultiplier:1,heightTimer:null,target:[0,.4,0],fitActive:false,drawSoon(){frames++;}});
 viewer.setHeightMultiplier(readReliefPreference(storage));
 assert.ok(Math.abs(viewer.heightMultiplier-15.37)<1e-9);
 assert.ok(Math.abs(viewer.target[1]-.4*15.37)<1e-9);
 assert.equal(frames,1);
 assert.throws(()=>viewer.setHeightMultiplier(1001),/out of range/);
});

test('contrasting full-world preset recipes survive every layer at different physical scales',()=>{
 const scenarios=[
  {name:'Dry mountain continent',geometry:{shape:'rectangle',width:850,height:690},recipe:{3:'fragmented',4:'mountains',5:'exposed',6:'untouched',7:'alpine',8:'pristine',9:'desert',10:'dry',11:'thin',12:'arid',13:'sparse'}},
  {name:'Mostly submerged islands',geometry:{shape:'circle',radius:760},recipe:{3:'few',4:'quiet',5:'deep',6:'coastal',7:'volcanic',8:'weathered',9:'rainforest',10:'lakes',11:'wet',12:'mosaic',13:'riverside'}},
  {name:'Large lush region',geometry:{shape:'ellipse',radiusX:4200,radiusY:2900},recipe:{3:'balanced',4:'balanced',5:'balanced',6:'balanced',7:'rolling',8:'rivers',9:'rainforest',10:'rivers',11:'fertile',12:'forested',13:'old'}}
 ];
 for(const scenario of scenarios){
  const locked=[];
  const geo=generateGeometry({...DEFAULTS[1],...scenario.geometry});
  for(let stage=1;stage<=13;stage++){
   let settings;
   if(stage===1)settings={...DEFAULTS[1],...scenario.geometry};
   else if(stage===2)settings=applyStagePreset(stage,DEFAULTS[stage],geo,'coarse');
   else settings=applyStagePreset(stage,DEFAULTS[stage],geo,scenario.recipe[stage]||'balanced');
   if(stage===8)settings.iterations=Math.min(settings.iterations,9);
   const data=generateStage(stage,locked,settings);
   assert.ok(data&&typeof data==='object',`${scenario.name} layer ${stage}`);
   locked.push({stage,settings,data});
  }
  const world=newWorld(scenario.name);world.locked=locked;
  world.working={stage:14,settings:{},data:null,dataSettings:null};
  assert.doesNotThrow(()=>validateWorld(world),`${scenario.name} is a valid saved world`);
  assert.equal(locked[12].data.coverClass.length,locked[1].data.cells.length);
  assert.ok(locked[12].data.summary.meanCanopy>=0);
 }
});
