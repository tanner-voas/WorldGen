import {insideGeometry} from './engine.js';

export const MIN_RENDER_STAGE=5;
export const RENDER_SIZE_OPTIONS=[1024,1536,2048,3072,4096];

const MODE_LABELS={
 satellite:'Satellite / terrain',
 relief:'Physical relief',
 change:'Elevation change',
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
  contours:0,
  reference:Math.min(6,resolved-1),
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
 if(stage>=5)ids.push('change');
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
   // Anchor isolated islands, lakes and summits at their own sites.
   const weight=t*t*t/Math.max(1e-8,d2/radius2);
   visitor(i,weight);
   count++;
  }
 }
 return count;
}

/** Exact nearest-site fallback for points outside the compact interpolation
 * radius. Search spatial-hash buckets in expanding rings; stop as soon as
 * every unvisited bucket is provably farther than the closest visited site.
 * This is especially important at the empty corners of circular/elliptical
 * maps, where scanning every polygon at every off-world grid vertex was slow.
 * Ties retain the lowest original site index, matching the previous scan. */
export function nearestTerrainSite(sampler,x,y){
 const {mesh,buckets,cols,rows,dx,dy}=sampler;
 if(!mesh.cells.length)return -1;
 const cx=Math.max(0,Math.min(cols-1,Math.floor(x/dx)));
 const cy=Math.max(0,Math.min(rows-1,Math.floor(y/dy)));
 let best=-1,bestDistance=Infinity;
 for(let ring=0;ring<Math.max(cols,rows);ring++){
  const x0=Math.max(0,cx-ring),x1=Math.min(cols-1,cx+ring);
  const y0=Math.max(0,cy-ring),y1=Math.min(rows-1,cy+ring);
  for(let by=y0;by<=y1;by++)for(let bx=x0;bx<=x1;bx++){
   if(Math.max(Math.abs(bx-cx),Math.abs(by-cy))!==ring)continue;
   for(const i of buckets[by*cols+bx]){
    const c=mesh.cells[i],distance=(c.x-x)**2+(c.y-y)**2;
    if(distance<bestDistance||(distance===bestDistance&&i<best)){
     bestDistance=distance;best=i;
    }
   }
  }
  const frontier=[];
  if(x0>0)frontier.push(x-x0*dx);
  if(x1<cols-1)frontier.push((x1+1)*dx-x);
  if(y0>0)frontier.push(y-y0*dy);
  if(y1<rows-1)frontier.push((y1+1)*dy-y);
  if(!frontier.length)break;
  const lowerBound=Math.max(0,Math.min(...frontier));
  if(best>=0&&bestDistance<lowerBound*lowerBound)break;
 }
 return best;
}

export function rasterDimensions(output,detail){
 const budget=detail==='ultra'?1250000:detail==='high'?900000:600000;
 // Thin worlds may have only a handful of pixels across their short axis.
 // Keep those pixels when the total sample count still fits the budget.
 const target=Math.max(1/detailPreset(detail).sampleStep,16/Math.min(output.width,output.height));
 const scale=Math.min(1,target,Math.sqrt(budget/(output.width*output.height)));
 return {width:Math.max(1,Math.floor(output.width*scale)),height:Math.max(1,Math.floor(output.height*scale))};
}

// Use the same shoreline in the terrain pixels and at river mouths.
export function coastCoverage(fraction,texture,blend){
 const nearCoast=1-smoothstep(.08,.4,Math.abs(fraction-.5));
 return clamp01(fraction+texture*.16*nearCoast*clamp01(blend));
}

export function riverShorePoint(sampler,water,lakeId,dry,wet,textureScale,blend){
 const a=sampler.mesh.cells[dry],b=sampler.mesh.cells[wet];
 let low=0,high=1;
 for(let pass=0;pass<10;pass++){
  const t=(low+high)/2,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
  let sum=0,land=0,lake=0;
  visitTerrainSites(sampler,x,y,(i,w)=>{
   sum+=w;
   if(!water[i])land+=w;
   if(lakeId[i]>=0)lake+=w;
  });
  // In an empty sampling disk the Voronoi bisector is the shoreline.
  let isDry=t<.5;
  if(sum>1e-8){
   const coverage=coastCoverage(land/sum,terrainTexture(x,y,textureScale)-.5,blend);
   isDry=coverage>=.5&&lake/sum<.5;
  }
  if(isDry)low=t;else high=t;
 }
 const t=(low+high)/2;
 return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
}

export function comparisonStages(stage){
 return [4,5,6].filter(n=>n<Math.min(stage,7));
}

// Stages after erosion reuse its terrain. Older coast records can inherit layer 4.
export function elevationsAt(source,stage){
 for(let n=Math.min(stage,7);n>=4;n--){
  if(source[n]?.elevations)return source[n].elevations;
 }
 throw Error('Terrain elevations are missing');
}

export function distanceScale(kmPerPixel,maxPixels){
 const target=kmPerPixel*maxPixels;
 const decade=10**Math.floor(Math.log10(target));
 const distance=(target>=5*decade?5:target>=2*decade?2:1)*decade;
 return {distance,pixels:distance/kmPerPixel};
}
