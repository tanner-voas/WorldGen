/** River decals are clipped to individual base terrain triangles, then
 * projected onto their exact heights. The mask preserves the underlying
 * triangles through all terrain LODs and close-up refinement. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function clip(poly,distance){
 const out=[];
 if(!poly.length)return out;
 let a=poly.at(-1),da=distance(a);
 for(const b of poly){
  const db=distance(b),ai=da>=0,bi=db>=0;
  if(ai!==bi){const t=da/(da-db);out.push(a.map((v,i)=>v+(b[i]-v)*t));}
  if(bi)out.push(b);
  a=b;da=db;
 }
 return out;
}
function area2(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function unit(x,y){const n=Math.hypot(x,y)||1;return [x/n,y/n];}

export function createRiverProjector(grid,seaY=null){
 const {cols,rows,planeWidth,planeDepth,vertexData,insideMask}=grid,stride=cols+1;
 const mask=new Uint8Array(stride*(rows+1)),vertices=[];
 const height=id=>vertexData[id*7+1];
 function emit(triangle){
  const minX=clamp(Math.floor(Math.min(...triangle.map(p=>p[0]))),0,cols-1);
  const maxX=clamp(Math.floor(Math.max(...triangle.map(p=>p[0]))),0,cols-1);
  const minY=clamp(Math.floor(Math.min(...triangle.map(p=>p[1]))),0,rows-1);
  const maxY=clamp(Math.floor(Math.max(...triangle.map(p=>p[1]))),0,rows-1);
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   let square=clip(triangle,p=>p[0]-x);
   square=clip(square,p=>x+1-p[0]);square=clip(square,p=>p[1]-y);square=clip(square,p=>y+1-p[1]);
   if(square.length<3)continue;
   const a=y*stride+x,b=a+1,c=a+stride,d=c+1;
   for(const upper of [true,false]){
    const ids=upper?[a,b,c]:[d,c,b];
    if(ids.some(id=>!insideMask[id]))continue;
    let polygon=clip(square,p=>upper?x+y+1-p[0]-p[1]:p[0]+p[1]-x-y-1);
    if(polygon.length<3)continue;
    const h=p=>{const fx=p[0]-x,fy=p[1]-y;
     return upper?height(a)+(height(b)-height(a))*fx+(height(c)-height(a))*fy:
      height(d)+(height(c)-height(d))*(1-fx)+(height(b)-height(d))*(1-fy);};
    // Cut at the actual triangulated shoreline, not a guessed fraction.
    if(seaY!==null)polygon=clip(polygon,p=>h(p)-seaY);
    let emitted=false;
    for(let k=1;k+1<polygon.length;k++){
     const tri=[polygon[0],polygon[k],polygon[k+1]];
     if(Math.abs(area2(...tri))<1e-9)continue;
     for(const p of tri)vertices.push((p[0]/cols-.5)*planeWidth,h(p),(p[1]/rows-.5)*planeDepth);
     emitted=true;
    }
    if(emitted)mask[a]=mask[b]=mask[c]=mask[d]=1;
   }
  }
 }
 return {emit,finish(){return {rivers:new Float32Array(vertices),riverMask:vertices.length?mask:null};}};
}

/** Find the actual edge of the source Voronoi polygon lying on the
 * source/destination bisector. The midpoint between sites can belong to
 * a third cell (non-Gabriel Delaunay edges). Prefer the nearest point on
 * the shared edge, away from triple junctions. */
export function riverEdgeCrossing(a,b){
 const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
 const poly=a.poly||[],tol=Math.max(.0005,len*1e-6);
 let best=null,bestDist=Infinity;
 for(let k=0;k<poly.length;k+=2){
  const j=(k+2)%poly.length,x=poly[k],y=poly[k+1],u=poly[j],v=poly[j+1];
  if(Math.abs((x-mx)*dx+(y-my)*dy)>tol*len||Math.abs((u-mx)*dx+(v-my)*dy)>tol*len)continue;
  const ex=u-x,ey=v-y,ee=ex*ex+ey*ey;if(ee<1e-12)continue;
  const t=clamp(((mx-x)*ex+(my-y)*ey)/ee,.15,.85),p=[x+t*ex,y+t*ey];
  const d=Math.hypot(p[0]-mx,p[1]-my);if(d<bestDist){best=p;bestDist=d;}
 }
 return best||[mx,my];
}
function inConvex(cell,p){
 const poly=cell.poly||[];let sign=0;
 for(let k=0;k<poly.length;k+=2){
  const j=(k+2)%poly.length,d=area2([poly[k],poly[k+1]],[poly[j],poly[j+1]],p);
  if(Math.abs(d)<1e-8)continue;
  if(sign&&Math.sign(d)!==sign)return false;
  sign=Math.sign(d);
 }
 return true;
}
const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
function cubic(a,b,c,d,t){const u=1-t;return [u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]];}
function channelPath(a,b,shore){
 const start=[a.x,a.y],end=[b.x,b.y],cross=riverEdgeCrossing(a,b);
 if(shore)return t=>t<=.5?mix(start,cross,2*t):mix(cross,end,2*t-1);
 // The control points stay within their respective convex cells. Match
 // tangent direction at the crossing without leaving the drainage pair.
 const dir=unit(b.x-a.x,b.y-a.y);let p=cross,q=cross;
 let step=Math.min(Math.hypot(cross[0]-a.x,cross[1]-a.y),Math.hypot(cross[0]-b.x,cross[1]-b.y))*.4;
 for(let i=0;i<12;i++,step*=.5){
  const left=[cross[0]-dir[0]*step,cross[1]-dir[1]*step],right=[cross[0]+dir[0]*step,cross[1]+dir[1]*step];
  if(inConvex(a,left)&&inConvex(b,right)){p=left;q=right;break;}
 }
 return t=>t<=.5?cubic(start,mix(start,cross,.35),p,cross,2*t):cubic(cross,q,mix(end,cross,.35),end,2*t-1);
}

