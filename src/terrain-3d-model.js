/** 3D terrain surface derived from a selected generation stage. This is derived rendering data, never saved to the
 * world or used as an input to subsequent generation layers.
 * Coordinate frame: X east, Y up (render-only), Z south.
 */
import {insideGeometry} from './engine.js';
import {terrainVerticalScales} from './elevation-units.js';
import {createTerrainSampler,visitTerrainSites,nearestTerrainSite} from './terrain-sampler.js';
import {createCoastlineConstraint} from './terrain-coastline.js';
import {createLakeConstraint} from './terrain-lakes.js';
import {buildRiverDecals,riverDetailFade} from './terrain-rivers.js';
import {buildSurfaceMaterialField} from './terrain-surface-materials.js';
import {buildTerrainSiteColors,terrainAppearanceName} from './terrain-3d-material.js';
import {buildAdaptiveTerrainLevels,buildUniformTerrainLevels} from './terrain-3d-lod.js';
import {createFocusedOutline,appendFocusedOutlineIndices} from './terrain-3d-outline.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const ELEVATION_RENDER_STAGE=4;
/** Display height scale retained for compatibility with the existing mesh API.
 * The physical height scale and base visual exaggeration are explicit in
 * terrainVerticalScales; neither changes the stored elevation field. */
export function terrainHeightScale(geometry){return terrainVerticalScales(geometry).heightScale;}
const smoothstep=(a,b,v)=>{const x=clamp((v-a)/(b-a),0,1);return x*x*(3-2*x);};

/** Select the actual saved terrain field for a historical generation stage.
 * Later environmental layers reuse the locked erosion heightfield; their
 * saved climate, soil, biome and vegetation fields are separately interpreted
 * as read-only material colors by terrain-3d-material.js. This function only
 * chooses elevation and sea level and never rewrites saved layer records.
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

/** Prepare the shared height sampler with the historical coastline, if any. */
export function createSurfaceSampler(mesh,elevations,{waterMask=null,seaLevel=0,hydrology=null}={}){
 const sampler=createTerrainSampler(mesh,.72);
 sampler.coastline=createCoastlineConstraint(mesh,elevations,waterMask,seaLevel);
 sampler.lakes=createLakeConstraint(mesh,elevations,hydrology,seaLevel,waterMask);
 return sampler;
}
function constrainedHeight(coast,side,sum,weight,elevations,sampler,x,y,lakeSide,depthSum,depthWeight){
 let height;
 if(!coast)height=weight>1e-15?sum/weight:Number(elevations[nearestTerrainSite(sampler,x,y)]);
 else{
  const magnitude=weight>1e-15?sum/weight:coast.depth[side.nearest];
  height=coast.seaLevel+(side.wet?-1:1)*magnitude*side.fade;
 }
 return lakeSide?sampler.lakes.apply(lakeSide,height,side,depthWeight>1e-15?depthSum/depthWeight:undefined):height;
}
/** Compact-support interpolant. The saved elevation field is never modified. */
export function sampleElevation(sampler,elevations,x,y,lakeSide=sampler.lakes?.at(x,y)){
 let total=0,weighted=0,depthSum=0,depthWeight=0;
 // The legacy interpolant used inverse-distance weights (1/r²) and placed
 // unnaturally steep narrow peaks at Voronoi sites. A compact C2 Wendland
 // kernel has bounded derivatives at its centre and smoothly tapers out at
 // its search radius. It intentionally smooths the source field, without
 // changing any stored elevation values.
 const radius=sampler.radius,coast=sampler.coastline,side=coast?.at(x,y);
 visitTerrainSites(sampler,x,y,i=>{
  if(coast&&coast.mask[i]!==side.wet)return;
  const site=sampler.mesh.cells[i],distance=Math.hypot(site.x-x,site.y-y);
  const t=clamp(distance/radius,0,1),u=1-t;
  const weight=u*u*u*u*(1+4*t);
  total+=weight;weighted+=(coast?coast.depth[i]:Number(elevations[i]))*weight;
  if(lakeSide?.inside&&sampler.lakes.membership[i]===lakeSide.id){depthSum+=sampler.lakes.depth[i]*weight;depthWeight+=weight;}
 });
 return constrainedHeight(coast,side,weighted,total,elevations,sampler,x,y,lakeSide,depthSum,depthWeight);
}

