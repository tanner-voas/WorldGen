/** Refine the actual base-mesh footprint, not a second analytic outline. */
import {insideGeometry} from './engine.js';

export function createFocusedOutline(geometry,grid,area){
 const {cols,rows,insideMask}=grid,{x0,y0,x1,y1}=area;
 if(insideMask&&insideMask.length!==(cols+1)*(rows+1))throw Error('Invalid terrain outline mask');
 if(!insideMask&&geometry.shape==='rectangle')return null;
 const inside=(x,y)=>insideMask?!!insideMask[y*(cols+1)+x]:insideGeometry(geometry.width*x/cols,geometry.height*y/rows,geometry);
 const bits=(x,y)=>{
  if(x<0||x>=cols||y<0||y>=rows)return 0;
  const a=inside(x,y),b=inside(x+1,y),c=inside(x,y+1),d=inside(x+1,y+1);
  return (a&&b&&c?1:0)|(b&&c&&d?2:0);
 };
 // One-cell halo makes the fade consistent across neighboring tiles.
 const left=Math.max(0,x0-1),top=Math.max(0,y0-1),right=Math.min(cols,x1+1),bottom=Math.min(rows,y1+1);
 const width=right-left,flags=new Uint8Array(width*(bottom-top));
 let clipped=false;
 for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
  const flag=bits(x,y);flags[(y-top)*width+x-left]=flag;
  if(flag!==3)clipped=true;
 }
 if(!clipped)return null;
 const edges=new Array(flags.length);
 for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
  const idx=(y-top)*width+x-left,flag=flags[idx];
  if(!flag)continue;
  const segments=[];
  if(flag&1){
   if(!(bits(x-1,y)&2))segments.push([x,y,x,y+1]);
   if(!(bits(x,y-1)&2))segments.push([x,y,x+1,y]);
  }
  if(flag&2){
   if(!(bits(x+1,y)&1))segments.push([x+1,y,x+1,y+1]);
   if(!(bits(x,y+1)&1))segments.push([x,y+1,x+1,y+1]);
  }
  if(flag!==3)segments.push([x+1,y,x,y+1]);
  if(segments.length)edges[idx]=segments;
 }
 return {
  triangleMask(x,y){return flags[(y-top)*width+x-left];},
  // Preserve outline heights while smoothly refining the interior.
  fade(x,y){
   let d2=1;
   for(let yy=Math.max(top,Math.floor(y)-1);yy<Math.min(bottom,Math.floor(y)+2);yy++)
    for(let xx=Math.max(left,Math.floor(x)-1);xx<Math.min(right,Math.floor(x)+2);xx++){
     const segments=edges[(yy-top)*width+xx-left];
     if(!segments)continue;
     for(const [ax,ay,bx,by] of segments){
      const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));
      d2=Math.min(d2,(x-ax-t*dx)**2+(y-ay-t*dy)**2);
     }
    }
   const d=Math.sqrt(d2);return d*d*(3-2*d);
  }
 };
}

/** Each fine triangle lies wholly inside one parent triangle. Their shared
 * diagonal is B-C, so even odd integer subdivisions preserve its footprint. */
export function appendFocusedOutlineIndices(indices,outline,area,n){
 const {x0,y0,x1,y1}=area,nx=(x1-x0)*n,ny=(y1-y0)*n,stride=nx+1;
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const flag=outline?outline.triangleMask(x0+Math.floor(i/n),y0+Math.floor(j/n)):3;
  const a=j*stride+i,b=a+1,c=a+stride,d=c+1,sum=i%n+j%n;
  if(flag&(sum<n?1:2))indices.push(a,c,b);
  if(flag&(sum<n-1?1:2))indices.push(b,c,d);
 }
}
