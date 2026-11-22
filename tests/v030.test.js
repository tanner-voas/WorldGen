import test from 'node:test';
import assert from 'node:assert/strict';
import {newWorld} from '../src/engine.js';
import {createAutosave,preferenceRecord,applyStoredPreferences,PREFERENCES_KEY} from '../src/persistence.js';
import {createStartupStorage} from '../src/startup-storage.js';
import {checkpointChanges,commitCheckpoint} from '../src/checkpoint-storage.js';

function memoryStorage(initial={}){
 const records=new Map(Object.entries(structuredClone(initial))),commits=[];
 const read=async key=>structuredClone(records.get(key));
 const commit=async changes=>{commits.push(structuredClone(changes));for(const ch of changes){if(ch.delete)records.delete(ch.key);else records.set(ch.key,structuredClone(ch.value));}};
 return {records,commits,read,commit};
}
function autosaveFixture(world=newWorld()){
 const db=memoryStorage({workspace:world}),statuses=[],timers=new Map();let id=0;
 const saver=createAutosave({getWorld:()=>world,commit:db.commit,onStatus:status=>statuses.push(status),schedule:(fn,delay)=>{const key=++id;timers.set(key,{fn,delay});return key;},cancel:key=>timers.delete(key)});
 return {...db,world,saver,statuses,timers};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('idle flush is a no-op, navigation saves only a tiny record, and does not clone terrain',async()=>{
 const f=autosaveFixture();const original=structuredClone(f.world);
 // A non-cloneable property would throw if preference saving touched the full world.
 f.world.working.data={largeArray:Array(5000).fill(1),mustNotClone:()=>{}};
 assert.equal(await f.saver.flush(),true);assert.equal(f.commits.length,0);
 f.world.showEdges=false;f.world.viewMode='height';f.world.viewport={scale:2,centerX:30,centerY:40};f.saver.mark('preferences');
 assert.equal(f.saver.status,'pending');assert.equal(f.commits.length,0);
 assert.equal(await f.saver.flush(),true);assert.deepEqual(f.statuses,['pending','saving','saved']);
 assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,1);assert.equal(f.commits[0][0].key,PREFERENCES_KEY);
 assert.ok(JSON.stringify(f.commits[0]).length<500);assert.deepEqual(f.records.get('workspace'),original);assert.equal(f.world.updated,original.updated);
 assert.equal(await f.saver.flush(),true);assert.equal(f.commits.length,1);
});
test('full writes include latest preferences, atomically clear the sidecar, and cannot be delayed by panning',async()=>{
 const f=autosaveFixture();f.world.showEdges=false;f.saver.mark('preferences',650);await f.saver.flush();
 f.world.name='Renamed';f.saver.mark();const [key,timer]=[...f.timers.entries()][0];assert.equal(timer.delay,260);
 for(let i=0;i<51;i++){f.world.viewport={scale:1,centerX:i,centerY:20};f.saver.mark('preferences',650);}
 assert.equal(f.timers.size,1);assert.equal(f.timers.get(key),timer);await f.saver.flush();
 assert.deepEqual(f.commits.at(-1).map(ch=>ch.key),['workspace',PREFERENCES_KEY]);assert.equal(f.records.has(PREFERENCES_KEY),false);
 assert.equal(f.records.get('workspace').name,'Renamed');assert.equal(f.records.get('workspace').viewport.centerX,50);
});
test('an in-flight full write is immutable; subsequent edits coalesce and saved only appears after all commits',async()=>{
 let world=newWorld(),transactions=[],resolvers=[],statuses=[];
 const saver=createAutosave({getWorld:()=>world,commit:changes=>{transactions.push(changes);return new Promise(resolve=>resolvers.push(resolve));},onStatus:status=>statuses.push(status)});
 world.name='First';saver.mark();const flushed=saver.flush();await tick();assert.equal(transactions.length,1);
 for(let i=0;i<26;i++){world.name=`Edit ${i}`;saver.mark();}world.showFlow=true;saver.mark('preferences');
 assert.equal(transactions[0][0].value.name,'First');assert.equal(saver.status,'saving');assert.equal(saver.flush(),flushed);
 resolvers.shift()();await tick();assert.equal(transactions.length,2);assert.equal(transactions[1][0].value.name,'Edit 25');assert.equal(transactions[1][0].value.showFlow,true);assert.equal(saver.status,'saving');
 resolvers.shift()();assert.equal(await flushed,true);assert.deepEqual(statuses,['pending','saving','saved']);
});
test('failed full commit retains world changes; preference changes cannot turn retry into a preference-only write',async()=>{
 const world=newWorld(),db=memoryStorage({workspace:world}),statuses=[];let failed=true,attempts=[];
 const saver=createAutosave({getWorld:()=>world,commit:async changes=>{attempts.push(changes);if(failed)throw Error('Quota exceeded');await db.commit(changes);},onStatus:status=>statuses.push(status)});
 world.name='Unsaved';saver.mark();assert.equal(await saver.flush(),false);assert.equal(saver.status,'error');assert.equal(db.records.get('workspace').name,'Untitled world');
 world.showFlow=true;saver.mark('preferences');failed=false;assert.equal(await saver.flush(),true);assert.equal(attempts[1][0].key,'workspace');assert.equal(db.records.get('workspace').showFlow,true);assert.equal(db.records.get('workspace').name,'Unsaved');assert.deepEqual(statuses,['pending','saving','error','pending','saving','saved']);
});
test('failed preference-only save retries only the sidecar, not a full world',async()=>{
 const world=newWorld(),db=memoryStorage({workspace:world});let fail=true;
 const saver=createAutosave({getWorld:()=>world,commit:async changes=>{if(fail)throw Error('temporary failure');await db.commit(changes);}});
 world.showEdges=false;saver.mark('preferences');assert.equal(await saver.flush(),false);assert.equal(saver.status,'error');fail=false;
 assert.equal(await saver.flush(),true);assert.equal(db.commits[0].length,1);assert.equal(db.commits[0][0].key,PREFERENCES_KEY);
});
test('old imports lacking revision identity get a full save before preferences; failed writes retain that requirement',async()=>{
 const world=newWorld();delete world.id;delete world.updated;let fail=true,attempts=[];
 const saver=createAutosave({getWorld:()=>world,commit:async changes=>{attempts.push(changes);if(fail)throw Error('aborted');}});
 saver.mark('preferences');assert.equal(await saver.flush(),false);fail=false;assert.equal(await saver.flush(),true);assert.equal(attempts[0][0].key,'workspace');assert.equal(attempts[1][0].key,'workspace');assert.equal(typeof world.id,'string');
});
test('startup merges only well-typed preference fields for exactly the stored revision',async()=>{
 const world=newWorld('Original'),db=memoryStorage({workspace:world,'checkpoint-index-v2':true});
 const pref=preferenceRecord({...world,viewMode:'height',showEdges:false,viewport:{scale:2,centerX:100,centerY:50}});
 Object.assign(pref.values,{name:'Do not merge',locked:[{}],viewStage:200,showFlow:'yes'});
 db.records.set(PREFERENCES_KEY,pref);const startup=createStartupStorage(db);const result=await startup.load();
 assert.equal(result.kind,'ready');assert.equal(result.needsWorldSave,false);assert.equal(result.world.name,'Original');assert.deepEqual(result.world.locked,[]);assert.equal(result.world.viewStage,1);assert.equal(result.world.showFlow,false);assert.equal(result.world.showEdges,false);assert.equal(result.world.viewMode,'height');assert.equal(result.world.viewport.scale,2);assert.equal(db.commits.length,0);
 for(const changed of [{worldId:'another'},{worldUpdated:'old'}]){db.records.set(PREFERENCES_KEY,{...pref,...changed});const r=await startup.load();assert.deepEqual(r.world,world);}
 const malformed={...pref,values:{viewMode:'not-a-mode',viewport:{scale:-1,centerX:10,centerY:20}}};assert.deepEqual(applyStoredPreferences(structuredClone(world),malformed),world);
});
test('optional preference read failure leaves the valid world usable and does not write anything',async()=>{
 const world=newWorld(),db=memoryStorage({workspace:world,'checkpoint-index-v2':true});
 const startup=createStartupStorage({...db,read:async key=>{if(key===PREFERENCES_KEY)throw Error('sidecar unavailable');return db.read(key);}});
 const result=await startup.load();assert.equal(result.kind,'ready');assert.deepEqual(result.world,world);assert.equal(db.commits.length,0);
});
test('explicit recovery restores checkpoint preferences instead of applying the prior working world sidecar',async()=>{
 const world=newWorld(),checkpoint=structuredClone(world),metadata={id:'a',name:'A',stage:1};
 const db=memoryStorage({workspace:world,'checkpoint-index-v2':true,'checkpoint-index':[metadata],'checkpoint:a':checkpoint,[PREFERENCES_KEY]:preferenceRecord({...world,showEdges:false})});
 const startup=createStartupStorage(db);assert.equal((await startup.load()).world.showEdges,false);
 const recovered=await startup.replace({kind:'checkpoint',id:'a',confirmed:true});assert.equal(recovered.kind,'ready');assert.equal(recovered.world.showEdges,true);assert.equal(db.records.has(PREFERENCES_KEY),false);assert.equal((await startup.load()).world.showEdges,true);
});
test('confirmed empty storage is marked for an initial full save',async()=>{
 const db=memoryStorage(),startup=createStartupStorage(db);const ready=await startup.load();assert.equal(ready.needsWorldSave,true);assert.equal(db.records.has('workspace'),false);
});

