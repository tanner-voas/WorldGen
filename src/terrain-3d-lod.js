/** Crack-free, tile-local index LOD for the existing shared terrain vertex grid.
 * No extra terrain sampling, no world mutation, and no duplicate GPU vertices.
 * Every tile keeps all vertices on its outer boundary even at coarse LOD,
 * so adjacent tiles always agree about their shared edge at any detail mix.
 */
export const TERRAIN_TILE_CELLS=32;
export const TERRAIN_LOD_STEPS=[1,2,4,8];

export function lodStepForDistance(distance){
 if(!Number.isFinite(distance)||distance<0)throw Error('Invalid LOD camera distance');
 return distance>18?8:distance>11?4:distance>5?2:1;
}

/** Hysteresis avoids oscillating between two triangle sets when a pinch
 * gesture hovers around an LOD threshold. New views still use exactly the
 * legacy distance thresholds; only subsequent transitions gain a margin. */
export function stableLodStepForDistance(distance,previousStep,margin=.12){
 const initial=lodStepForDistance(distance);
 if(!TERRAIN_LOD_STEPS.includes(previousStep))return initial;
 const thresholds={1:5,2:11,4:18};
 let step=previousStep;
 while(step<8&&distance>thresholds[step]*(1+margin))step*=2;
 while(step>1&&distance<thresholds[step/2]*(1-margin))step/=2;
 return step;
}

/** Prefix sum of excluded grid vertices. A coarse triangle must never bridge a
 * map-outline hole: when even one grid vertex inside its footprint is
 * excluded, preserve the original 1-cell triangles in that region. This also
 * guarantees identical terrain coverage for every LOD on shaped worlds. */
function outlineMask(cols,rows,inside){
 const stride=cols+2,prefix=new Uint32Array(stride*(rows+2));
 for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){
  const n=(inside[y*(cols+1)+x]===0)?1:0;
  const i=(y+1)*stride+x+1;
  prefix[i]=n+prefix[i-1]+prefix[i-stride]-prefix[i-stride-1];
 }
 return (x0,y0,x1,y1)=>{
  const l=x0,t=y0,r=x1+1,b=y1+1;
  return prefix[b*stride+r]-prefix[t*stride+r]-prefix[b*stride+l]+prefix[t*stride+l]>0;
 };
}

function tileDescriptors(cols,rows,tileSize){
 const tiles=[];
 for(let y0=0;y0<rows;y0+=tileSize)for(let x0=0;x0<cols;x0+=tileSize){
  const x1=Math.min(cols,x0+tileSize),y1=Math.min(rows,y0+tileSize);
  tiles.push({id:tiles.length,x0,y0,x1,y1});
 }
 return tiles;
}

/** Builds index buffers grouped by LOD, with byte-addressable per-tile draw ranges.
 * Coordinates in tile metadata match the existing 4.8-wide X/Z world plane.
 * This is intentionally independent of normals, material buffers and stage.
 */
export function buildAdaptiveTerrainLevels(cols,rows,inside,planeWidth,planeDepth,{tileSize=TERRAIN_TILE_CELLS}={}){
 if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<8||rows<8||
    cols%8||rows%8||!Number.isInteger(tileSize)||tileSize<8||tileSize%8||
    inside?.length!==(cols+1)*(rows+1)||!Number.isFinite(planeWidth)||!Number.isFinite(planeDepth)||planeWidth<=0||planeDepth<=0){
  throw Error('Invalid adaptive terrain grid');
 }
 const tiles=tileDescriptors(cols,rows,tileSize);
 const index=(x,y)=>y*(cols+1)+x;
 const crossesOutline=outlineMask(cols,rows,inside);
 const outlineCollar=(x,y)=>{const bx=Math.floor(x/8)*8,by=Math.floor(y/8)*8;return crossesOutline(bx,by,bx+8,by+8);};
 const levels=[];
 for(const step of TERRAIN_LOD_STEPS){
  const indices=[],ranges=[];
  for(const tile of tiles){
   const offset=indices.length;
   const triangle=(a,b,c)=>{
    if(inside[a]&&inside[b]&&inside[c]&&a!==b&&a!==c&&b!==c)indices.push(a,b,c);
   };
   for(let y=tile.y0;y<tile.y1;y+=step)for(let x=tile.x0;x<tile.x1;x+=step){
    const east=x+step,south=y+step;
    // Fine mesh: two upward-facing triangles per original grid square.
    if(step===1||outlineCollar(x,y)){
     // The fine path also handles partially clipped cells. Coarser masks
     // would otherwise drop the outline inward as the camera zooms out.
     for(let yy=y;yy<south;yy++)for(let xx=x;xx<east;xx++){
      triangle(index(xx,yy),index(xx,yy+1),index(xx+1,yy));
      triangle(index(xx+1,yy),index(xx,yy+1),index(xx+1,yy+1));
     }
     continue;
    }
    const onTop=y===tile.y0,onBottom=south===tile.y1;
    const onLeft=x===tile.x0,onRight=east===tile.x1;
    if(!onTop&&!onBottom&&!onLeft&&!onRight){
     triangle(index(x,y),index(x,south),index(east,y));
     triangle(index(east,y),index(x,south),index(east,south));
     continue;
    }
    // Transition squares preserve every boundary vertex at step=1, while
    // their inner edges stay coarse. The central fan fills the square exactly.
    const ring=[[x,y]];
    for(let xx=x+(onTop?1:step);xx<=east;xx+=onTop?1:step)ring.push([xx,y]);
    for(let yy=y+(onRight?1:step);yy<=south;yy+=onRight?1:step)ring.push([east,yy]);
    for(let xx=east-(onBottom?1:step);xx>=x;xx-=onBottom?1:step)ring.push([xx,south]);
    for(let yy=south-(onLeft?1:step);yy>y;yy-=onLeft?1:step)ring.push([x,yy]);
    const center=index(x+step/2,y+step/2);
    // Ring is clockwise in screen coordinates (Z increases downward).
    // Reverse its edges to keep face normals upward in the 3D frame.
    for(let k=0;k<ring.length;k++){
     const a=ring[k],b=ring[(k+1)%ring.length];
     triangle(center,index(b[0],b[1]),index(a[0],a[1]));
    }
   }
   const count=indices.length-offset;
   ranges.push({id:tile.id,offset,count,x0:tile.x0,y0:tile.y0,x1:tile.x1,y1:tile.y1,
    x:((tile.x0+tile.x1)/(2*cols)-.5)*planeWidth,
    z:((tile.y0+tile.y1)/(2*rows)-.5)*planeDepth});
  }
  levels.push({step,indices:new Uint32Array(indices),tiles:ranges});
 }
 return levels;
}

