/** Camera-local terrain refinement. Screen-space demand determines which
 * tiles are expanded; the rest of the world retains its normal adaptive LOD.
 * No procedural sublayer or extra world data is generated.
 */
// The legacy constant is retained for direct callers of the mesh builder.
export const LOCAL_TERRAIN_SUBDIVISIONS=6;
export const DETAIL_SUBDIVISIONS=[2,4,6,8];
export const DETAIL_TRIANGLE_BUDGET=262144;
export const DETAIL_CACHE_BYTE_BUDGET=16*1024*1024;
const PIXELS_PER_DETAIL_EDGE=8;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function closeUpCameraLimits(siteSpacing){
 if(!Number.isFinite(siteSpacing)||siteSpacing<=0)throw Error('Invalid polygon spacing');
 return {
  // At minimum zoom a single average Voronoi cell exceeds the viewport.
  minimumDistance:clamp(siteSpacing*.24,.008,.09),
  // Begin refining before individual coarse triangles become apparent.
  detailDistance:clamp(siteSpacing*3.6,.12,.48)
 };
}

export function focusedTerrainTiles(surface,target){
 if(!surface?.levels?.[0]?.tiles||!Array.isArray(target)||target.length!==3)return [];
 const {cols,rows,planeWidth,planeDepth}=surface;
 if(!cols||!rows||!planeWidth||!planeDepth)return [];
 const tiles=surface.levels[0].tiles;
 const tileSize=32,tileCols=Math.ceil(cols/tileSize),tileRows=Math.ceil(rows/tileSize);
 const gx=clamp((target[0]/planeWidth+.5)*cols,0,cols-1e-5);
 const gy=clamp((target[2]/planeDepth+.5)*rows,0,rows-1e-5);
 const tx=Math.floor(gx/tileSize),ty=Math.floor(gy/tileSize);
 const fractionX=gx/tileSize-tx,fractionY=gy/tileSize-ty;
 const candidates=[];
 for(const y of [ty,ty+(fractionY>=.5?1:-1)])
  for(const x of [tx,tx+(fractionX>=.5?1:-1)]){
   if(x<0||y<0||x>=tileCols||y>=tileRows)continue;
   const tile=tiles[y*tileCols+x];if(!tile||!tile.count)continue;
   // Partial-outline tiles need the original boundary triangulation.
   // The near edge of a circular/elliptical world remains stable rather
   // than being remeshed by a second clipping algorithm.
   if(!refinableTile(surface,tile))continue;
   candidates.push({id:tile.id,x0:tile.x0,y0:tile.y0,x1:tile.x1,y1:tile.y1});
  }
 return candidates.sort((a,b)=>a.id-b.id);
}

// Partially clipped tiles continue to use the existing base tessellation.
// Boundary-aware local refinement is a separate release.
function refinableTile(surface,tile){
 const inside=surface.insideMask,stride=surface.cols+1;
 if(!inside||!tile.count)return false;
 const probes=[[tile.x0,tile.y0],[tile.x1,tile.y0],[tile.x0,tile.y1],[tile.x1,tile.y1],
  [Math.floor((tile.x0+tile.x1)/2),Math.floor((tile.y0+tile.y1)/2)]];
 return probes.every(([x,y])=>inside[y*stride+x]===1);
}

/** Project a height-bounded tile, clipping its box edges at the near plane.
 * This avoids both division by negative W and spuriously picking tiles that
 * are completely behind the eye. The rectangle is a conservative coverage
 * estimate, not an occlusion query. All coordinates are framebuffer pixels. */
