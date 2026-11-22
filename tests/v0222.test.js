import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,generateStage,generatePlates,newWorld,prepareWorld,validateWorld} from '../src/engine.js';
import {readFileSync} from 'node:fs';
function previous(through=3){
 const locked=[];
 for(let stage=1;stage<=through;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?{width:780,height:550}:{}),...(stage===2?{averageArea:780*550/350,relaxation:0}:{})};
  locked.push({stage,settings,data:generateStage(stage,locked,settings)});
 }
 return locked;
}
test('Layer 3 stores just territories, Layer 4 stores all motion and derived height',()=>{
 const locked=previous(),raw=JSON.stringify(locked);
 const low=generateStage(4,locked,{...DEFAULTS[4],motion:0});
 const high=generateStage(4,locked,{...DEFAULTS[4],motion:2});
 assert.equal(JSON.stringify(locked),raw);
 assert.ok(locked[2].data.plates.every(p=>!('vx' in p)&&!('continental' in p)));
 assert.ok(low.plateProperties.every(p=>p.vx===0&&p.vy===0));
 assert.ok(high.plateProperties.some(p=>Math.hypot(p.vx,p.vy)>1.9));
 assert.notDeepEqual(low.elevations,high.elevations);
});
test('layer 5 floods the new altitude field without a targeted land ratio',()=>{
 const locked=previous(4),previousOcean=generateStage(5,locked,{oceanOffset:0});
 const drier=generateStage(5,locked,{oceanOffset:.5});
 assert.ok(drier.landAreaFraction>previousOcean.landAreaFraction);
 assert.ok(previousOcean.water.every((v,i)=>v===Number(previousOcean.elevations[i]<=0)));
 assert.ok(!('coverage' in previousOcean));
});
test('layer 6 changes coast shape but cannot mutate layer 5',()=>{
 const locked=previous(5),old=JSON.stringify(locked);
 const coast=generateStage(6,locked,DEFAULTS[6]);
 assert.equal(coast.seaLevel,0);
 assert.ok(coast.water.every((v,i)=>v===Number(coast.elevations[i]<=0)));
 assert.equal(JSON.stringify(locked),old);
 const world=newWorld();world.locked=[...locked,{stage:6,settings:DEFAULTS[6],data:coast}];
 world.working={stage:7,settings:{...DEFAULTS[7]},data:null,dataSettings:null};
 assert.doesNotThrow(()=>validateWorld(prepareWorld(world)));
});
test('layer labels and mobile controls reflect the split',()=>{
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
 assert.match(app,/APP_VERSION='0\.2\.3'/);
 assert.match(app,/3:\[\['plates','Plates'/);
 assert.doesNotMatch(app,/3:\[\['plates','Plates'[^\n]*continental/);
 assert.match(app,/4:\[\['motion','Boundary stress'/);
 assert.match(app,/5:\[\['oceanOffset','Ocean elevation offset/);
 assert.match(css,/wg-map-short/);
});