/** Joined, discharge-scaled ribbons along the saved drainage network. */
export function buildRiverDecals(geometry,mesh,hydrology,grid,{waterMask=null,seaY=null}={}){
 const {cells}=mesh,n=cells.length,{cols,rows,planeWidth}=grid;
 const projector=createRiverProjector(grid,waterMask?seaY:null);
 const scale=planeWidth/geometry.width,spacing=Math.sqrt((mesh.areaKm2||geometry.width*geometry.height)/n)*scale;
 const maxDischarge=Math.max(.001,Number(hydrology.summary?.maxDischarge)||.001);
 const halfWidth=i=>clamp(.001+spacing*(.014+.07*Math.sqrt(clamp((Number(hydrology.discharge[i])||0)/maxDischarge,0,1))),.001,Math.max(.001,Math.min(.02,spacing*.19)))/scale/2;
 const toGrid=(x,y)=>[x/geometry.width*cols,y/geometry.height*rows];
 const wet=i=>!!waterMask?.[i],lake=i=>hydrology.lakeId[i]>=0;
 const channels=new Set(hydrology.channels.filter(i=>Number.isInteger(i)&&i>=0&&i<n&&!wet(i)));
 const edges=[],joins=new Map();
 for(const i of channels){
  const j=hydrology.flowTo[i];
  if(!Number.isInteger(j)||j<0||j>=n||i===j||(lake(i)&&lake(j)))continue;
  edges.push([i,j]);
 }
 const register=(i,width)=>{if(!wet(i)&&!lake(i))joins.set(i,Math.max(joins.get(i)||0,width));};
 for(const [i,j] of edges){
  const a=cells[i],b=cells[j],len=Math.hypot(b.x-a.x,b.y-a.y);
  if(len<1e-9)continue;
  const fromWater=lake(i),toLake=lake(j),toOcean=wet(j);
  const path=channelPath(a,b,fromWater||toLake||toOcean);
  // Reach the shared lake shore, with small overlap beneath the water plane.
  // Ocean outlets extend through the wet site and are clipped by height.
  const overlap=Math.min(.18,Math.max(halfWidth(i),halfWidth(j))/len+Math.hypot(geometry.width/cols,geometry.height/rows)/len);
  const start=fromWater?Math.max(0,.5-overlap):0,end=toLake?Math.min(1,.5+overlap):1;
  const startWidth=halfWidth(i),endWidth=toOcean||toLake?startWidth:halfWidth(j);
  if(start===0)register(i,startWidth);if(end===1)register(j,endWidth);
  const crossing=path(.5),length=Math.hypot(crossing[0]-a.x,crossing[1]-a.y)+Math.hypot(crossing[0]-b.x,crossing[1]-b.y);
  const sections=clamp(Math.ceil(length*(end-start)/Math.min(geometry.width/cols,geometry.height/rows)*2),6,48);
  let prev=null;
  const times=Array.from({length:sections+1},(_,i)=>start+(end-start)*i/sections);
  if(start<.5&&end>.5&&!times.includes(.5)){times.push(.5);times.sort((a,b)=>a-b);}
  for(const t of times){
   const p=path(t),before=path(Math.max(0,t-.0001)),after=path(Math.min(1,t+.0001));
   const sideways=unit(before[1]-after[1],after[0]-before[0]),w=startWidth+(endWidth-startWidth)*t;
   const left=toGrid(p[0]-sideways[0]*w,p[1]-sideways[1]*w),right=toGrid(p[0]+sideways[0]*w,p[1]+sideways[1]*w);
   if(prev){projector.emit([prev[0],prev[1],left]);projector.emit([prev[1],right,left]);}
   prev=[left,right];
  }
 }
 // Round caps cover angular joins and tributary confluences without gaps.
 for(const [id,width] of joins){
  const {x,y}=cells[id],center=toGrid(x,y),sides=12;
  for(let k=0;k<sides;k++){
   const a=k*2*Math.PI/sides,b=(k+1)*2*Math.PI/sides;
   projector.emit([center,toGrid(x+Math.cos(a)*width,y+Math.sin(a)*width),toGrid(x+Math.cos(b)*width,y+Math.sin(b)*width)]);
  }
 }
 return projector.finish();
}

/** Zero refinement inside river-bearing squares; smooth transition outside. */
export function riverDetailFade(mask,cols,x,y,fx,fy){
 if(!mask)return 1;
 const a=y*(cols+1)+x,b=a+cols+1;
 const w=(mask[a]*(1-fx)+mask[a+1]*fx)*(1-fy)+(mask[b]*(1-fx)+mask[b+1]*fx)*fy;
 const t=clamp(1-w,0,1);return t*t*(3-2*t);
}
