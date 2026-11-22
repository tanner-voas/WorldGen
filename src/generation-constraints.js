// Diagnostics for currently supported generation settings only.
export function geometryConstraintReport(geometry){
 if(!geometry)return null;
 const ratio=Math.max(geometry.width,geometry.height)/Math.min(geometry.width,geometry.height);
 return ratio>=10?{warning:false,messages:[`World aspect ratio is ${+ratio.toFixed(1)}:1; highly elongated worlds can have narrow cells near the boundary.`]}:null;
}
export function meshConstraintReport(){
 // The Voronoi layer determines geometry, never land or ocean coverage.
 return null;
}
