import {geographicParameterScale} from './geographic-units.js';
/** Signed elevation encoding, consistently interpreted as 2.7 km/unit.
 * Height and depth are relative to the zero-altitude datum; differences
 * never subtract that datum twice.
 */
export const ELEVATION_KM_PER_UNIT=2.7;
export const ELEVATION_METRES_PER_UNIT=ELEVATION_KM_PER_UNIT*1000;
export const elevationToKm=(value,datum=0)=>(value-datum)*ELEVATION_KM_PER_UNIT;
export const elevationToMetres=(value,datum=0)=>(value-datum)*ELEVATION_METRES_PER_UNIT;
export const metresToElevation=(metres,datum=0)=>metres/ELEVATION_METRES_PER_UNIT+datum;
export const physicalSlope=(rise,distanceKm)=>elevationToKm(rise)/distanceKm;
export const sedimentToKm3=volume=>elevationToKm(volume); // encoded height × km²

/** Height/depth settings are shown in metres but stored as elevation units. */
const physicalParameters=new Set(['oceanOffset','lakeDepth']);
export const isPhysicalHeightParameter=key=>physicalParameters.has(key);
export const displayParameter=(key,value)=>isPhysicalHeightParameter(key)?elevationToMetres(value):value*geographicParameterScale(key);
export const storedParameter=(key,value)=>isPhysicalHeightParameter(key)?metresToElevation(value):value/geographicParameterScale(key);

/** Bound the visual exaggeration separately from the physical height scale.
 * Relief adjustments affect only the 3D viewer, not saved elevation. */
export function terrainVerticalScales(geometry){
 const extent=Math.max(geometry?.width||0,geometry?.height||0);
 if(!Number.isFinite(extent)||extent<=0)throw Error('Invalid terrain extent');
 const worldScale=4.8/extent;
 const physicalHeightScale=worldScale*ELEVATION_KM_PER_UNIT;
 const heightScale=Math.max(.004,Math.min(.24,worldScale*18));
 return {worldScale,physicalHeightScale,heightScale,baseExaggeration:heightScale/physicalHeightScale};
}
