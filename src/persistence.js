// Keep interface-only saves small while retaining self-contained world exports.
// A preferences record applies only to the exact saved revision it belongs to.
import {IMPLEMENTED} from './engine.js';

export const PREFERENCES_KEY='workspace-preferences';
const booleanKeys=['showEdges','showPlateBorders','showCoastBorders','showFlow','exploreMode'];
const modes=new Set('auto natural geometry plates height coast landforms erosion flow temperature rain moisture seasonality january july hydrology catchment watersheds soils soilDepth soilFertility soilPermeability soilGroundwater soilErosion biomes productivity treePotential waterStress growingSeason ecotones vegetation canopyCover groundCover biomass habitatComplexity habitats riparian'.split(' '));
const validViewport=v=>v&&Number.isFinite(v.scale)&&v.scale>0&&Number.isFinite(v.centerX)&&Number.isFinite(v.centerY);
export function preferenceRecord(world){
 const values={viewStage:world.viewStage,viewMode:world.viewMode};
 for(const key of booleanKeys)values[key]=world[key];
 if(validViewport(world.viewport))values.viewport={scale:world.viewport.scale,centerX:world.viewport.centerX,centerY:world.viewport.centerY};
 return {worldId:world.id,worldUpdated:world.updated,values};
}
export function applyStoredPreferences(world,record){
 if(!record||typeof world.id!=='string'||typeof world.updated!=='string'||record.worldId!==world.id||record.worldUpdated!==world.updated)return world;
 const v=record.values;
 if(!v||typeof v!=='object')return world;
 if(Number.isInteger(v.viewStage)&&v.viewStage>=1&&v.viewStage<=Math.min(IMPLEMENTED,world.working.stage))world.viewStage=v.viewStage;
 if(modes.has(v.viewMode))world.viewMode=v.viewMode;
 for(const key of booleanKeys)if(typeof v[key]==='boolean')world[key]=v[key];
 if(validViewport(v.viewport))world.viewport={scale:v.viewport.scale,centerX:v.viewport.centerX,centerY:v.viewport.centerY};
 return world;
}

// One writer, at most one full snapshot in flight. Changes arriving during a
// transaction are coalesced and saved afterwards; failures retain dirty flags.
// No idle flush, page hide, or preference adjustment clones the world.
export function createAutosave({getWorld,commit,onStatus=()=>{},delay=260,schedule=setTimeout,cancel=clearTimeout}){
 let worldDirty=false,prefsDirty=false,running=null,timer=null,status='saved',lastStamp=0;
 function report(next,error){if(next!==status||error){status=next;onStatus(next,error);}}
 function clearTimer(){if(timer!==null){cancel(timer);timer=null;}}
 function mark(kind='world',wait=delay){
  if(kind==='world')worldDirty=true;else if(kind==='preferences')prefsDirty=true;else throw Error('Unknown save kind');
  if(running)return;
  report('pending');
  // Pan/zoom must not keep postponing an already pending world write.
  if(kind==='preferences'&&worldDirty&&timer!==null)return;
  clearTimer();timer=schedule(()=>{timer=null;void flush();},worldDirty?Math.min(wait,delay):wait);
 }
 async function drain(){
  while(worldDirty||prefsDirty){
   const full=worldDirty,preferences=prefsDirty;worldDirty=prefsDirty=false;let attemptedFull=full;
   try{
    const world=getWorld();
    if(full||typeof world.id!=='string'||!world.id||typeof world.updated!=='string'){
     attemptedFull=true;
     // Keep the embedded preferences for JSON exports and older app builds.
     // Delete the sidecar in the same transaction, including on world switches.
     if(typeof world.id!=='string'||!world.id)world.id=`world-${Date.now()}-${Math.random().toString(36).slice(2)}`;
     lastStamp=Math.max(Date.now(),lastStamp+1);
     if(new Date(lastStamp).toISOString()===world.updated)lastStamp++;
     world.updated=new Date(lastStamp).toISOString();
     await commit([{key:'workspace',value:structuredClone(world)},{key:PREFERENCES_KEY,delete:true}]);
    }else await commit([{key:PREFERENCES_KEY,value:preferenceRecord(world)}]);
   }catch(error){
    // A failed full write must be retried as a full write, even if triggered
    // by a preference-only change (e.g. an old save without an ID).
    worldDirty=worldDirty||attemptedFull;
    prefsDirty=prefsDirty||preferences;clearTimer();running=null;report('error',error);return false;
   }
  }
  clearTimer();running=null;report('saved');return true;
 }
 function flush(){
  clearTimer();if(running)return running;
  if(!worldDirty&&!prefsDirty)return Promise.resolve(true);
  const operation=Promise.resolve().then(drain);running=operation;
  report('saving');return operation;
 }
 return {mark,flush,get status(){return status;}};
}
