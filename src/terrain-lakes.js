/** Read-only freshwater basin constraints. All distances are in world km;
 * elevations remain in the saved units. A lake owns the Voronoi footprint
 * of its recorded member cells, not an independently generated depression. */
import {siteTree,nearest} from './terrain-coastline.js';

export function createLakeConstraint(mesh,elevations,hydrology,seaLevel=0,waterMask=null){
 if(!hydrology?.lakes?.length)return null;
 const cells=mesh.cells,n=cells.length;
 if(hydrology.lakeId?.length!==n)throw Error('Invalid 3D lake membership');
 const membership=new Int32Array(n).fill(-1),levels=[],wet=[],dry=[];
 for(const lake of hydrology.lakes){
  if(!lake||!Number.isFinite(lake.level)||!Array.isArray(lake.cells))continue;
  const id=levels.length;levels.push(lake.level);
  for(const i of lake.cells){
   if(Number.isInteger(i)&&i>=0&&i<n&&hydrology.lakeId[i]===lake.id&&!waterMask?.[i])membership[i]=id;
  }
 }
 for(let i=0;i<n;i++)(membership[i]>=0?wet:dry).push(i);
 if(!wet.length)return null;
 const depth=new Float64Array(n);
 for(const i of wet)depth[i]=Math.max(.0001,levels[membership[i]]-elevations[i],Number(hydrology.lakeDepth?.[i])||0);
 const wetTree=siteTree(cells,wet),dryTree=siteTree(cells,dry);
 const band=Math.sqrt((mesh.areaKm2||mesh.width*mesh.height)/n)*.65;
 const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
 return {at(x,y){
  const w=nearest(cells,wetTree,x,y),d=nearest(cells,dryTree,x,y);
  const inside=w.distance<d.distance||(w.distance===d.distance&&w.id<d.id);
  const id=membership[w.id],level=levels[id];
  // Adjacent lakes may be at different spill elevations. Keep membership
  // separate; only same-lake sites contribute to its basin depth.
  const other=inside&&levels.length>1?nearest(cells,wetTree,x,y,i=>membership[i]!==id):null;
  const edge=Math.abs((inside?Math.min(d.distance,other?.distance??Infinity):d.distance)-w.distance);
  return {inside,id,level,nearest:w.id,fade:smooth(edge/band),near:inside||edge<band};
 },membership,levels,depth,apply(side,height,coastSide,localDepth){
  if(!side.near||coastSide?.wet)return height;
  const {inside,level,nearest:id,fade}=side;
  if(inside){
   // The old blend could fill a deep basin with surrounding high terrain.
   // Cap it by the local saved depth and taper back to the spill level.
   const bottom=Math.min(height,level-(localDepth??depth[id]));
   const floor=waterMask&&level>seaLevel?seaLevel+Math.min(.00001,(level-seaLevel)*.25):-Infinity;
   return Math.max(floor,level+(bottom-level)*fade);
  }
  // Join dry banks to the water surface without raising terrain far away
  // or moving the locked ocean shoreline. The water mesh stays within the
  // recorded lake polygons even where a neighboring dry basin is lower.
  const coastalFade=coastSide?.fade??1;
  // At a freshwater shore the bank reaches the lake level even if the
  // ocean transition band overlaps it; at the ocean shore it stays at sea
  // level. The two distance fades avoid a jump at an inland lake boundary.
  const coastWeight=coastalFade>0?coastalFade/(coastalFade+(1-coastalFade)*fade):0;
  const weight=(1-fade)*coastWeight;
  return height+(level-height)*weight;
 }};
}
