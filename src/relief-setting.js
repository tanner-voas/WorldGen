/** Vertical exaggeration is viewer-only, never written to world snapshots. */
export const RELIEF_MIN=.01,RELIEF_MAX=1000;
const KEY='worldgen:viewer:vertical-relief';
export function clampRelief(value){const n=Number(value);return Number.isFinite(n)?Math.max(RELIEF_MIN,Math.min(RELIEF_MAX,n)):1;}
export function formatRelief(value){const n=clampRelief(value);return `${Number(n.toPrecision(5))}×`;}
export function readReliefPreference(storage){
 try{const value=(storage??globalThis.sessionStorage)?.getItem(KEY);if(value===null||value===undefined)return 1;
  const n=Number(value);return Number.isFinite(n)&&n>=RELIEF_MIN&&n<=RELIEF_MAX?n:1;
 }catch{return 1;}
}
export function writeReliefPreference(value,storage){
 try{(storage??globalThis.sessionStorage)?.setItem(KEY,String(clampRelief(value)));}catch{/* Restricted storage is nonfatal. */}
}
