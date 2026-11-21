/** 3D terrain surface derived from a selected generation stage. This is derived rendering data, never saved to the
 * world or used as an input to subsequent generation layers.
 * Coordinate frame: X east, Y up (render-only), Z south.
 */
import {insideGeometry} from './engine.js';
import {createTerrainSampler,visitTerrainSites} from './render.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const ELEVATION_RENDER_STAGE=4;

/** Select the actual saved terrain field for a historical generation stage.
 * Later environmental layers reuse the locked erosion terrain; they do not
 * silently incorporate climate, water or vegetation into the 3D material.
 * This is a read-only selection: it never rewrites saved layer records.
 */
export function selectTerrainSource(stage,getLayer){
 const selected=Number(stage);
 if(!Number.isInteger(selected)||selected<ELEVATION_RENDER_STAGE)throw Error('Elevation has not been generated');
 const names={4:'Elevation',5:'Oceans & coasts',6:'Landforms',7:'Erosion'};
 let terrainStage=selected>=7?7:selected;
 let record=getLayer(terrainStage);
 // Pre-v0.1.5 coast records stored a water mask and threshold but not an
 // adjusted elevation array. Their layer-4 heights remain the valid fallback.
 const legacyCoast=terrainStage===5&&!record?.elevations;
 if(legacyCoast){terrainStage=4;record=getLayer(4);}
 if(!record?.elevations)throw Error(`Layer ${terrainStage} terrain is unavailable`);
 const coast=selected>=5?getLayer(5):null;
 if(selected>=5&&(!coast||!Number.isFinite(coast.seaLevel)))throw Error('Coastline sea level is unavailable');
 return {elevations:record.elevations,seaLevel:coast?.seaLevel??0,terrainStage,
  label:legacyCoast?'Elevation with legacy coast level':names[terrainStage],
  hasCoast:selected>=5,usesEarlierTerrain:selected>7||legacyCoast};
}

export function terrainGridSize(geometry,cellCount){
 const ratio=geometry.width/geometry.height;
 const longest=clamp(Math.round(Math.sqrt(cellCount)*4.25),160,320);
 const segmentsX=Math.max(32,Math.ceil((ratio>=1?longest:longest*ratio)/8)*8);
 const segmentsY=Math.max(32,Math.ceil((ratio<=1?longest:longest/ratio)/8)*8);
 return {segmentsX,segmentsY};
}

/** Compact-support interpolant. Source elevations remain untouched and no
 * tessellation edges are ever used as a color or height discontinuity. */
export function sampleElevation(sampler,elevations,x,y){
 let total=0,weighted=0;
 const found=visitTerrainSites(sampler,x,y,(i,weight)=>{
  total+=weight;weighted+=Number(elevations[i])*weight;
 });
 if(found>0&&total>1e-15)return weighted/total;
 // Sparse samples are only expected near the outer geometry boundary.
 let closest=Infinity,best=0;
 for(let i=0;i<sampler.mesh.cells.length;i++){
  const c=sampler.mesh.cells[i],d=(c.x-x)**2+(c.y-y)**2;
  if(d<closest){closest=d;best=i;}
 }
 return Number(elevations[best]);
}

/** Generate narrow curved 3D water ribbons and level lake surfaces directly from
 * the locked drainage graph. Geometry is transient and read-only: the saved
 * hydrology and elevation arrays are never modified. All positions use the
 * same normalized X/Z coordinate frame as the terrain mesh. */
