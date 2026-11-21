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
    if(step===1){
     triangle(index(x,y),index(x,south),index(east,y));
     triangle(index(east,y),index(x,south),index(east,south));
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
export function adaptiveTileLod(eye,tile,span=0){
 const distance=Math.max(0,Math.hypot(eye[0]-tile.x,eye[1],eye[2]-tile.z)-Math.max(0,span)*.3);
 return lodStepForDistance(distance);
}

/** One index buffer per global resolution for uniformly distant views.
 * Rendering the entire map with one draw avoids hundreds of tile draw calls;
 * mixed-detail views switch to crack-free tiled indices instead.
 */
export function buildUniformTerrainLevels(cols,rows,inside){
 const result=[];
 const index=(x,y)=>y*(cols+1)+x;
 for(const step of TERRAIN_LOD_STEPS){
  const indices=[];
  for(let y=0;y<rows;y+=step)for(let x=0;x<cols;x+=step){
   const a=index(x,y),b=index(x+step,y),c=index(x,y+step),d=index(x+step,y+step);
   if(inside[a]&&inside[b]&&inside[c])indices.push(a,c,b);
   if(inside[b]&&inside[c]&&inside[d])indices.push(b,c,d);
  }
  result.push({step,indices:new Uint32Array(indices)});
 }
 return result;
}