/** Material-equipped meshes need two differently weighted properties at
 * exactly the same location. Compute both during one indexed site visit,
 * preserving the independent elevation/material kernels and fallbacks.
 * Earlier elevation-only stages still use the cheaper height-only path. */
export function sampleTerrainFields(sampler,elevations,siteColors,x,y,lakeSide=sampler.lakes?.at(x,y)){
 let heightSum=0,heightWeight=0,colorWeight=0,r=0,g=0,b=0,depthSum=0,depthWeight=0;
 const radius=sampler.radius,coast=sampler.coastline,side=coast?.at(x,y);
 visitTerrainSites(sampler,x,y,(i,colorW)=>{
  const site=sampler.mesh.cells[i];
  const t=clamp(Math.hypot(site.x-x,site.y-y)/radius,0,1),u=1-t;
  const heightW=u*u*u*u*(1+4*t);
  if(!coast||coast.mask[i]===side.wet){heightSum+=(coast?coast.depth[i]:Number(elevations[i]))*heightW;heightWeight+=heightW;}
  if(lakeSide?.inside&&sampler.lakes.membership[i]===lakeSide.id){depthSum+=sampler.lakes.depth[i]*heightW;depthWeight+=heightW;}
  const k=i*3,color=colorW;
  colorWeight+=color;r+=siteColors[k]*color;g+=siteColors[k+1]*color;b+=siteColors[k+2]*color;
 });
 const height=constrainedHeight(coast,side,heightSum,heightWeight,elevations,sampler,x,y,lakeSide,depthSum,depthWeight);
 if(colorWeight>1e-15)return {height,color:[r/colorWeight,g/colorWeight,b/colorWeight]};
 const nearest=nearestTerrainSite(sampler,x,y),k=nearest*3;
 return {height,color:[siteColors[k],siteColors[k+1],siteColors[k+2]]};
}

/** A high-resolution local tile that exactly stitches into the coarse mesh.
 * At its outer edge height is linear between adjacent base grid vertices;
 * across a short transition band it becomes the full continuous elevation
 * field. This prevents open seams while resolving a single Voronoi polygon
 * with tens of triangles across instead of a handful.
 */
