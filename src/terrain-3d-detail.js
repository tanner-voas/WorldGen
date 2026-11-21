/** Camera-local terrain refinement. Only four tiles near the camera target
 * are expanded; the rest of the world retains its normal adaptive LOD.
 * No procedural sublayer or extra world data is generated.
 */
export const LOCAL_TERRAIN_SUBDIVISIONS=6;
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
   const inside=surface.insideMask,stride=cols+1;
   const probes=[[tile.x0,tile.y0],[tile.x1,tile.y0],[tile.x0,tile.y1],[tile.x1,tile.y1],
    [Math.floor((tile.x0+tile.x1)/2),Math.floor((tile.y0+tile.y1)/2)]];
   if(probes.some(([px,py])=>inside[py*stride+px]!==1))continue;
   candidates.push({id:tile.id,x0:tile.x0,y0:tile.y0,x1:tile.x1,y1:tile.y1});
  }
 return candidates.sort((a,b)=>a.id-b.id);
}