// Minimal transaction simulator: requests run asynchronously, all writes are
// staged, and successive readwrite transactions see the latest committed index.
// It tests the production request/abort/completion path without browser globals.
function transactionalDB(initial={}){
 let records=new Map(Object.entries(structuredClone(initial))),tail=Promise.resolve(),transactions=[],abortAt=null;
 const database={transaction(name,mode){
  assert.equal(name,'data');assert.equal(mode,'readwrite');
  const tx={error:null,objectStore(){return store;}},ops=[];let active=true,release,started=tail,finished=new Promise(resolve=>release=resolve),draft,processing=false;
  tail=finished;transactions.push(ops);
  function abort(error){if(!active)return;active=false;tx.error=error;queueMicrotask(()=>{tx.onabort?.();release();});}
  tx.abort=()=>abort(Error('Aborted'));
  function enqueue(kind,key,value){const req={result:undefined};ops.push({kind,key});queue.push(()=>{
   if(abortAt===kind+' '+key){abortAt=null;abort(Error('Injected transaction failure'));return;}
   if(kind==='get')req.result=structuredClone(draft.get(key));else if(kind==='count')req.result=Number(draft.has(key));else if(kind==='put')draft.set(key,structuredClone(value));else draft.delete(key);req.onsuccess?.();
  });pump();return req;}
  const queue=[];
  async function pump(){if(processing||!active)return;processing=true;await started;if(!active)return;draft ||= new Map(records);
   while(queue.length&&active){await tick();if(active)queue.shift()();}
   if(active){records=draft;active=false;tx.oncomplete?.();release();}
  }
  const store={get:key=>enqueue('get',key),count:key=>enqueue('count',key),put:(value,key)=>enqueue('put',key,value),delete:key=>enqueue('delete',key)};
  return tx;
 }};
 return {database,transactions,get records(){return records;},fail(kind,key){abortAt=kind+' '+key;}};
}
const meta=id=>({id,name:id,created:'today',stage:1});
const save=id=>({kind:'save',metadata:meta(id),world:newWorld(id)});
test('checkpoint saves and deletes atomically read and update the persisted index, including overlapping operations',async()=>{
 const f=transactionalDB();const p1=commitCheckpoint(f.database,save('a')),p2=commitCheckpoint(f.database,save('b'));
 assert.deepEqual((await p1).map(x=>x.id),['a']);assert.deepEqual((await p2).map(x=>x.id),['b','a']);assert.equal(f.records.get('checkpoint:a').name,'a');assert.equal(f.records.get('checkpoint:b').name,'b');
 assert.deepEqual((await commitCheckpoint(f.database,{kind:'delete',id:'a'})).map(x=>x.id),['b']);assert.equal(f.records.has('checkpoint:a'),false);assert.equal(f.transactions.length,3);
});
test('failed checkpoint save/delete transactions leave both data and index unchanged',async()=>{
 const world=newWorld('Original'),f=transactionalDB({'checkpoint-index':[meta('a')],'checkpoint:a':world});
 f.fail('put','checkpoint-index');await assert.rejects(commitCheckpoint(f.database,save('b')),/Injected/);assert.equal(f.records.has('checkpoint:b'),false);assert.deepEqual(f.records.get('checkpoint-index'),[meta('a')]);
 f.fail('put','checkpoint-index');await assert.rejects(commitCheckpoint(f.database,{kind:'delete',id:'a'}),/Injected/);assert.deepEqual(f.records.get('checkpoint:a'),world);assert.deepEqual(f.records.get('checkpoint-index'),[meta('a')]);
});
test('invalid checkpoint indexes and duplicate IDs are rejected rather than replaced',async()=>{
 for(const bad of [null,{},undefined,[meta('a'),meta('a')]]){const f=transactionalDB({'checkpoint-index':bad});await assert.rejects(commitCheckpoint(f.database,save('b')),/index/i);assert.equal(f.records.has('checkpoint:b'),false);assert.deepEqual(f.records.get('checkpoint-index'),bad);}
 assert.throws(()=>checkpointChanges([meta('a')],save('a')),/metadata/);
});

