import {insideGeometry} from './engine.js';

export const MIN_RENDER_STAGE=5;
export const RENDER_SIZE_OPTIONS=[1024,1536,2048,3072,4096];

const MODE_LABELS={
 satellite:'Satellite / terrain',
 relief:'Physical relief',
 climate:'Climate',
 hydrology:'Hydrology',
 biomes:'Biomes',
 vegetation:'Vegetation'
};

export function defaultRenderSettings(stage){
 const resolved=Math.max(MIN_RENDER_STAGE,Math.floor(stage||MIN_RENDER_STAGE));
 return {
  stage:resolved,
  mode:defaultRenderMode(resolved),
  longEdge:resolved>=11?2048:1536,
  detail:resolved>=11?'high':'standard',
  blend:0.72,
  relief:resolved>=5?0.85:0,
  coast:0.85,
  hydro:resolved>=9?1.05:0,
  climateTint:resolved>=8?0.24:0,
  biomeTint:resolved>=11?0.18:0,
  vegetationTint:resolved>=12?0.34:0
 };
}

export function defaultRenderMode(stage){
 if(stage>=12)return 'satellite';
 if(stage>=11)return 'satellite';
 if(stage>=9)return 'satellite';
 return 'satellite';
}

export function renderModeOptions(stage){
 const ids=['satellite','relief'];
 if(stage>=8)ids.push('climate');
 if(stage>=9)ids.push('hydrology');
 if(stage>=11)ids.push('biomes');
 if(stage>=12)ids.push('vegetation');
 return ids.map(id=>[id,MODE_LABELS[id]||id]);
}

export function renderOptionSupport(stage){
 return {
  relief:stage>=5,
  hydro:stage>=9,
  climateTint:stage>=8,
  biomeTint:stage>=11,
  vegetationTint:stage>=12
 };
}

export function outputDimensions(width,height,longEdge){
 const longest=Math.max(width,height,1);
 const scale=Math.max(1,Number(longEdge)||1024)/longest;
 return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),scale};
}

export function detailPreset(name){
 switch(name){
  case 'preview':return {sampleStep:6,blur:1.05,riverWidth:0.9};
  case 'high':return {sampleStep:3,blur:1.45,riverWidth:1.2};
  case 'ultra':return {sampleStep:2,blur:1.7,riverWidth:1.4};
  default:return {sampleStep:4,blur:1.25,riverWidth:1.0};
 }
}

export function clamp01(x){return Math.max(0,Math.min(1,Number(x)||0));}
export function smoothstep(a,b,x){const t=clamp01((x-a)/Math.max(1e-9,b-a));return t*t*(3-2*t);}

/** Keep the geometry API in one place so raster sampling cannot swap arguments. */
export function renderInsideGeometry(x,y,geometry){
 return insideGeometry(x,y,geometry);
}

/** Stable sub-cell texture independent of PNG resolution and pan/zoom state. */
function noiseHash(x,y){
 let h=(Math.imul(x,374761393)+Math.imul(y,668265263))|0;
 h=Math.imul(h^(h>>>13),1274126177);
 return ((h^(h>>>16))>>>0)/4294967295;
}
export function smoothNoise(x,y){
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
 const a=fx*fx*(3-2*fx),b=fy*fy*(3-2*fy);
 const lo=noiseHash(ix,iy)*(1-a)+noiseHash(ix+1,iy)*a;
 const hi=noiseHash(ix,iy+1)*(1-a)+noiseHash(ix+1,iy+1)*a;
 return lo*(1-b)+hi*b;
}
export function terrainTexture(x,y,scale){
 const s=Math.max(1e-9,scale);
 return 0.65*smoothNoise(x/s,y/s)+0.35*smoothNoise(x/(s*.32),y/(s*.32));
}

/** Spatial hash of Voronoi sites for continuous raster sampling.
 * Unlike owner-cell neighbor lists, nearby candidates depend only on their
 * distance from the raster sample, so a polygon crossing cannot switch the
 * interpolation neighborhood abruptly. Compact-support weights go smoothly
 * to zero at the search radius, avoiding seams at bucket boundaries.
 */
export function createTerrainSampler(mesh,blend=0.72){
 const n=mesh.cells.length;
 const area=mesh.areaKm2||mesh.width*mesh.height;
 const spacing=Math.sqrt(area/Math.max(n,1));
 const radius=Math.max(1e-7,spacing*(1.7+clamp01(blend/1.25)*1.45));
 const cols=Math.max(1,Math.ceil(mesh.width/radius));
 const rows=Math.max(1,Math.ceil(mesh.height/radius));
 const dx=mesh.width/cols,dy=mesh.height/rows;
 const buckets=Array.from({length:cols*rows},()=>[]);
 for(let i=0;i<n;i++){
  const c=mesh.cells[i];
  const bx=Math.max(0,Math.min(cols-1,Math.floor(c.x/dx)));
  const by=Math.max(0,Math.min(rows-1,Math.floor(c.y/dy)));
  buckets[by*cols+bx].push(i);
 }
 return {mesh,buckets,cols,rows,dx,dy,radius,radius2:radius*radius};
}

/** Yields only sites inside the compact interpolation radius.
 * Fallback is supplied by caller for sparsely populated areas.
 */
export function visitTerrainSites(sampler,x,y,visitor){
 const {mesh,buckets,cols,rows,dx,dy,radius,radius2}=sampler;
 const x0=Math.max(0,Math.floor((x-radius)/dx));
 const x1=Math.min(cols-1,Math.floor((x+radius)/dx));
 const y0=Math.max(0,Math.floor((y-radius)/dy));
 const y1=Math.min(rows-1,Math.floor((y+radius)/dy));
 let count=0;
 for(let by=y0;by<=y1;by++)for(let bx=x0;bx<=x1;bx++){
  for(const i of buckets[by*cols+bx]){
   const c=mesh.cells[i],qx=x-c.x,qy=y-c.y,d2=qx*qx+qy*qy;
   if(d2>=radius2)continue;
   const t=1-d2/radius2;
   const weight=t*t*t;
   visitor(i,weight);
   count++;
  }
 }
 return count;
}