export function buildHydrologySurface(geometry,mesh,elevations,hydrology,options={}){
 const empty=()=>({rivers:new Float32Array(0),lakes:new Float32Array(0),riverSegments:0,lakeCells:0});
 if(!hydrology)return empty();
 const n=mesh?.cells?.length||0;
 if(!n||elevations?.length!==n||hydrology.flowTo?.length!==n||hydrology.discharge?.length!==n||
   hydrology.lakeId?.length!==n||!Array.isArray(hydrology.channels)||!Array.isArray(hydrology.lakes)){
  throw Error('3D hydrology source does not match the terrain mesh');
 }
 const scale=Number(options.worldScale)||4.8/Math.max(geometry.width,geometry.height);
 const sx=geometry.width*scale,sz=geometry.height*scale;
 const sampler=createTerrainSampler(mesh,.72),rivers=[],lakes=[];
 const maxDischarge=Math.max(.001,Number(hydrology.summary?.maxDischarge)||.001);
 const pixelSpacing=Math.sqrt((mesh.areaKm2||geometry.width*geometry.height)/n)*scale;
 const toX=x=>(x/geometry.width-.5)*sx,toZ=z=>(z/geometry.height-.5)*sz;
 const centerHeight=(x,y)=>sampleElevation(sampler,elevations,x,y)*.73;
 const point=(x,y,relativeOffset=.012)=>[toX(x),centerHeight(x,y)+relativeOffset,toZ(y)];
 const addTriangle=(target,a,b,c)=>target.push(...a,...b,...c);
 const keep=new Set(hydrology.channels.filter(i=>Number.isInteger(i)&&i>=0&&i<n));
 const incoming=new Int32Array(n).fill(-1);
 // Only the strongest tributary continues the channel tangent through a
 // confluence. Other rivers terminate cleanly at the meeting point.
 for(const i of keep){const j=hydrology.flowTo[i];if(!Number.isInteger(j)||j<0||j>=n)continue;
  if(incoming[j]<0||hydrology.discharge[i]>hydrology.discharge[incoming[j]])incoming[j]=i;
 }
 let riverSegments=0;
 for(const i of keep){
  const j=hydrology.flowTo[i];
  if(!Number.isInteger(j)||j<0||j>=n||i===j||hydrology.lakeId[i]>=0)continue;
  const a=mesh.cells[i],b=mesh.cells[j];
  const ocean=options.waterMask?.[j]===1||options.waterMask?.[j]===true;
  const inlet=hydrology.lakeId[j]>=0;
  // Rivers terminate at the approximate sea/lake edge; do not draw
  // glowing paths through open water.
  const endFrac=(ocean||inlet)?0.66:1;
  const len=Math.hypot(b.x-a.x,b.y-a.y);
  if(len<1e-7)continue;
  const upstream=mesh.cells[incoming[i]];
  const downstream=mesh.cells[hydrology.flowTo[j]];
  const startDirection=upstream?[b.x-upstream.x,b.y-upstream.y]:[b.x-a.x,b.y-a.y];
  const endDirection=downstream?[downstream.x-a.x,downstream.y-a.y]:[b.x-a.x,b.y-a.y];
  const normal=(v)=>{const m=Math.hypot(v[0],v[1])||1;return [v[0]/m,v[1]/m];};
  const [tx0,tz0]=normal(startDirection),[tx1,tz1]=normal(endDirection);
  const bend=.7*len;
  const sections=5;
  const flow=clamp(Math.sqrt(Math.max(0,Number(hydrology.discharge[i]))/maxDischarge),0,1);
  const width=clamp(.006+pixelSpacing*(.035+.12*flow),.006,Math.min(.045,pixelSpacing*.34));
  let previous=null;
  for(let s=0;s<=sections;s++){
   const t=(s/sections)*endFrac,t2=t*t,t3=t2*t;
   // Cubic Hermite path: the end tangents align with the downstream
   // network but the endpoints remain anchored to the original graph.
   const h00=2*t3-3*t2+1,h10=t3-2*t2+t,h01=-2*t3+3*t2,h11=t3-t2;
   const x=h00*a.x+h10*tx0*bend+h01*b.x+h11*tx1*bend;
   const y=h00*a.y+h10*tz0*bend+h01*b.y+h11*tz1*bend;
   const eps=.0005,tt=Math.min(endFrac,t+eps),ta=Math.max(0,t-eps);
   const evaluate=ttt=>{const q=ttt*ttt,q3=q*ttt;return [
    (2*q3-3*q+1)*a.x+(q3-2*q+ttt)*tx0*bend+(-2*q3+3*q)*b.x+(q3-q)*tx1*bend,
    (2*q3-3*q+1)*a.y+(q3-2*q+ttt)*tz0*bend+(-2*q3+3*q)*b.y+(q3-q)*tz1*bend];};
   const before=evaluate(ta),after=evaluate(tt);
   const ddx=after[0]-before[0],ddy=after[1]-before[1],mag=Math.hypot(ddx,ddy)||1;
   const sideways=[-ddy/mag,ddx/mag],half=width/scale/2;
   const left=point(x-sideways[0]*half,y-sideways[1]*half,.018);
   const right=point(x+sideways[0]*half,y+sideways[1]*half,.018);
   if(previous){addTriangle(rivers,previous[0],previous[1],left);addTriangle(rivers,previous[1],right,left);riverSegments+=2;}
   previous=[left,right];
  }
 }
 let lakeCells=0;
 for(const lake of hydrology.lakes){
  if(!lake||!Array.isArray(lake.cells)||!Number.isFinite(lake.level))continue;
  const lakeY=lake.level*.73+.012;
  for(const id of lake.cells){
   if(!Number.isInteger(id)||id<0||id>=n||hydrology.lakeId[id]!==lake.id)continue;
   const cell=mesh.cells[id],poly=cell.poly;
   if(poly.length<6)continue;
   const center=[toX(cell.x),lakeY,toZ(cell.y)];
   for(let k=0;k<poly.length;k+=2){
    const q=(k+2)%poly.length;
    const a=[toX(poly[k]),lakeY,toZ(poly[k+1])];
    const b=[toX(poly[q]),lakeY,toZ(poly[q+1])];
    addTriangle(lakes,center,a,b);
   }
   lakeCells++;
  }
 }
 return {rivers:new Float32Array(rivers),lakes:new Float32Array(lakes),riverSegments,lakeCells};
}