test('switching worlds during an active commit preserves the new world and clears old preferences',async()=>{
 let world=newWorld('Previous'),changes=[],release=[];
 const saver=createAutosave({getWorld:()=>world,commit:batch=>{changes.push(batch);return new Promise(resolve=>release.push(resolve));}});
 world.showEdges=false;saver.mark('preferences');const flushed=saver.flush();await tick();
 assert.equal(changes[0][0].key,PREFERENCES_KEY);
 // Checkpoint restoration can deliberately reuse both ID and updated stamp.
 world={...newWorld('Restored'),id:world.id,updated:world.updated};saver.mark();
 release.shift()();await tick();assert.equal(changes[1][0].key,'workspace');assert.equal(changes[1][0].value.name,'Restored');assert.equal(changes[1][0].value.showEdges,true);assert.deepEqual(changes[1][1],{key:PREFERENCES_KEY,delete:true});
 release.shift()();assert.equal(await flushed,true);
});

test('a new edit arriving on completion schedules a separate save instead of becoming stranded',async()=>{
 const world=newWorld(),db=memoryStorage({workspace:world});let again=true,autosave;
 autosave=createAutosave({getWorld:()=>world,commit:db.commit,onStatus:status=>{if(status==='saved'&&again){again=false;world.showEdges=false;autosave.mark('preferences');}}});
 world.name='Updated';autosave.mark();assert.equal(await autosave.flush(),true);assert.equal(autosave.status,'pending');assert.equal(await autosave.flush(),true);assert.equal(db.commits.length,2);assert.equal(db.records.get(PREFERENCES_KEY).values.showEdges,false);
});
