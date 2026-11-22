import {geographicParameterScale} from './geographic-units.js';
/** Physical interpretation of the legacy, dimensionless elevation encoding.
 * Schema v2 intentionally retains existing numeric values and precision.
 * Climate has used 2.7 km/unit since its introduction; use that convention
 * everywhere so old climate, terrain and checkpoints require no migration.
 * Heights are relative to the selected datum (zero before coasts, saved sea
 * level afterward). Depths and differences never subtract the datum twice.
 */
export const ELEVATION_KM_PER_UNIT=2.7;
export const ELEVATION_METRES_PER_UNIT=ELEVATION_KM_PER_UNIT*1000;
export const elevationToKm=(value,datum=0)=>(value-datum)*ELEVATION_KM_PER_UNIT;
export const elevationToMetres=(value,datum=0)=>(value-datum)*ELEVATION_METRES_PER_UNIT;
export const metresToElevation=(metres,datum=0)=>metres/ELEVATION_METRES_PER_UNIT+datum;
export const physicalSlope=(rise,distanceKm)=>elevationToKm(rise)/distanceKm;
export const sedimentToKm3=volume=>elevationToKm(volume); // encoded height × km²

/** Parameter values stored in old saves remain in encoded units, but the
 * absolute height/depth controls are presented and edited in metres. */
const physicalParameters=new Set(['continentalHeight','lakeDepth']);
export const isPhysicalHeightParameter=key=>physicalParameters.has(key);
export const displayParameter=(key,value)=>isPhysicalHeightParameter(key)?elevationToMetres(value):value*geographicParameterScale(key);
export const storedParameter=(key,value)=>isPhysicalHeightParameter(key)?metresToElevation(value):value/geographicParameterScale(key);

/** Preserve the established v0.1.26 display profile independently of physics.
 * The legacy bounded visual scale is NOT the physical elevation conversion.
 * In model space, one horizontal scene unit has the same physical length as
 * one unexaggerated vertical scene unit. The optional relief button multiplies
 * only this visual profile, never the canonical elevation units. */
export function terrainVerticalScales(geometry){
 const extent=Math.max(geometry?.width||0,geometry?.height||0);
 if(!Number.isFinite(extent)||extent<=0)throw Error('Invalid terrain extent');
 const worldScale=4.8/extent;
 const physicalHeightScale=worldScale*ELEVATION_KM_PER_UNIT;
 const heightScale=Math.max(.004,Math.min(.24,worldScale*18));
 return {worldScale,physicalHeightScale,heightScale,baseExaggeration:heightScale/physicalHeightScale};
}
