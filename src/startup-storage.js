// Startup is deliberately fail-closed: an unsuccessful read is not an empty
// database. The caller must not start the normal editor until kind === 'ready'.
import {IMPLEMENTED,newWorld,prepareWorld} from './engine.js';
import {PREFERENCES_KEY,applyStoredPreferences} from './persistence.js';

export const WORKSPACE_KEY='workspace';
const message=error=>error?.message||String(error);
const put=(key,value)=>({key,value});
const checked=raw=>prepareWorld(structuredClone(raw));

function checkMetadata(entries){
 const ids=new Set();
 for(const entry of entries){
  if(typeof entry?.id!=='string'||!entry.id||ids.has(entry.id)||typeof entry.name!=='string'||!Number.isInteger(entry.stage)||entry.stage<1||entry.stage>IMPLEMENTED)throw Error('Checkpoint library has invalid metadata');
  ids.add(entry.id);
 }
}

async function inspectLibrary(read){
 const index=await read('checkpoint-index');
 if(index===undefined)return {snapshots:[],changes:[]};
 if(!Array.isArray(index))throw Error('Checkpoint index is invalid');
 checkMetadata(index);
 return {snapshots:index,changes:[]};
}

export async function inspectStartup(read){
 const [saved,library]=await Promise.allSettled([read(WORKSPACE_KEY),inspectLibrary(read)]);
 const state={kind:'recovery',rawAvailable:saved.status==='fulfilled'&&saved.value!==undefined,raw:saved.status==='fulfilled'?saved.value:undefined,workspaceRead:saved.status==='fulfilled',library:library.status==='fulfilled'?library.value:null,world:null,errors:[]};
 if(saved.status==='rejected')state.errors.push(`Working world could not be read: ${message(saved.reason)}`);
 else if(state.rawAvailable){
  try{state.world=checked(state.raw);}catch(error){state.errors.push(`Working world could not be validated: ${message(error)}`);}
 }
 if(library.status==='rejected')state.errors.push(`Checkpoint library could not be read: ${message(library.reason)}`);
 return state;
}

export async function readRecoveryCheckpoint(read,state,id){
 if(!state.library?.snapshots.some(s=>s.id===id))throw Error('Checkpoint not found in the loaded library');
 const raw=await read(`checkpoint:${id}`);
 if(raw===undefined)throw Error('Checkpoint data unavailable');
 return checked(raw);
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
   if(state.rawAvailable){
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
   // The editor opens only once the replacement transaction commits.
   return finish(state,world,[...state.library.changes,put(WORKSPACE_KEY,world),{key:PREFERENCES_KEY,delete:true}]);
  }
 };
}
