import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,assignPlateGeology,generateStage,generatePlates,generateElevation,generateLandforms,newWorld,upgradeWorld,snapshotThroughStage,validateWorld} from '../src/engine.js';
import {readFileSync} from 'node:fs';

function history(through=3,plateSettings={}){
 const locked=[];
 for(let stage=1;stage<=through;stage++){
  const settings={...DEFAULTS[stage],...(stage===1?{width:780,height:550}:{}),...(stage===2?{averageArea:780*550/400,relaxation:0}:{}),...(stage===3?plateSettings:{})};
  locked.push({stage,settings,data:generateStage(stage,locked,settings)});
 }
 return locked;
}
const sameJSON=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b));

test('Layer 3 controls define plate territories; Layer 4 controls change geology without moving borders',()=>{
 const locked=history(),baseline=JSON.stringify(locked);
 const low={...DEFAULTS[4],continental:.1,motion:0};
 const high={...DEFAULTS[4],continental:.9,motion:2};
 const a=generateStage(4,locked,low),b=generateStage(4,locked,high);
 sameJSON(JSON.parse(baseline),locked);
 assert.ok(locked[2].data.plates.every(p=>!Object.hasOwn(p,'continental')&&!Object.hasOwn(p,'vx')&&!Object.hasOwn(p,'vy')));
 assert.ok(a.plateProperties.every(p=>Math.hypot(p.vx,p.vy)===0));
 assert.ok(b.plateProperties.some(p=>p.continental));
 assert.ok(b.plateProperties.some(p=>Math.hypot(p.vx,p.vy)>1.99));
 assert.notDeepEqual(a.elevations,b.elevations);
 const da=generateStage(4,locked,high),db=generateStage(4,locked,high);
 assert.deepEqual(da,db);
 const withA=[...locked,{stage:4,settings:low,data:a}],withB=[...locked,{stage:4,settings:high,data:b}];
 const c=generateStage(5,withA,DEFAULTS[5]),d=generateStage(5,withB,DEFAULTS[5]);
 const landA=generateStage(6,[...withA,{stage:5,settings:DEFAULTS[5],data:c}],DEFAULTS[6]);
 const landB=generateStage(6,[...withB,{stage:5,settings:DEFAULTS[5],data:d}],DEFAULTS[6]);
 assert.notDeepEqual(landA.elevations,landB.elevations);
});

test('v0.2.1 continental/motion settings migrate to Layer 4 and preserve baseline elevations',()=>{
 const legacy={continental:.82,motion:1.35};
 const locked=history(3,legacy);
 // Recreate the old full plate record, including inherited geological fields.
 locked[2].data=generatePlates(locked[1].data,locked[2].settings);
 const oldStage4={...DEFAULTS[4]};
 const expected=generateElevation(locked[1].data,locked[2].data,oldStage4);
 const withNew={...DEFAULTS[4],...legacy};
 const newStage4=generateStage(4,locked,withNew);
 assert.deepEqual(newStage4.elevations,expected.elevations);
 const snapshotWorld=newWorld();snapshotWorld.locked=locked;
 const oldSettings={...oldStage4};delete oldSettings.continental;delete oldSettings.motion;
 snapshotWorld.working={stage:4,settings:oldSettings,data:null,dataSettings:null};
 upgradeWorld(snapshotWorld);
 assert.equal(snapshotWorld.working.settings.continental,.82);
 assert.equal(snapshotWorld.working.settings.motion,1.35);
 const snap=snapshotThroughStage({...snapshotWorld,locked:[...locked,{stage:4,settings:withNew,data:newStage4}],working:{stage:5,settings:{...DEFAULTS[5]},data:null,dataSettings:null}},3);
 assert.equal(snap.working.settings.continental,.82);
 assert.equal(snap.working.settings.motion,1.35);
 const migrated=generateStage(4,locked,snapshotWorld.working.settings);
 assert.deepEqual(migrated.elevations,expected.elevations);
});

test('legacy locked elevations and plate attributes stay usable; new properties validate',()=>{
 const locked=history(3,{continental:.7,motion:1.1});
 locked[2].data=generatePlates(locked[1].data,locked[2].settings);
 const fourth={stage:4,settings:{...DEFAULTS[4]},data:generateElevation(locked[1].data,locked[2].data,DEFAULTS[4])};
 const fifth={stage:5,settings:{...DEFAULTS[5]},data:generateStage(5,[...locked,fourth],DEFAULTS[5])};
 const expected=generateLandforms(locked[1].data,locked[2].data,fourth.data,fifth.data,DEFAULTS[6]);
 const actual=generateStage(6,[...locked,fourth,fifth],DEFAULTS[6]);
 assert.deepEqual(actual,expected);
 const world=newWorld();world.locked=[...locked,fourth,fifth];world.working={stage:6,settings:{...DEFAULTS[6]},data:null,dataSettings:null};
 validateWorld(world);upgradeWorld(world);
 assert.deepEqual(world.locked[3].data,fourth.data);
 const newFourth={stage:4,settings:{...DEFAULTS[4]},data:generateStage(4,locked,DEFAULTS[4])};
 const newWorldRecord=structuredClone(world);newWorldRecord.locked[3]=newFourth;
 validateWorld(newWorldRecord);
 newWorldRecord.locked[3].data.plateProperties[0].vx=Infinity;
 assert.throws(()=>validateWorld(newWorldRecord),/plate properties/);
});

test('UI moves crust/motion to elevation and reserves rows for mobile map controls',()=>{
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
 assert.match(app,/APP_VERSION='0\.2\.2'/);
 assert.match(app,/3:\[\['plates','Plates'/);
 assert.doesNotMatch(app,/3:\[\['plates','Plates'[^\n]*\['continental'/);
 assert.match(app,/4:\[\['continental','Continental ratio'[^\n]*\['motion','Plate motion'/);
 assert.match(css,/v0\.2\.2: reserved mobile toolbar rows/);
 assert.match(css,/\.wg-shell \.wg-overlays,\.wg-shell\.wg-map-compact \.wg-overlays\{top:106px/);
});
