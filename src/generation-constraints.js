import {boundaryLandCapacity,landAreaFraction,DEFAULTS} from './engine.js';
import {REFERENCE_DISTANCE_KM} from './geographic-units.js';

// UI-side read-only diagnostics; each immutable mesh is examined once.
const capacityCache=new WeakMap();
function capacityFor(mesh){
 if(!capacityCache.has(mesh))capacityCache.set(mesh,boundaryLandCapacity(mesh));
 return capacityCache.get(mesh);
}
const pct=v=>v>0&&v<.00005?'less than 0.01%':v<1&&v>.99995?'more than 99.99%':`${+(v*100).toFixed(2)}%`;
const km=v=>`${+v.toFixed(2)} km`;
const EPS=1e-9;
export function geometryConstraintReport(geometry){
 if(!geometry)return null;
 const ratio=Math.max(geometry.width,geometry.height)/Math.min(geometry.width,geometry.height);
 if(ratio<10)return null;
 return {warning:true,messages:[`This world is ${+ratio.toFixed(1)}:1 in aspect ratio. A narrow world may have few interior polygons at coarse resolution; the protected ocean rim can cover most or all of it. Check the layer 2 mesh before locking it.`]};
}
export function meshConstraintReport(mesh){
 if(!mesh?.cells?.length)return null;
 const capacity=capacityFor(mesh),max=capacity.maxLandFraction;
 const warning=max<DEFAULTS[5].land-EPS;
 const messages=[`With the protected ocean rim enabled, ${capacity.protectedCount} of ${mesh.cells.length} polygons must be water. Maximum possible land area: ${pct(max)}.`];
 if(warning)messages.push(capacity.availableCount===0?'Every polygon touches the outer boundary. No land is possible with the rim enabled.':'The default land target cannot be reached with this mesh and the rim enabled.');
 if(warning)messages.push('Try a smaller average polygon area (more cells), a wider world, or disable Edge ocean bias at layer 5.');
 return {warning,messages};
}
/** A pending preview must never report previous output as the new result. */
export function coastConstraintReport(mesh,settings,data=null,{pending=false,historical=false}={}){
 if(!mesh?.cells?.length||!settings)return null;
 const target=Number(settings.land);
 if(!Number.isFinite(target))return null;
 const enabled=Number(settings.edgeOcean)>0;
 // Old locked results may predate this rim algorithm. Report their saved
 // geography, not a retroactively inferred maximum under new rules.
 const savedCoverage=data?.coverage;
 const validSavedCoverage=Number.isFinite(savedCoverage?.maxLandFraction)&&savedCoverage.maxLandFraction>=0&&savedCoverage.maxLandFraction<=1&&Number.isInteger(savedCoverage.availableCount)&&savedCoverage.availableCount>=0&&savedCoverage.availableCount<=mesh.cells.length&&Number.isInteger(data?.edgeWaterCells);
 const legacy=historical&&!validSavedCoverage;
 const capacity=legacy?null:historical&&validSavedCoverage?{...savedCoverage,protectedCount:data.edgeWaterCells}:enabled?capacityFor(mesh):{maxLandFraction:1,availableCount:mesh.cells.length,protectedCount:0};
 const max=capacity?.maxLandFraction??1;
 const messages=[];let warning=false;
 if(!legacy){
  messages.push(`Target: ${pct(target)} land area · ${historical?'Saved boundary limit':'Maximum with current boundary rule'}: ${pct(max)}${enabled?` (${capacity.protectedCount} protected water polygons)`:''}.`);
  if(enabled&&target>max+EPS){
   warning=true;
   messages.push(capacity.availableCount===0?'Every polygon touches the boundary. No land is possible while Edge ocean bias is enabled.':'The requested land coverage is impossible with the protected ocean rim on this mesh.');
   messages.push('Reduce average polygon area in layer 2, widen the world in layer 1, or set Edge ocean bias to zero (removes the guaranteed rim).');
   if(max>=.1)messages.push('You can also lower the land coverage target.');
  }
 }
 if(pending)messages.push('Waiting for a preview with these settings.');
 else if(data){
  const actual=landAreaFraction(mesh,data.water);
  if(actual!==null){
   messages.push(`Generated land area: ${pct(actual)}${legacy?` · Saved target: ${pct(target)}`:''}.`);
   const allWater=data.water.every(Boolean),allLand=data.water.every(v=>!v);
   if(allWater||allLand){warning=true;messages.push(allWater?'The generated world contains no land.':'The generated world contains no ocean.');}
   if(Math.abs(actual-target)>.005+EPS&&(legacy||target<=max+EPS)){
    warning=true;messages.push(legacy?'This historical result differs from its saved target.':'The target falls between available sea-level thresholds. Whole polygons and equal-height groups cannot be split; the closest achievable coverage is used.');
   }
  }
 }
 if(!historical){
  const shortSide=Math.min(mesh.width,mesh.height);
  const fade=Number(settings.edgeFade)*REFERENCE_DISTANCE_KM,retreat=Number(settings.setbackWidth)*REFERENCE_DISTANCE_KM;
  if(enabled&&fade>shortSide*.12+EPS)messages.push(`Edge falloff is capped by world size: ${km(shortSide*.12)} of ${km(fade)} requested.`);
  if(Number(settings.setbackStrength)>0&&retreat>shortSide*.16+EPS)messages.push(`Continental setback is capped by world size: ${km(shortSide*.16)} of ${km(retreat)} requested.`);
 }
 return {warning,messages};
}
