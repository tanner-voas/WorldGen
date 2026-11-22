/** Horizontal bounds for consecutive groups of immutable triangles. Height
 * is intentionally excluded: relief and geomorphs change Y, never X/Z.
 * These small worker-built arrays let exact ray picking skip whole groups. */
export const PICK_BLOCK_TRIANGLES=64;
export const PICK_BLOCK_INDICES=PICK_BLOCK_TRIANGLES*3;
export function buildPickBounds(vertices,indices=null,stride=7){
 const count=indices?.length??vertices.length/stride;
 const bounds=new Float32Array(Math.ceil(count/PICK_BLOCK_INDICES)*4);
 for(let start=0;start<count;start+=PICK_BLOCK_INDICES){
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for(let i=start;i<Math.min(count,start+PICK_BLOCK_INDICES);i++){
   const offset=(indices?indices[i]:i)*stride,x=vertices[offset],z=vertices[offset+2];
   minX=Math.min(minX,x);minZ=Math.min(minZ,z);maxX=Math.max(maxX,x);maxZ=Math.max(maxZ,z);
  }
  bounds.set([minX,minZ,maxX,maxZ],start/PICK_BLOCK_INDICES*4);
 }
 return bounds;
}
/** Conservative horizontal ray/box test, clipped to the visible ray range.
 * Use the same tolerance as individual triangle rejection. */
export function pickBlockIntersects(bounds,offset,eye,ray,near,far){
 // Triangle barycentric tolerance can admit points just outside a long edge.
 const epsilon=1e-7+1e-6*Math.max(bounds[offset+2]-bounds[offset],bounds[offset+3]-bounds[offset+1]);
 for(let axis=0;axis<2;axis++){
  const component=axis*2,o=eye[component],d=ray[component];
  const low=bounds[offset+axis]-epsilon,high=bounds[offset+axis+2]+epsilon;
  if(d===0){if(o<low||o>high)return false;continue;}
  const a=(low-o)/d,b=(high-o)/d;
  near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));
  if(near>far)return false;
 }
 return true;
}
