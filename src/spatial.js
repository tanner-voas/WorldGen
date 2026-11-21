/** A compact spatial bucket index for rendered Voronoi cell bounds.
 * Built once per mesh. It accelerates zoomed-in redraws and polygon picks
 * without altering the underlying geometry, cell IDs, or save format.
 */
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

export function buildCellIndex(mesh,bounds=null){
 const n=mesh.cells.length;
 const aspect=mesh.width/Math.max(mesh.height,1);
 const cols=clamp(Math.ceil(Math.sqrt(n*aspect)*.7),4,72);
 const rows=clamp(Math.ceil(Math.sqrt(n/aspect)*.7),4,72);
 const buckets=Array.from({length:cols*rows},()=>[]);
 const extents=bounds||mesh.cells.map(cell=>{
  const p=cell.poly;let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(let k=0;k<p.length;k+=2){x0=Math.min(x0,p[k]);y0=Math.min(y0,p[k+1]);x1=Math.max(x1,p[k]);y1=Math.max(y1,p[k+1]);}
  return [x0,y0,x1,y1];
 });
 const bucketX=x=>clamp(Math.floor(x/mesh.width*cols),0,cols-1);
 const bucketY=y=>clamp(Math.floor(y/mesh.height*rows),0,rows-1);
 for(let i=0;i<n;i++){
  const [x0,y0,x1,y1]=extents[i];
  for(let y=bucketY(y0);y<=bucketY(y1);y++)for(let x=bucketX(x0);x<=bucketX(x1);x++)buckets[y*cols+x].push(i);
 }
 return {mesh,bounds:extents,cols,rows,buckets,marks:new Uint32Array(n),serial:0};
}

/** Return only cells whose bounding boxes intersect the requested rectangle. */
export function cellsInBounds(index,x0,y0,x1,y1){
 const {mesh,cols,rows,buckets,bounds,marks}=index;
 if(x1<0||x0>mesh.width||y1<0||y0>mesh.height||x1<x0||y1<y0)return [];
 const bx0=clamp(Math.floor(x0/mesh.width*cols),0,cols-1),bx1=clamp(Math.floor(x1/mesh.width*cols),0,cols-1);
 const by0=clamp(Math.floor(y0/mesh.height*rows),0,rows-1),by1=clamp(Math.floor(y1/mesh.height*rows),0,rows-1);
 index.serial=(index.serial+1)>>>0;
 if(index.serial===0){marks.fill(0);index.serial=1;}
 const stamp=index.serial,result=[];
 for(let y=by0;y<=by1;y++)for(let x=bx0;x<=bx1;x++){
  for(const i of buckets[y*cols+x]){
   if(marks[i]===stamp)continue;
   marks[i]=stamp;
   const [a,b,c,d]=bounds[i];
   if(c>=x0&&a<=x1&&d>=y0&&b<=y1)result.push(i);
  }
 }
 return result;
}

/** Boundary-inclusive point in polygon, using the saved flat xy pairs. */
export function polygonContainsPoint(poly,x,y){
 let inside=false;
 for(let i=0,j=poly.length-2;i<poly.length;j=i,i+=2){
  const ax=poly[j],ay=poly[j+1],bx=poly[i],by=poly[i+1];
  const dx=bx-ax,dy=by-ay,cross=(x-ax)*dy-(y-ay)*dx;
  if(Math.abs(cross)<1e-8*Math.max(1,Math.abs(dx)+Math.abs(dy))&&x>=Math.min(ax,bx)-1e-7&&x<=Math.max(ax,bx)+1e-7&&y>=Math.min(ay,by)-1e-7&&y<=Math.max(ay,by)+1e-7)return true;
  if((ay>y)!==(by>y) && x<ax+(y-ay)*(dx/dy))inside=!inside;
 }
 return inside;
}

/** Cell lookup is normally O(nearby cells) instead of O(all sites). */
export function cellAtPoint(index,x,y){
 const candidates=cellsInBounds(index,x,y,x,y);
 let best=null,score=Infinity;
 for(const i of candidates){
  const c=index.mesh.cells[i];if(!polygonContainsPoint(c.poly,x,y))continue;
  const d=(x-c.x)**2+(y-c.y)**2;
  if(d<score){score=d;best=i;}
 }
 return best;
}
