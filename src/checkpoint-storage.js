// Read-modify-write the persisted index inside the same read/write transaction
// as the checkpoint payload. Never publish an optimistic in-memory index.
import {IMPLEMENTED} from './engine.js';
const INDEX='checkpoint-index';
function validateIndex(index){
 if(!Array.isArray(index))throw Error('Checkpoint index is invalid');
 const ids=new Set();
 for(const entry of index){
  if(typeof entry?.id!=='string'||!entry.id||ids.has(entry.id)||typeof entry.name!=='string'||!Number.isInteger(entry.stage)||entry.stage<1||entry.stage>IMPLEMENTED)throw Error('Checkpoint index has invalid metadata');
  ids.add(entry.id);
 }
}
export function checkpointChanges(index,operation){
 validateIndex(index);
 if(operation.kind==='save'){
  const {metadata,world}=operation;const next=[metadata,...index];validateIndex(next);
  if(!world)throw Error('Checkpoint data unavailable');
  return {index:next,changes:[{key:`checkpoint:${metadata.id}`,value:world},{key:INDEX,value:next}]};
 }
 if(operation.kind==='delete'){
  if(!index.some(entry=>entry.id===operation.id))throw Error('Checkpoint no longer exists');
  const next=index.filter(entry=>entry.id!==operation.id);
  return {index:next,changes:[{key:`checkpoint:${operation.id}`,delete:true},{key:INDEX,value:next}]};
 }
 throw Error('Unknown checkpoint operation');
}
export function commitCheckpoint(database,operation){
 return new Promise((resolve,reject)=>{
  const tx=database.transaction('data','readwrite'),store=tx.objectStore('data');let result,failure;
  tx.oncomplete=()=>resolve(result.index);
  tx.onabort=()=>reject(failure||tx.error||Error('Checkpoint transaction aborted'));
  function abort(error){failure=error;try{tx.abort();}catch{reject(error);}}
  function apply(index){
   try{
    result=checkpointChanges(index,operation);
    for(const change of result.changes){if(change.delete)store.delete(change.key);else store.put(change.value,change.key);}
   }catch(error){abort(error);}
  }
  try{
   const req=store.get(INDEX);
   req.onsuccess=()=>{
    if(req.result!==undefined){apply(req.result);return;}
    // Distinguish a truly absent index from a corrupt stored undefined value.
    try{const count=store.count(INDEX);count.onsuccess=()=>count.result===0?apply([]):abort(Error('Checkpoint index is undefined'));}catch(error){abort(error);}
   };
  }catch(error){abort(error);}
 });
}
