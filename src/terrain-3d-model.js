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
 return {vertexData,levels,ocean,seaLevel,cols,rows,planeWidth,planeDepth,worldScale,vertexCount:count};
}
