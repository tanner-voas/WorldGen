/** Fixed calibration for formerly mesh-relative processes. The 42 km spacing
 * approximates the historical 1,200-cell default world, not the active mesh.
 * Existing numeric settings remain encoded as multiples of these units. */
export const REFERENCE_DISTANCE_KM=42;
export const REFERENCE_AREA_KM2=REFERENCE_DISTANCE_KM**2;
const units=new Map([['edgeFade',REFERENCE_DISTANCE_KM],['setbackWidth',REFERENCE_DISTANCE_KM],['riverThreshold',REFERENCE_AREA_KM2]]);
export const geographicParameterScale=key=>units.get(key)??1;
/** Convert a calibrated per-reference-distance loss to a local edge loss. */
export function distanceLoss(rate,distanceKm){
 return -Math.expm1(Math.log1p(-Math.max(0,Math.min(1-1e-12,rate)))*Math.max(0,distanceKm)/REFERENCE_DISTANCE_KM);
}
