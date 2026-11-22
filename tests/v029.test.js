import test from 'node:test';
import assert from 'node:assert/strict';
import {createStartupStorage,readRecoveryCheckpoint} from '../src/startup-storage.js';
import {newWorld} from '../src/engine.js';

function fixture(initial={}){
 const records=new Map(Object.entries(structuredClone(initial))),readsFail=new Set(),commits=[];
 let failCommit=false;
 const read=async key=>{if(readsFail.has(key))throw Error(`Read failed: ${key}`);return structuredClone(records.get(key));};
 const commit=async changes=>{commits.push(structuredClone(changes));if(failCommit)throw Error('Transaction aborted');for(const ch of changes){if(ch.delete)records.delete(ch.key);else records.set(ch.key,structuredClone(ch.value));}};
 return {records,readsFail,commits,read,failCommit(value){failCommit=value;},startup:createStartupStorage({read,commit})};
}
const metadata={id:'save-1',name:'Saved checkpoint',stage:1,created:'2026-01-01'};
const savedWorld=()=>newWorld('Original world');
const library=()=>({'checkpoint-index':[metadata],'checkpoint:save-1':newWorld('Checkpoint world')});

test('confirmed empty storage opens a fresh world; a valid saved record opens unchanged',async()=>{
 const empty=fixture(),first=await empty.startup.load();assert.equal(first.kind,'ready');assert.equal(first.world.name,'Untitled world');assert.equal(empty.records.has('workspace'),false);
 const original=savedWorld(),present=fixture({workspace:original,...library()});const result=await present.startup.load();assert.equal(result.kind,'ready');assert.deepEqual(result.world,original);assert.deepEqual(result.snapshots,[metadata]);assert.equal(present.commits.length,0);
});
test('workspace read failure quarantines startup and permits independent checkpoint export',async()=>{
 const original=savedWorld(),f=fixture({workspace:original,...library()});f.readsFail.add('workspace');
 const state=await f.startup.load();assert.equal(state.kind,'recovery');assert.equal(state.workspaceRead,false);assert.equal(state.rawAvailable,false);assert.deepEqual(state.library.snapshots,[metadata]);assert.match(state.errors[0],/could not be read/);
 assert.equal((await readRecoveryCheckpoint(f.read,state,metadata.id)).name,'Checkpoint world');assert.equal(f.commits.length,0);assert.deepEqual(f.records.get('workspace'),original);
 f.readsFail.clear();const retry=await f.startup.load();assert.equal(retry.kind,'ready');assert.equal(retry.world.name,original.name);assert.equal(f.commits.length,0);
});
test('invalid and falsy stored records are not mistaken for missing records or mutated',async()=>{
 for(const original of [null,false,0,'',{}, {schema:1,locked:[],working:{stage:1},name:'legacy invalid',extra:'retain'}]){
  // The last fixture may be a valid legacy empty world; only test malformed legacy here.
  if(original?.schema===1)original.working.stage=4;
  const f=fixture({workspace:original,...library()});const state=await f.startup.load();assert.equal(state.kind,'recovery');assert.equal(state.rawAvailable,true);assert.deepEqual(state.raw,original);assert.deepEqual(f.records.get('workspace'),original);assert.equal(f.commits.length,0);
 }
});
test('any library read failure prevents startup writes and replacement even with a valid workspace',async()=>{
 for(const key of ['checkpoint-index']){
  const original=savedWorld(),f=fixture({workspace:original,...library()});f.readsFail.add(key);
  const state=await f.startup.load();assert.equal(state.kind,'recovery');assert.equal(state.rawAvailable,true);assert.deepEqual(state.world,original);assert.equal(state.library,null);
  const result=await f.startup.replace({kind:'new',confirmed:true});assert.equal(result.kind,'recovery');assert.equal(f.commits.length,0);assert.deepEqual(f.records.get('workspace'),original);
 }
});
test('malformed checkpoint index is not silently reset',async()=>{
 for(const index of [null,{},[{}],[metadata,metadata]]){
  const f=fixture({workspace:savedWorld(),'checkpoint-index':index,});const state=await f.startup.load();assert.equal(state.kind,'recovery');assert.equal(f.commits.length,0);assert.deepEqual(f.records.get('checkpoint-index'),index);
 }
});
test('explicit replacement requires confirmation and successful storage transaction',async()=>{
 const original={schema:99,name:'Future save'},f=fixture({workspace:original,...library()});
 await assert.rejects(f.startup.replace({kind:'new'}),/confirmation/);assert.equal(f.commits.length,0);
 f.failCommit(true);const failed=await f.startup.replace({kind:'new',confirmed:true});assert.equal(failed.kind,'recovery');assert.match(failed.errors.at(-1),/committed/);assert.deepEqual(f.records.get('workspace'),original);
 f.failCommit(false);const restored=await f.startup.replace({kind:'checkpoint',id:metadata.id,confirmed:true});assert.equal(restored.kind,'ready');assert.equal(restored.world.name,'Checkpoint world');assert.deepEqual(f.records.get('workspace'),restored.world);assert.deepEqual(f.records.get('checkpoint-index'),[metadata]);assert.equal(f.records.get('checkpoint:save-1').name,'Checkpoint world');
});
test('explicit new world preserves checkpoints and does not proceed during an unresolved read failure',async()=>{
 const f=fixture({workspace:savedWorld(),...library()});f.readsFail.add('workspace');assert.equal((await f.startup.replace({kind:'new',confirmed:true})).kind,'recovery');assert.equal(f.commits.length,0);
 f.readsFail.clear();const result=await f.startup.replace({kind:'new',confirmed:true});assert.equal(result.kind,'ready');assert.equal(result.world.name,'Untitled world');assert.deepEqual(f.records.get('checkpoint-index'),[metadata]);assert.equal(f.records.get('checkpoint:save-1').name,'Checkpoint world');
});
test('missing or corrupt checkpoint cannot replace original workspace',async()=>{
 const original={schema:99},f=fixture({workspace:original,...library()});
 for(const value of [undefined,null,{schema:99}]){
  if(value===undefined)f.records.delete('checkpoint:save-1');else f.records.set('checkpoint:save-1',value);
  const result=await f.startup.replace({kind:'checkpoint',id:metadata.id,confirmed:true});assert.equal(result.kind,'recovery');assert.match(result.errors.at(-1),/Recovery failed/);assert.equal(f.commits.length,0);assert.deepEqual(f.records.get('workspace'),original);
 }
});
test('unsupported world schemas enter recovery instead of being migrated',async()=>{
 const original={schema:1,name:'Unsupported',locked:[],working:{stage:1,settings:{},data:null}};
 const f=fixture({workspace:original,...library()});
 const state=await f.startup.load();
 assert.equal(state.kind,'recovery');assert.deepEqual(f.records.get('workspace'),original);
 assert.equal(f.commits.length,0);
});

