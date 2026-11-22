/** Continuous, signed coastline constraint derived from the locked Voronoi
 * water mask. The nearest land/water distances are continuous functions;
 * their equality is exactly the shared Voronoi shoreline (up to stored site
 * rounding). No noisy or independent coastline is introduced. Two small
 * nearest-site trees avoid a full scan for every terrain vertex. */
export function siteTree(cells,ids,axis=0){
 if(!ids.length)return null;
 const key=axis?'y':'x';
 ids.sort((a,b)=>cells[a][key]-cells[b][key]||a-b);
 const middle=ids.length>>1;
 return {id:ids[middle],axis,left:siteTree(cells,ids.slice(0,middle),1-axis),
  right:siteTree(cells,ids.slice(middle+1),1-axis)};
}
export function nearest(cells,tree,x,y,accept=null){
 let id=-1,d2=Infinity;
 function visit(node){
  if(!node)return;
  const c=cells[node.id],dx=x-c.x,dy=y-c.y,d=dx*dx+dy*dy;
  if((!accept||accept(node.id))&&(d<d2||(d===d2&&node.id<id))){id=node.id;d2=d;}
  const delta=node.axis?dy:dx;
  visit(delta<0?node.left:node.right);
  if(delta*delta<=d2)visit(delta<0?node.right:node.left);
 }
 visit(tree);return {id,distance:Math.sqrt(d2)};
}
export function createCoastlineConstraint(mesh,elevations,waterMask,seaLevel=0){
 if(waterMask==null)return null; // Layer 4 has no locked coastline.
 const cells=mesh.cells,n=cells.length;
 if(waterMask.length!==n||elevations.length!==n||!Number.isFinite(seaLevel)||
    Array.from(waterMask).some(v=>v!==0&&v!==1&&v!==false&&v!==true))throw Error('Invalid 3D coastline mask');
 const land=[],water=[],depth=new Float64Array(n),mask=Uint8Array.from(waterMask);
 for(let i=0;i<n;i++){
  (mask[i]?water:land).push(i);
  // Legacy masks can contradict their raw elevation. Use a small positive
  // magnitude rather than reflecting such a point into a mountain/trench.
  depth[i]=Math.max(.002,(elevations[i]-seaLevel)*(mask[i]?-1:1));
 }
 const landTree=siteTree(cells,land),waterTree=siteTree(cells,water);
 const band=Math.sqrt((mesh.areaKm2||mesh.width*mesh.height)/n)*.65;
 return {seaLevel,mask,depth,at(x,y){
  const l=nearest(cells,landTree,x,y),w=nearest(cells,waterTree,x,y);
  const wet=w.distance<l.distance||(w.distance===l.distance&&w.id<l.id);
  const gap=Math.abs(l.distance-w.distance);
  const t=Math.min(1,gap/band);
  return {wet:wet?1:0,nearest:wet?w.id:l.id,fade:t*(2-t)};
 }};
}
