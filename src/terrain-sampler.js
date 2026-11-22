/** Shared spatial interpolation for the 3D terrain and environmental materials. */
const clamp01=x=>Math.max(0,Math.min(1,Number(x)||0));

/** Spatial hash of Voronoi sites for continuous terrain sampling.
 * Unlike owner-cell neighbor lists, nearby candidates depend only on their
 * distance from the terrain sample, so a polygon crossing cannot switch the
 * interpolation neighborhood abruptly. Compact-support weights go smoothly
 * to zero at the search radius, avoiding seams at bucket boundaries.
 */
export function createTerrainSampler(mesh,blend=0.72){
 const n=mesh.cells.length;
 const area=mesh.areaKm2||mesh.width*mesh.height;
 const spacing=Math.sqrt(area/Math.max(n,1));
 const radius=Math.max(1e-7,spacing*(1.7+clamp01(blend/1.25)*1.45));
 const cols=Math.max(1,Math.ceil(mesh.width/radius));
 const rows=Math.max(1,Math.ceil(mesh.height/radius));
 const dx=mesh.width/cols,dy=mesh.height/rows;
 const buckets=Array.from({length:cols*rows},()=>[]);
 for(let i=0;i<n;i++){
  const c=mesh.cells[i];
  const bx=Math.max(0,Math.min(cols-1,Math.floor(c.x/dx)));
  const by=Math.max(0,Math.min(rows-1,Math.floor(c.y/dy)));
  buckets[by*cols+bx].push(i);
 }
 return {mesh,buckets,cols,rows,dx,dy,radius,radius2:radius*radius};
}

/** Yields only sites inside the compact interpolation radius.
 * Fallback is supplied by caller for sparsely populated areas.
 */
export function visitTerrainSites(sampler,x,y,visitor){
 const {mesh,buckets,cols,rows,dx,dy,radius,radius2}=sampler;
 const x0=Math.max(0,Math.floor((x-radius)/dx));
 const x1=Math.min(cols-1,Math.floor((x+radius)/dx));
 const y0=Math.max(0,Math.floor((y-radius)/dy));
 const y1=Math.min(rows-1,Math.floor((y+radius)/dy));
 let count=0;
 for(let by=y0;by<=y1;by++)for(let bx=x0;bx<=x1;bx++){
  for(const i of buckets[by*cols+bx]){
   const c=mesh.cells[i],qx=x-c.x,qy=y-c.y,d2=qx*qx+qy*qy;
   if(d2>=radius2)continue;
   const t=1-d2/radius2;
   // Anchor isolated islands, lakes and summits at their own sites.
   const weight=t*t*t/Math.max(1e-8,d2/radius2);
   visitor(i,weight);
   count++;
  }
 }
 return count;
}

/** Exact nearest-site fallback for points outside the compact interpolation
 * radius. Search spatial-hash buckets in expanding rings; stop as soon as
 * every unvisited bucket is provably farther than the closest visited site.
 * This is especially important at the empty corners of circular/elliptical
 * maps, where scanning every polygon at every off-world grid vertex was slow.
 * Ties retain the lowest original site index, matching the previous scan. */
export function nearestTerrainSite(sampler,x,y){
 const {mesh,buckets,cols,rows,dx,dy}=sampler;
 if(!mesh.cells.length)return -1;
 const cx=Math.max(0,Math.min(cols-1,Math.floor(x/dx)));
 const cy=Math.max(0,Math.min(rows-1,Math.floor(y/dy)));
 let best=-1,bestDistance=Infinity;
 for(let ring=0;ring<Math.max(cols,rows);ring++){
  const x0=Math.max(0,cx-ring),x1=Math.min(cols-1,cx+ring);
  const y0=Math.max(0,cy-ring),y1=Math.min(rows-1,cy+ring);
  for(let by=y0;by<=y1;by++)for(let bx=x0;bx<=x1;bx++){
   if(Math.max(Math.abs(bx-cx),Math.abs(by-cy))!==ring)continue;
   for(const i of buckets[by*cols+bx]){
    const c=mesh.cells[i],distance=(c.x-x)**2+(c.y-y)**2;
    if(distance<bestDistance||(distance===bestDistance&&i<best)){
     bestDistance=distance;best=i;
    }
   }
  }
  const frontier=[];
  if(x0>0)frontier.push(x-x0*dx);
  if(x1<cols-1)frontier.push((x1+1)*dx-x);
  if(y0>0)frontier.push(y-y0*dy);
  if(y1<rows-1)frontier.push((y1+1)*dy-y);
  if(!frontier.length)break;
  const lowerBound=Math.max(0,Math.min(...frontier));
  if(best>=0&&bestDistance<lowerBound*lowerBound)break;
 }
 return best;
}