test('startup stays quarantined until an explicit replacement has actually committed',async()=>{
 let resolveCommit,entered=false;
 const original={schema:99},records=new Map([['workspace',original],...Object.entries(library())]);
 const startup=createStartupStorage({read:async key=>structuredClone(records.get(key)),commit:async changes=>{entered=true;await new Promise(resolve=>{resolveCommit=resolve;});for(const ch of changes)records.set(ch.key,ch.value);}});
 let finished=false;const operation=startup.replace({kind:'new',confirmed:true}).then(result=>{finished=true;return result;});
 while(!entered)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(finished,false);assert.deepEqual(records.get('workspace'),original);
 resolveCommit();assert.equal((await operation).kind,'ready');assert.equal(records.get('workspace').name,'Untitled world');
});

test('actual app startup with unavailable IndexedDB mounts recovery without generation or autosave listeners',async()=>{
 const previous=new Map(['document','indexedDB','Worker'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 let workerCount=0,documentListeners=0,rootListeners=0,openRequests=0;
 const status={textContent:''},retry={dataset:{recovery:'retry'},addEventListener(_type,callback){this.click=callback;}};
 const panel={querySelector:()=>status,querySelectorAll:()=>[retry]};
 const root={classList:{add(){}},innerHTML:'',querySelector(selector){assert.equal(selector,'.wg-recovery');return panel;},addEventListener(){rootListeners++;}};
 const documentStub={querySelector:()=>root,body:{classList:{add(){}}},addEventListener(){documentListeners++;}};
 const indexedDBStub={open(){openRequests++;const req={error:Error('Temporary open failure')};queueMicrotask(()=>req.onerror());return req;}};
 try{
  for(const [key,value] of Object.entries({document:documentStub,indexedDB:indexedDBStub,Worker:class {constructor(){workerCount++;}}}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  await import('../src/app.js');
  assert.match(root.innerHTML,/World recovery/);assert.match(root.innerHTML,/automatic saving are paused/);assert.doesNotMatch(root.innerHTML,/id="wg-map"/);
  assert.equal(workerCount,0);assert.equal(documentListeners,0);assert.equal(rootListeners,0);assert.equal(openRequests,1);
  retry.click();await new Promise(resolve=>setTimeout(resolve,350));
  assert.equal(openRequests,2);assert.equal(workerCount,0);assert.equal(documentListeners,0);assert.equal(rootListeners,0);assert.match(root.innerHTML,/World recovery/);
 }finally{for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