export function buildElevationSurface(geometry,mesh,elevations,onProgress=()=>{},options={}){
 if(!geometry||!mesh||!Array.isArray(mesh.cells)||!mesh.cells.length)throw Error('Missing Voronoi geometry');
 if(!elevations||elevations.length!==mesh.cells.length)throw Error('Elevation count does not match Voronoi cells');
 const seaLevel=Number(options.seaLevel??0);
 if(!Number.isFinite(seaLevel)||Math.abs(seaLevel)>4)throw Error('Invalid 3D sea level');
 const {segmentsX:cols,segmentsY:rows}=terrainGridSize(geometry,mesh.cells.length);
 const count=(cols+1)*(rows+1),vertexData=new Float32Array(count*7);
 // Position(3) + normal(3) + elevation(1), interleaved for one GPU buffer.
 const raw=new Float32Array(count),inside=new Uint8Array(count);
 const sampler=createTerrainSampler(mesh,.72);
 const maxExtent=Math.max(geometry.width,geometry.height);
 const worldScale=4.8/maxExtent,planeWidth=geometry.width*worldScale,planeDepth=geometry.height*worldScale;
 const dx=planeWidth/cols,dz=planeDepth/rows;
 for(let y=0;y<=rows;y++){
  const wy=geometry.height*y/rows,z=(y/rows-.5)*planeDepth;
  for(let x=0;x<=cols;x++){
   const wx=geometry.width*x/cols,idx=y*(cols+1)+x,offset=idx*7;
   raw[idx]=sampleElevation(sampler,elevations,wx,wy);
   inside[idx]=insideGeometry(wx,wy,geometry)?1:0;
   vertexData[offset]=(x/cols-.5)*planeWidth;
   vertexData[offset+1]=raw[idx]*.73;
   vertexData[offset+2]=z;
   vertexData[offset+6]=raw[idx];
  }
  if(y%24===0)onProgress(y/rows*.72);
 }
 for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){
  const i=y*(cols+1)+x,offset=i*7;
  const l=raw[y*(cols+1)+Math.max(0,x-1)];
  const r=raw[y*(cols+1)+Math.min(cols,x+1)];
  const t=raw[Math.max(0,y-1)*(cols+1)+x];
  const b=raw[Math.min(rows,y+1)*(cols+1)+x];
  const ddx=(r-l)*.73/(dx*(x===0||x===cols?1:2));
  const ddz=(b-t)*.73/(dz*(y===0||y===rows?1:2));
  const size=Math.hypot(ddx,1,ddz);
  vertexData[offset+3]=-ddx/size;
  vertexData[offset+4]=1/size;
  vertexData[offset+5]=-ddz/size;
 }
 const levels=[];
 for(const step of [1,2,4,8]){
  const indices=[];
  for(let y=0;y<rows;y+=step)for(let x=0;x<cols;x+=step){
   const a=y*(cols+1)+x,b=a+step,c=a+step*(cols+1),d=c+step;
   // Clip both parts of each square independently. Circular boundaries
   // approximate the actual mathematical edge at the selected grid LOD.
   if(inside[a]&&inside[c]&&inside[b])indices.push(a,c,b);
   if(inside[b]&&inside[c]&&inside[d])indices.push(b,c,d);
  }
  levels.push({step,indices:new Uint32Array(indices)});
 }
 const hydrology=buildHydrologySurface(geometry,mesh,elevations,options.hydrology,{worldScale,waterMask:options.waterMask});
 const seaY=seaLevel*.73;
 const ocean=new Float32Array(geometry.shape==='rectangle'?
  [-planeWidth/2,seaY,-planeDepth/2,planeWidth/2,seaY,-planeDepth/2,planeWidth/2,seaY,planeDepth/2,
   -planeWidth/2,seaY,-planeDepth/2,planeWidth/2,seaY,planeDepth/2,-planeWidth/2,seaY,planeDepth/2]:
  (()=>{
   const arr=[],segments=128;
   for(let i=0;i<segments;i++){
    const a=i*Math.PI*2/segments,b=(i+1)*Math.PI*2/segments;
    arr.push(0,seaY,0,Math.cos(a)*planeWidth/2,seaY,Math.sin(a)*planeDepth/2,
     Math.cos(b)*planeWidth/2,seaY,Math.sin(b)*planeDepth/2);
   }
   return arr;
  })());
 onProgress(1);
 return {vertexData,levels,ocean,hydrology,seaLevel,cols,rows,planeWidth,planeDepth,worldScale,vertexCount:count};
}