export function buildFocusedTerrainPatch(geometry,mesh,elevations,grid,area,options={}){
 const {cols,rows,planeWidth,planeDepth,heightScale,riverMask}=grid||{};
 const {x0,y0,x1,y1}=area||{};
 const subdivisions=options.subdivisions??8;
 if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<=0||rows<=0||
    !Number.isFinite(planeWidth)||!Number.isFinite(planeDepth)||!Number.isFinite(heightScale)||
    ![x0,y0,x1,y1,subdivisions].every(Number.isInteger)||x0<0||y0<0||
    x1>cols||y1>rows||x1<=x0||y1<=y0||subdivisions<2||subdivisions>12||
    elevations?.length!==mesh?.cells?.length)throw Error('Invalid focused terrain patch');
 const nx=(x1-x0)*subdivisions,ny=(y1-y0)*subdivisions;
 const count=(nx+1)*(ny+1),stride=nx+1;
 const vertexData=new Float32Array(count*7),raw=new Float32Array(count);
 const outline=createFocusedOutline(geometry,grid,area);
 // The viewer worker reuses this immutable sampling context across nearby
 // tiles. Standalone patch calls still build their own context as before.
 const sourceColors=options.sourceColors===undefined?
  buildTerrainSiteColors(mesh,options.appearance||null):options.sourceColors;
 const materialColors=sourceColors?new Float32Array(count*3):null;
 const sampler=options.sampler||createSurfaceSampler(mesh,elevations,options);
 // Cache coarse grid corners; the patch can contain more than 65,000
 // vertices but has only a few hundred coarse-grid anchors.
 const anchors=new Float32Array((x1-x0+1)*(y1-y0+1));
 const colorAnchors=materialColors?new Float32Array(anchors.length*3):null;
 const anchorIndex=(x,y)=>(y-y0)*(x1-x0+1)+x-x0;
 const anchorAt=(x,y)=>anchors[anchorIndex(x,y)];
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
  const wx=geometry.width*x/cols,wy=geometry.height*y/rows,idx=anchorIndex(x,y);
  if(colorAnchors){
   const sample=sampleTerrainFields(sampler,elevations,sourceColors,wx,wy);
   anchors[idx]=sample.height;colorAnchors.set(sample.color,idx*3);
  }else anchors[idx]=sampleElevation(sampler,elevations,wx,wy);
 }
 for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
  const gx=x0+i/subdivisions,gy=y0+j/subdivisions;
  const wx=geometry.width*gx/cols,wy=geometry.height*gy/rows;
  const xx=(gx/cols-.5)*planeWidth,zz=(gy/rows-.5)*planeDepth;
  const ax=Math.min(x1-1,Math.floor(gx)),ay=Math.min(y1-1,Math.floor(gy));
  const fx=gx-ax,fy=gy-ay;
  const a=anchorAt(ax,ay),b=anchorAt(ax+1,ay),c=anchorAt(ax,ay+1),d=anchorAt(ax+1,ay+1);
  const outlineFade=outline?.fade(gx,gy)??1;
  const coarse=(sampler.coastline||sampler.lakes||riverMask||outlineFade<1)?(fx+fy<=1?a+(b-a)*fx+(c-a)*fy:d+(c-d)*(1-fx)+(b-d)*(1-fy)):
   (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
  const sampled=materialColors?sampleTerrainFields(sampler,elevations,sourceColors,wx,wy):null;
  const accurate=sampled?sampled.height:sampleElevation(sampler,elevations,wx,wy);
  const border=Math.min(gx-x0,x1-gx,gy-y0, y1-gy);
  const borderFade=smoothstep(0,(sampler.coastline||sampler.lakes) ? .5 : 1.5,border)*outlineFade;
  const fade=borderFade*riverDetailFade(riverMask,cols,ax,ay,fx,fy);
  const id=j*stride+i,offset=id*7;
  raw[id]=coarse+(accurate-coarse)*fade;
  vertexData[offset]=xx;vertexData[offset+1]=raw[id]*heightScale;
  vertexData[offset+2]=zz;vertexData[offset+6]=raw[id];
  if(materialColors){
   // Mixed-density patches must share the base mesh's linear material
   // edge, not independently resample nonlinear colors along that edge.
   for(let k=0;k<3;k++){
    const color=(x,y)=>colorAnchors[anchorIndex(x,y)*3+k];
    const a=color(ax,ay),b=color(ax+1,ay),c=color(ax,ay+1),d=color(ax+1,ay+1);
    const coarseColor=fx+fy<=1?a+(b-a)*fx+(c-a)*fy:d+(c-d)*(1-fx)+(b-d)*(1-fy);
    materialColors[id*3+k]=coarseColor+(sampled.color[k]-coarseColor)*borderFade;
   }
  }
 }
 // Match the coarse mesh normals as well as its edge heights. Without
 // this a mathematically crack-free edge could still show a lighting seam.
 const coarseDx=planeWidth/cols,coarseDz=planeDepth/rows;
 const normalAnchors=new Float32Array(anchors.length*3);
 const baseSample=(x,y)=>x>=x0&&x<=x1&&y>=y0&&y<=y1?anchorAt(x,y):
  sampleElevation(sampler,elevations,geometry.width*x/cols,geometry.height*y/rows);
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
  const l=baseSample(Math.max(0,x-1),y),r=baseSample(Math.min(cols,x+1),y);
  const u=baseSample(x,Math.max(0,y-1)),d=baseSample(x,Math.min(rows,y+1));
  const dx0=(r-l)*heightScale/(coarseDx*(x===0||x===cols?1:2));
  const dz0=(d-u)*heightScale/(coarseDz*(y===0||y===rows?1:2));
  const len=Math.hypot(dx0,1,dz0),idx=((y-y0)*(x1-x0+1)+x-x0)*3;
  normalAnchors.set([-dx0/len,1/len,-dz0/len],idx);
 }
 const dx=planeWidth/(cols*subdivisions),dz=planeDepth/(rows*subdivisions);
 for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
  const idx=j*stride+i,offset=idx*7;
  const l=raw[j*stride+Math.max(0,i-1)],r=raw[j*stride+Math.min(nx,i+1)];
  const u=raw[Math.max(0,j-1)*stride+i],d=raw[Math.min(ny,j+1)*stride+i];
  const gradX=(r-l)*heightScale/(dx*(i===0||i===nx?1:2));
  const gradZ=(d-u)*heightScale/(dz*(j===0||j===ny?1:2));
  const length=Math.hypot(gradX,1,gradZ);
  const gx=x0+i/subdivisions,gy=y0+j/subdivisions;
  const ax=Math.min(x1-1,Math.floor(gx)),ay=Math.min(y1-1,Math.floor(gy));
  const tx=gx-ax,ty=gy-ay,coarseStride=x1-x0+1;
  const base=(xx,yy,dim)=>normalAnchors[((yy-y0)*coarseStride+xx-x0)*3+dim];
  const outlineFade=outline?.fade(gx,gy)??1;
  const fade=smoothstep(0,(sampler.coastline||sampler.lakes) ? .5 : 1.5,Math.min(gx-x0,x1-gx,gy-y0,y1-gy))*riverDetailFade(riverMask,cols,ax,ay,tx,ty)*outlineFade;
  const blended=[];
  for(let c=0;c<3;c++){
   const a=base(ax,ay,c),b=base(ax+1,ay,c),d=base(ax,ay+1,c),e=base(ax+1,ay+1,c);
   const anchor=outlineFade<1?(tx+ty<=1?a+(b-a)*tx+(d-a)*ty:e+(d-e)*(1-tx)+(b-e)*(1-ty)):
    (a*(1-tx)+b*tx)*(1-ty)+(d*(1-tx)+e*tx)*ty;
   const fine=[-gradX/length,1/length,-gradZ/length][c];
   blended.push(anchor*(1-fade)+fine*fade);
  }
  const scale=Math.hypot(...blended)||1;
  for(let c=0;c<3;c++)vertexData[offset+3+c]=blended[c]/scale;
 }
 const indices=[];
 appendFocusedOutlineIndices(indices,outline,area,subdivisions);
 return {vertexData,materialColors,indices:new Uint32Array(indices),x0,y0,x1,y1,subdivisions,vertexCount:count};
}