export function projectedTileFootprint(surface,tile,camera,width,height,heightMultiplier=1){
 if(!camera||camera.length!==16||!(width>0&&height>0)||!Number.isFinite(heightMultiplier)||heightMultiplier<=0)return null;
 const x0=(tile.x0/surface.cols-.5)*surface.planeWidth,x1=(tile.x1/surface.cols-.5)*surface.planeWidth;
 const z0=(tile.y0/surface.rows-.5)*surface.planeDepth,z1=(tile.y1/surface.rows-.5)*surface.planeDepth;
 const y0=(tile.minY??surface.minY)*heightMultiplier,y1=(tile.maxY??surface.maxY)*heightMultiplier;
 if(![x0,x1,z0,z1,y0,y1].every(Number.isFinite))return null;
 const corners=[];
 for(const x of [x0,x1])for(const y of [y0,y1])for(const z of [z0,z1]){
  corners.push([0,1,2,3].map(i=>camera[i]*x+camera[i+4]*y+camera[i+8]*z+camera[i+12]));
 }
 if(corners.some(p=>!p.every(Number.isFinite)))return null;
 // A small screen margin retains detail just outside the viewport during pans.
 const margin=1.10;
 for(const plane of [p=>p[0]+p[3]*margin,p=>p[3]*margin-p[0],p=>p[1]+p[3]*margin,p=>p[3]*margin-p[1],p=>p[3]-p[2]]){
  if(corners.every(p=>plane(p)<0))return null;
 }
 const near=p=>p[2]+p[3];
 const points=corners.filter(p=>near(p)>=0&&p[3]>0);
 for(let i=0;i<8;i++)for(const bit of [1,2,4]){
  const j=i^bit;if(j<=i)continue;
  const a=corners[i],b=corners[j],da=near(a),db=near(b);
  if((da<0)===(db<0))continue;
  const t=da/(da-db),p=a.map((v,k)=>v+(b[k]-v)*t);
  if(p[3]>0)points.push(p);
 }
 if(!points.length)return null;
 const xs=points.map(p=>(p[0]/p[3]+1)*width/2),ys=points.map(p=>(p[1]/p[3]+1)*height/2);
 const left=Math.min(...xs),right=Math.max(...xs),bottom=Math.min(...ys),top=Math.max(...ys);
 const paddedX=width*(margin-1)/2,paddedY=height*(margin-1)/2;
 const l=Math.max(-paddedX,left),r=Math.min(width+paddedX,right),b=Math.max(-paddedY,bottom),t=Math.min(height+paddedY,top);
 if(r<=l||t<=b)return null;
 const visibleWidth=Math.max(0,Math.min(width,right)-Math.max(0,left));
 const visibleHeight=Math.max(0,Math.min(height,top)-Math.max(0,bottom));
 const centerDistance=Math.hypot((clamp(width/2,l,r)-width/2)/width,(clamp(height/2,b,t)-height/2)/height);
 const coverage=visibleWidth*visibleHeight/(width*height);
 // The unclipped extent matters: a tile covering many screens can still
 // need its highest subdivision even when only a small fraction is visible.
 const pixelsPerCell=Math.max((right-left)/(tile.x1-tile.x0),(top-bottom)/(tile.y1-tile.y0));
 return {coverage,priority:(coverage+.01*(r-l)*(t-b)/(width*height))/(1+4*centerDistance),pixelsPerCell};
}

export function focusedTileTriangles(tile,subdivisions=tile.subdivisions){
 return 2*(tile.x1-tile.x0)*(tile.y1-tile.y0)*subdivisions**2;
}

/** First reserve a small mesh for visible candidates, then spend the remaining
 * budget on the most useful upgrades. Every plan is deterministic, bounded,
 * and preserves the base mesh for anything that does not fit. */
export function planFocusedTerrainTiles(surface,{camera,width,height,heightMultiplier=1,previous=new Map(),budget=DETAIL_TRIANGLE_BUDGET}={}){
 if(!surface?.levels?.[0]?.tiles||!Number.isFinite(budget)||budget<=0)return [];
 const candidates=[];
 for(const tile of surface.levels[0].tiles){
  if(!refinableTile(surface,tile))continue;
  const footprint=projectedTileFootprint(surface,tile,camera,width,height,heightMultiplier);
  if(!footprint)continue;
  const demand=footprint.pixelsPerCell/PIXELS_PER_DETAIL_EDGE;
  const old=previous.get(tile.id)||1;
  // Quantized detail with a 20% margin around the previous band's thresholds.
  // Inactive candidates must exceed the entry threshold before allocating.
  let desired=DETAIL_SUBDIVISIONS.includes(old)?old:1;
  const levels=[1,...DETAIL_SUBDIVISIONS];
  let index=levels.indexOf(desired);
  while(index<levels.length-1&&demand>levels[index]*(old===desired?1.2:1))index++;
  while(index>0&&demand<levels[index-1]*.8)index--;
  desired=levels[index];
  if(desired===1)continue;
  candidates.push({tile,desired,priority:footprint.priority});
 }
 candidates.sort((a,b)=>b.priority-a.priority||a.tile.id-b.tile.id);
 let remaining=Math.floor(budget),selected=[];
 for(const {tile,desired,priority} of candidates){
  const cost=focusedTileTriangles(tile,2);
  if(cost>remaining)continue;
  remaining-=cost;
  selected.push({id:tile.id,x0:tile.x0,y0:tile.y0,x1:tile.x1,y1:tile.y1,subdivisions:2,desired,priority});
 }
 // Diminishing returns favor coverage rather than concentrating all geometry
 // into the first tile. Near-center or large projected tiles still win ties.
 while(true){
  let best=null;
  for(const tile of selected){
   if(tile.subdivisions>=tile.desired)continue;
   const next=DETAIL_SUBDIVISIONS[DETAIL_SUBDIVISIONS.indexOf(tile.subdivisions)+1];
   const cost=focusedTileTriangles(tile,next)-focusedTileTriangles(tile);
   if(cost>remaining)continue;
   const benefit=tile.priority*(1/tile.subdivisions-1/next)/cost;
   if(!best||benefit>best.benefit)best={tile,next,cost,benefit};
  }
  if(!best)break;
  best.tile.subdivisions=best.next;remaining-=best.cost;
 }
 return selected.map(({desired,priority,...tile})=>tile).sort((a,b)=>a.id-b.id);
}
