// Startup is deliberately fail-closed: an unsuccessful read is not an empty
// database. The caller must not start the normal editor until kind === 'ready'.
import {IMPLEMENTED,newWorld,upgradeWorld} from './engine.js';
import {PREFERENCES_KEY,applyStoredPreferences} from './persistence.js';

export const WORKSPACE_KEY='workspace';
const message=error=>error?.message||String(error);
const upgraded=raw=>upgradeWorld(structuredClone(raw));
const put=(key,value)=>({key,value});

function checkMetadata(entries,legacy=false){
 const ids=new Set();
 for(const entry of entries){
  if(typeof entry?.id!=='string'||!entry.id||ids.has(entry.id)||typeof entry.name!=='string'||!Number.isInteger(entry.stage)||entry.stage<(legacy?0:1)||entry.stage>IMPLEMENTED)throw Error('Checkpoint library has invalid metadata');
  ids.add(entry.id);
 }
}

async function inspectLibrary(read){
 const [index,legacy,marker]=await Promise.all([read('checkpoint-index'),read('snapshots'),read('checkpoint-index-v2')]);
 if(index!==undefined){
  if(!Array.isArray(index))throw Error('Checkpoint index is invalid');
  checkMetadata(index,!marker);
  const snapshots=marker?index:index.map(s=>({...s,stage:Math.min(IMPLEMENTED,s.stage+1)}));
  return {snapshots,legacyWorlds:null,changes:marker?[]:[put('checkpoint-index',snapshots),put('checkpoint-index-v2',true)]};
 }
 if(legacy===undefined)return {snapshots:[],legacyWorlds:null,changes:marker?[]:[put('checkpoint-index-v2',true)]};
 if(!Array.isArray(legacy))throw Error('Legacy checkpoint library is invalid');
 checkMetadata(legacy,true);
 const snapshots=legacy.map(({id,name,created,stage})=>({id,name,created,stage:Math.min(IMPLEMENTED,stage+1)}));
 // Do not discard invalid legacy checkpoint contents. Copy raw records; opening
 // each checkpoint still validates/upgrades it, just like a modern checkpoint.
 const legacyWorlds=new Map(legacy.map(s=>[s.id,s.world]));
 const changes=[...legacy.map(s=>put(`checkpoint:${s.id}`,s.world===undefined?null:s.world)),put('checkpoint-index',snapshots),put('checkpoint-index-v2',true),{key:'snapshots',delete:true}];
 return {snapshots,legacyWorlds,changes};
}

export async function inspectStartup(read){
 const [saved,library]=await Promise.allSettled([read(WORKSPACE_KEY),inspectLibrary(read)]);
 const state={kind:'recovery',rawAvailable:saved.status==='fulfilled'&&saved.value!==undefined,raw:saved.status==='fulfilled'?saved.value:undefined,workspaceRead:saved.status==='fulfilled',library:library.status==='fulfilled'?library.value:null,world:null,errors:[]};
 if(saved.status==='rejected')state.errors.push(`Working world could not be read: ${message(saved.reason)}`);
 else if(state.rawAvailable){
  try{state.world=upgraded(state.raw);}catch(error){state.errors.push(`Working world could not be validated: ${message(error)}`);}
 }
 if(library.status==='rejected')state.errors.push(`Checkpoint library could not be read: ${message(library.reason)}`);
 return state;
}

export async function readRecoveryCheckpoint(read,state,id){
 if(!state.library?.snapshots.some(s=>s.id===id))throw Error('Checkpoint not found in the loaded library');
 const raw=state.library.legacyWorlds?state.library.legacyWorlds.get(id):await read(`checkpoint:${id}`);
 if(raw===undefined)throw Error('Checkpoint data unavailable');
 return upgraded(raw);
}

export function createStartupStorage({read,commit}){
 async function finish(state,world,changes){
  try{
   if(changes.length)await commit(changes);
   return {kind:'ready',world,snapshots:state.library.snapshots,needsWorldSave:!state.rawAvailable&&!changes.some(change=>change.key===WORKSPACE_KEY)};
  }catch(error){return {...state,errors:[...state.errors,`Storage changes could not be committed: ${message(error)}`]};}
 }
 return {
  async load(){
   const state=await inspectStartup(read);
   if(state.errors.length)return state;
   const world=state.world||newWorld(); // Only after confirmed absence.
   const changes=[...state.library.changes];
   if(state.raw?.schema===1)changes.push(put(WORKSPACE_KEY,world),{key:PREFERENCES_KEY,delete:true});
   else if(state.rawAvailable){
    // Preferences are optional, never authoritative for generated data.
    try{applyStoredPreferences(world,await read(PREFERENCES_KEY));}catch{}
   }
   return finish(state,world,changes);
  },
  async replace(choice){
   // Only an explicit recovery action may replace the working record. Re-read
   // first so a transient failure never silently loses a now-readable library.
   if(choice?.confirmed!==true||!['new','checkpoint'].includes(choice.kind))throw Error('Explicit replacement confirmation required');
   const state=await inspectStartup(read);
   if(!state.workspaceRead||!state.library)return state;
   let world;
   try{world=choice.kind==='new'?newWorld():await readRecoveryCheckpoint(read,state,choice.id);}
   catch(error){return {...state,errors:[...state.errors,`Recovery failed: ${message(error)}`]};}
   // The replacement and any legacy library migration are one transaction.
   // The editor is not opened until that transaction completes successfully.
   return finish(state,world,[...state.library.changes,put(WORKSPACE_KEY,world),{key:PREFERENCES_KEY,delete:true}]);
  }
 };
}