/** Generate narrow curved 3D water ribbons and level lake surfaces directly from
 * the locked drainage graph. Geometry is transient and read-only: the saved
 * hydrology and elevation arrays are never modified. All positions use the
 * same normalized X/Z coordinate frame as the terrain mesh. */
export function buildHydrologySurface(geometry,mesh,elevations,hydrology,options={}){
 const empty=()=>({rivers:new Float32Array(0),lakes:new Float32Array(0),riverSegments:0,lakeCells:0,riverMask:null});
 if(!hydrology)return empty();
 const n=mesh?.cells?.length||0;
 if(!n||elevations?.length!==n||hydrology.flowTo?.length!==n||hydrology.discharge?.length!==n||
   hydrology.lakeId?.length!==n||!Array.isArray(hydrology.channels)||!Array.isArray(hydrology.lakes)){
  throw Error('3D hydrology source does not match the terrain mesh');
 }
 const scale=Number(options.worldScale)||4.8/Math.max(geometry.width,geometry.height);
 const sx=geometry.width*scale,sz=geometry.height*scale;
 const sampler=options.sampler||createSurfaceSampler(mesh,elevations,{...options,hydrology}),lakes=[];
 const toX=x=>(x/geometry.width-.5)*sx,toZ=z=>(z/geometry.height-.5)*sz;
 const heightScale=Number(options.heightScale)||terrainHeightScale(geometry);
 const addTriangle=(target,a,b,c)=>target.push(...a,...b,...c);
 // The normal caller supplies the exact rendered base vertices. Standalone
 // callers can sample an equivalent grid without building LODs.
 let grid=options.grid;
 if(!grid&&hydrology.channels.length){
  const {segmentsX:cols,segmentsY:rows}=terrainGridSize(geometry,n);
  const vertexData=new Float32Array((cols+1)*(rows+1)*7),insideMask=new Uint8Array((cols+1)*(rows+1));
  for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){
   const wx=x/cols*geometry.width,wy=y/rows*geometry.height,id=y*(cols+1)+x;
   vertexData[id*7+1]=Math.fround(sampleElevation(sampler,elevations,wx,wy))*heightScale;
   insideMask[id]=insideGeometry(wx,wy,geometry)?1:0;
  }
  grid={cols,rows,planeWidth:sx,planeDepth:sz,vertexData,insideMask};
 }
 const river=grid&&hydrology.channels.length?buildRiverDecals(geometry,mesh,hydrology,grid,{waterMask:options.waterMask,seaY:(options.seaLevel??0)*heightScale}):{rivers:new Float32Array(0),riverMask:null};
 let lakeCells=0;
 for(const lake of hydrology.lakes){
  if(!lake||!Array.isArray(lake.cells)||!Number.isFinite(lake.level))continue;
  const lakeY=lake.level*heightScale;
  for(const id of lake.cells){
   if(!Number.isInteger(id)||id<0||id>=n||hydrology.lakeId[id]!==lake.id||options.waterMask?.[id])continue;
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
 return {...river,lakes:new Float32Array(lakes),riverSegments:river.rivers.length/9,lakeCells};
}

export function buildElevationSurface(geometry,mesh,elevations,onProgress=()=>{},options={}){
 if(!geometry||!mesh||!Array.isArray(mesh.cells)||!mesh.cells.length)throw Error('Missing Voronoi geometry');
 if(!elevations||elevations.length!==mesh.cells.length)throw Error('Elevation count does not match Voronoi cells');
 const seaLevel=Number(options.seaLevel??0);
 if(!Number.isFinite(seaLevel)||Math.abs(seaLevel)>4)throw Error('Invalid 3D sea level');
 const {segmentsX:cols,segmentsY:rows}=terrainGridSize(geometry,mesh.cells.length);
 const count=(cols+1)*(rows+1),vertexData=new Float32Array(count*7);
 const {heightScale,physicalHeightScale,baseExaggeration,worldScale}=terrainVerticalScales(geometry);
 // Position(3) + normal(3) + elevation(1), interleaved for one GPU buffer.
 const raw=new Float32Array(count),inside=new Uint8Array(count);
 let minY=Infinity,maxY=-Infinity;
 const sampler=createSurfaceSampler(mesh,elevations,{...options,seaLevel});
 const sourceColors=buildTerrainSiteColors(mesh,options.appearance||null);
 const lakeMask=sampler.lakes?new Uint8Array(count):null;
 const materialColors=sourceColors?new Float32Array(count*3):null;
 const planeWidth=geometry.width*worldScale,planeDepth=geometry.height*worldScale;
 const dx=planeWidth/cols,dz=planeDepth/rows;
 for(let y=0;y<=rows;y++){
  const wy=geometry.height*y/rows,z=(y/rows-.5)*planeDepth;
  for(let x=0;x<=cols;x++){
   const wx=geometry.width*x/cols,idx=y*(cols+1)+x,offset=idx*7;
   const lakeSide=sampler.lakes?.at(wx,wy);
   const sampled=materialColors?sampleTerrainFields(sampler,elevations,sourceColors,wx,wy,lakeSide):null;
   raw[idx]=sampled?sampled.height:sampleElevation(sampler,elevations,wx,wy,lakeSide);
   if(lakeMask)lakeMask[idx]=lakeSide.near?1:0;
   minY=Math.min(minY,raw[idx]*heightScale);maxY=Math.max(maxY,raw[idx]*heightScale);
   if(materialColors)materialColors.set(sampled.color,idx*3);
   inside[idx]=insideGeometry(wx,wy,geometry)?1:0;
   vertexData[offset]=(x/cols-.5)*planeWidth;
   vertexData[offset+1]=raw[idx]*heightScale;
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
  const ddx=(r-l)*heightScale/(dx*(x===0||x===cols?1:2));
  const ddz=(b-t)*heightScale/(dz*(y===0||y===rows?1:2));
  const size=Math.hypot(ddx,1,ddz);
  vertexData[offset+3]=-ddx/size;
  vertexData[offset+4]=1/size;
  vertexData[offset+5]=-ddz/size;
 }
 const coastMask=sampler.coastline?Uint8Array.from(raw,h=>h<seaLevel?1:0):null;
 const hydrology=buildHydrologySurface(geometry,mesh,elevations,options.hydrology,{worldScale,heightScale,waterMask:options.waterMask,seaLevel,sampler,
  grid:{cols,rows,planeWidth,planeDepth,vertexData,insideMask:inside}});
 const riverMask=hydrology.riverMask;
 // Reuse protected-block stitching for all squares beneath river decals.
 const protectedMask=riverMask&&lakeMask?Uint8Array.from(lakeMask,(v,i)=>v||riverMask[i]):riverMask||lakeMask;
 const levels=buildAdaptiveTerrainLevels(cols,rows,inside,planeWidth,planeDepth,{coastMask,lakeMask:protectedMask});
 // Per-tile height bounds enable safe frustum culling of mixed-detail terrain
 // without using the global mountain range for every otherwise-flat tile.
 for(const tile of levels[0].tiles){
  let min=Infinity,max=-Infinity;
  for(let yy=tile.y0;yy<=tile.y1;yy++)for(let xx=tile.x0;xx<=tile.x1;xx++){
   const value=raw[yy*(cols+1)+xx]*heightScale;
   min=Math.min(min,value);max=Math.max(max,value);
  }
  tile.minY=min-.06;tile.maxY=max+.06;
 }
 const uniformLevels=options.includeUniformLevels===false?[]:buildUniformTerrainLevels(cols,rows,inside,{coastMask,lakeMask:protectedMask});
 const seaY=seaLevel*heightScale;
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
 const surfaceMaterials=buildSurfaceMaterialField(sampler,options.appearance||null,cols,rows,options.hydrology?.lakeId);
 return {vertexData,insideMask:inside,outline:geometry,materialColors,surfaceMaterials,materialName:terrainAppearanceName(options.appearance?.stage||4),levels,uniformLevels,ocean,hydrology,seaLevel,cols,rows,planeWidth,planeDepth,worldScale,vertexCount:count,
  minY:Math.min(minY,seaY)-.05,maxY:Math.max(maxY,seaY)+.05,heightScale,physicalHeightScale,baseExaggeration,siteSpacing:Math.sqrt((mesh.areaKm2||geometry.width*geometry.height)/mesh.cells.length)*worldScale};
}