/** Choose detail for a tile based on camera position and its projected extent.
 * Subtracting a fraction of the tile footprint avoids prematurely lowering
 * detail when the camera is close to a large tile's edge.
 */
export function adaptiveTileLod(eye,tile,span=0,previousStep=null){
 const distance=Math.max(0,Math.hypot(eye[0]-tile.x,eye[1],eye[2]-tile.z)-Math.max(0,span)*.3);
 return stableLodStepForDistance(distance,previousStep);
}

/** One index buffer per global resolution for uniformly distant views.
 * Rendering the entire map with one draw avoids hundreds of tile draw calls;
 * mixed-detail views switch to crack-free tiled indices instead.
 */
export function buildUniformTerrainLevels(cols,rows,inside){
 const result=[];
 const index=(x,y)=>y*(cols+1)+x;
 const crossesOutline=outlineMask(cols,rows,inside);
 const outlineCollar=(x,y)=>{const bx=Math.floor(x/8)*8,by=Math.floor(y/8)*8;return crossesOutline(bx,by,bx+8,by+8);};
 for(const step of TERRAIN_LOD_STEPS){
  const indices=[];
  for(let y=0;y<rows;y+=step)for(let x=0;x<cols;x+=step){
   const a=index(x,y),b=index(x+step,y),c=index(x,y+step),d=index(x+step,y+step);
   if(step>1&&outlineCollar(x,y)){
    // The uniform far-view path must preserve the same shaped coastline as
    // the adaptive tiles; otherwise zooming changes the world's silhouette.
    for(let yy=y;yy<y+step;yy++)for(let xx=x;xx<x+step;xx++){
     const q=index(xx,yy),r=index(xx+1,yy),t=index(xx,yy+1),u=index(xx+1,yy+1);
     if(inside[q]&&inside[t]&&inside[r])indices.push(q,t,r);
     if(inside[r]&&inside[t]&&inside[u])indices.push(r,t,u);
    }
   }else{
    if(inside[a]&&inside[b]&&inside[c])indices.push(a,c,b);
    if(inside[b]&&inside[c]&&inside[d])indices.push(b,c,d);
   }
  }
  result.push({step,indices:new Uint32Array(indices)});
 }
 return result;
}

/** Conservative clip-space test for mixed-LOD draw calls. A tile is rejected
 * only when its entire height-bounded box lies outside one expanded frustum
 * plane. If it crosses the near plane (or the data is incomplete), it is kept
 * rather than risking a visible hole. Clip margin tolerates relief and camera
 * motion between frames without popping along the screen edge. */
export function tileVisibleInFrustum(camera,tile,surface,margin=1.18){
 if(!camera||camera.length!==16||!surface||!tile||
    !(Number.isFinite(tile.minY??surface.minY)&&Number.isFinite(tile.maxY??surface.maxY))||
    !Number.isFinite(surface.planeWidth)||!Number.isFinite(surface.planeDepth)||
    !Number.isFinite(surface.cols)||!Number.isFinite(surface.rows)||
    surface.cols<=0||surface.rows<=0)return true;
 const x0=(tile.x0/surface.cols-.5)*surface.planeWidth;
 const x1=(tile.x1/surface.cols-.5)*surface.planeWidth;
 const z0=(tile.y0/surface.rows-.5)*surface.planeDepth;
 const z1=(tile.y1/surface.rows-.5)*surface.planeDepth;
 const points=[];
 const minY=tile.minY??surface.minY,maxY=tile.maxY??surface.maxY;
 for(const x of [x0,x1])for(const y of [minY,maxY])for(const z of [z0,z1]){
  const clip=[camera[0]*x+camera[4]*y+camera[8]*z+camera[12],
   camera[1]*x+camera[5]*y+camera[9]*z+camera[13],
   camera[2]*x+camera[6]*y+camera[10]*z+camera[14],
   camera[3]*x+camera[7]*y+camera[11]*z+camera[15]];
  if(!clip.every(Number.isFinite)||clip[3]<=0)return true;
  points.push(clip);
 }
 return !(
  points.every(p=>p[0]<-p[3]*margin)||points.every(p=>p[0]>p[3]*margin)||
  points.every(p=>p[1]<-p[3]*margin)||points.every(p=>p[1]>p[3]*margin)||
  points.every(p=>p[2]>p[3]*margin)
 );
}
