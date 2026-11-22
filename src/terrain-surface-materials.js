/** Stage-aware surface material coverage, separate from mesh colors/heights.
 * Eight normalized channels: rock, sand, soil, grass, forest, snow, wetland,
 * and neutral submerged terrain. A single spatial field is shared by every
 * global and local LOD, so material detail never moves with tessellation.
 */
import {visitTerrainSites,nearestTerrainSite} from './terrain-sampler.js';
export const SURFACE_MATERIALS=Object.freeze(['rock','sand','soil','grass','forest','snow','wetland','submerged']);
const clamp=v=>Math.max(0,Math.min(1,v));
const unit=i=>SURFACE_MATERIALS.map((_,j)=>Number(i===j));
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*clamp(t));
const normalize=a=>{const sum=a.reduce((s,v)=>s+v,0)||1;return a.map(v=>v/sum);};
const soilProfiles=[unit(7),unit(0),[.55,0,.45,0,0,0,0,0],unit(1),unit(2),unit(2),unit(6),[.6,0,.4,0,0,0,0,0],[.2,.55,.25,0,0,0,0,0],[.15,0,.4,.2,0,.25,0,0]];
const biomeProfiles=[unit(7),unit(7),[.05,0,0,0,0,.95,0,0],
 [.22,0,.28,.30,0,.20,0,0], [.08,0,.12,.10,.70,0,0,0],
 [0,0,.10,.05,.80,0,.05,0], [.03,0,.12,.15,.70,0,0,0],
 [0,0,.15,.85,0,0,0,0], [.08,.18,.22,.52,0,0,0,0],
 [.20,.75,.05,0,0,0,0,0], [.12,.23,.25,.40,0,0,0,0],
 [0,0,.03,.04,.88,0,.05,0], [0,0,.10,.15,.75,0,0,0],
 [0,.13,.17,.55,.15,0,0,0], [.62,0,.05,.08,0,.25,0,0],
 [0,0,.14,.11,.05,0,.70,0], [.25,0,.10,.10,.50,.05,0,0]];

export function surfaceMaterialAtSite(appearance,i,lakeIds=null){
 const stage=appearance.stage;
 if(appearance.water[i]||(stage>=10&&lakeIds?.[i]>=0)||(stage>=12&&appearance.biomes?.biome[i]===1))return unit(7);
 const temp=appearance.climate.meanTemp[i],wet=clamp(appearance.climate.moisture[i]);
 const snow=clamp((-temp-4)/18),dry=clamp((.42-wet)/.42),trees=clamp((wet-.48)/.48)*clamp((temp+3)/16);
 let weights=normalize([.10,.65*dry,.23,.65*wet*(1-trees),.75*trees,0,.13*clamp((wet-.85)/.15),0]);
 weights=mix(weights,unit(5),snow);
 if(stage>=11&&appearance.soils){
  weights=mix(weights,soilProfiles[appearance.soils.soilType[i]],.47*(1-snow));
 }
 if(stage>=12&&appearance.biomes){
  const kind=appearance.biomes.biome[i];
  weights=mix(weights,biomeProfiles[kind],.86);
  if(kind!==2&&kind!==14&&kind!==9&&kind!==15){
   weights=mix(weights,unit(4),.20*clamp(appearance.biomes.treePotential[i]));
  }
 }
 if(stage>=13&&appearance.vegetation){
  // Coverage replaces the inferred vegetation component rather than merely
  // darkening the same forest color. Preserve the underlying substrate.
  const canopy=clamp(appearance.vegetation.canopyCover[i]),ground=clamp(appearance.vegetation.groundCover[i]);
  const protectedCover=weights[5]+weights[6];
  const free=Math.max(0,1-protectedCover),forest=free*canopy,grass=(free-forest)*ground;
  const substrate=normalize([weights[0]+.01,weights[1],weights[2]+.01]);
  const bare=free-forest-grass;
  weights=[...substrate.map(v=>v*bare),grass,forest,weights[5],weights[6],0];
 }
 return normalize(weights);
}

// Store two RGBA8 layers in one texture. Quantization retains a total of 255
// at every texel, so linear filtering preserves normalized material coverage.
export function buildSurfaceMaterialField(sampler,appearance,cols,rows,lakeIds=null){
 if(!appearance)return null;
 const {mesh}=sampler;
 const width=Math.min(257,cols+1),height=Math.min(257,rows+1),count=width*height;
 const data=new Uint8Array(count*8),sites=mesh.cells.map((_,i)=>surfaceMaterialAtSite(appearance,i,lakeIds));
 const weights=new Float64Array(8),quantized=new Uint8Array(8);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const wx=mesh.width*x/(width-1),wy=mesh.height*y/(height-1);
  weights.fill(0);let total=0;
  visitTerrainSites(sampler,wx,wy,(i,w)=>{
   total+=w;for(let k=0;k<8;k++)weights[k]+=sites[i][k]*w;
  });
  if(total<=1e-15){weights.set(sites[nearestTerrainSite(sampler,wx,wy)]);total=1;}
  let used=0;
  for(let k=0;k<8;k++){weights[k]=weights[k]/total*255;quantized[k]=Math.floor(weights[k]);used+=quantized[k];weights[k]-=quantized[k];}
  // Largest remainder avoids inventing a nonzero contribution in a channel.
  for(let n=used;n<255;n++){
   let best=0;for(let k=1;k<8;k++)if(weights[k]>weights[best])best=k;
   quantized[best]++;weights[best]=-1;
  }
  const i=(y*width+x)*4;
  data.set(quantized.subarray(0,4),i);data.set(quantized.subarray(4,8),count*4+i);
 }
 return {width,height,data};
}
