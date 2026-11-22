/** Read-only 3D terrain appearance derived from the environmental stages.
 * It changes no simulation fields and introduces no additional render settings.
 * Color values are linear-ish normalized RGB factors used by the existing
 * physically lit WebGL terrain shader, not new terrain heights or biomes.
 */
import {visitTerrainSites,nearestTerrainSite} from './terrain-sampler.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a.map((v,k)=>v+(b[k]-v)*clamp(t));

// Restrained geographic palettes. Water is handled by the separate ocean/lake
// geometry, and is deliberately not treated as terrestrial vegetation.
const BIOME_COLORS=[
 [58,106,124],  // ocean
 [74,144,164],  // freshwater lake
 [220,229,226], // permanent ice
 [157,165,146], // tundra
 [70,105,78],   // boreal forest
 [59,105,78],   // temperate rainforest
 [91,130,80],  // temperate forest
 [164,173,108],// grassland
 [188,169,116],// steppe
 [209,185,137],// desert
 [164,156,106],// dry shrubland
 [43,104,72],  // tropical rainforest
 [77,131,75],  // tropical seasonal forest
 [155,165,91], // savanna
 [153,155,148],// alpine
 [73,127,110], // wetland
 [87,122,86]   // montane forest
];
const SOIL_COLORS=[
 [74,114,132], [139,137,130], [162,148,128], [202,179,133],
 [136,143,103], [155,131,113], [86,116,98], [121,111,102],
 [195,171,123], [171,179,166]
];

export function selectTerrainAppearance(stage,getLayer){
 if(stage<8)return null;
 const climate=getLayer(8),coast=getLayer(5);
 if(!climate?.meanTemp||!climate?.moisture||!coast?.water)throw Error('3D climate appearance requires completed climate and coast layers');
 const result={stage,climate:{meanTemp:climate.meanTemp,moisture:climate.moisture},water:coast.water};
 if(stage>=10){
  const soils=getLayer(10);
  if(!soils?.soilType||!soils?.fertility)throw Error('3D soil appearance requires layer 10');
  result.soils={soilType:soils.soilType,fertility:soils.fertility};
 }
 if(stage>=11){
  const biomes=getLayer(11);
  if(!biomes?.biome||!biomes?.treePotential)throw Error('3D biome appearance requires layer 11');
  result.biomes={biome:biomes.biome,treePotential:biomes.treePotential};
 }
 if(stage>=12){
  const vegetation=getLayer(12);
  if(!vegetation?.canopyCover||!vegetation?.groundCover)throw Error('3D vegetation appearance requires layer 12');
  result.vegetation={canopyCover:vegetation.canopyCover,groundCover:vegetation.groundCover};
 }
 return result;
}

export function terrainAppearanceName(stage){
 if(stage>=12)return 'Vegetation';
 if(stage>=11)return 'Biomes';
 if(stage>=10)return 'Soils';
 if(stage>=8)return 'Climate';
 return 'Elevation';
}

export function terrainMaterialAtSite(material,i){
 if(!material)return null;
 const temp=Number(material.climate.meanTemp[i]),moisture=Number(material.climate.moisture[i]);
 if(!Number.isFinite(temp)||!Number.isFinite(moisture))throw Error('Invalid 3D climate color fields');
 const wet=clamp(moisture),cold=clamp((8-temp)/30),frost=clamp((-9-temp)/25);
 let color=mix([195,174,126],[79,133,87],Math.pow(wet,.76));
 color=mix(color,[158,168,158],cold*.64);
 color=mix(color,[226,232,230],frost*.82);
 if(material.soils){
  const kind=Number(material.soils.soilType[i]),fertility=Number(material.soils.fertility[i]);
  if(!Number.isInteger(kind)||kind<0||kind>=SOIL_COLORS.length||!Number.isFinite(fertility))throw Error('Invalid 3D soil color fields');
  color=mix(color,SOIL_COLORS[kind],.23);
  color=mix(color,[71,133,82],clamp(fertility)*.14);
 }
 if(material.biomes){
  const kind=Number(material.biomes.biome[i]),tree=Number(material.biomes.treePotential[i]);
  if(!Number.isInteger(kind)||kind<0||kind>=BIOME_COLORS.length||!Number.isFinite(tree))throw Error('Invalid 3D biome color fields');
  color=mix(color,BIOME_COLORS[kind],.72);
  if(kind>=2)color=mix(color,[48,112,72],clamp(tree)*.12);
 }
 if(material.vegetation){
  const canopy=Number(material.vegetation.canopyCover[i]),ground=Number(material.vegetation.groundCover[i]);
  if(!Number.isFinite(canopy)||!Number.isFinite(ground))throw Error('Invalid 3D vegetation color fields');
  color=mix(color,[45,104,65],clamp(canopy)*.75);
  color=mix(color,[115,151,78],clamp(ground)*.27*(1-clamp(canopy)*.6));
 }
 // The water geometry is rendered separately, and these colors should not
 // invent vegetation on a deep ocean or on top of freshwater lake surfaces.
 if(material.water[i])color=[77,116,125];
 else if(material.biomes?.biome[i]===1)color=[76,144,163];
 return color.map(c=>clamp(c/255));
}

export function buildTerrainSiteColors(mesh,material){
 if(!material)return null;
 const n=mesh?.cells?.length||0;
 if(!n)throw Error('Missing 3D material mesh');
 const fields=[material.water,material.climate?.meanTemp,material.climate?.moisture,
  material.soils?.soilType,material.soils?.fertility,
  material.biomes?.biome,material.biomes?.treePotential,
  material.vegetation?.canopyCover,material.vegetation?.groundCover];
 if(fields.some(field=>field&&field.length!==n))throw Error('3D appearance fields do not match Voronoi cells');
 if(fields.slice(0,3).some(field=>!field))throw Error('3D appearance requires climate and water fields');
 const result=new Float32Array(n*3);
 for(let i=0;i<n;i++)result.set(terrainMaterialAtSite(material,i),i*3);
 return result;
}

/** Smooth spatial sampling uses the same compact-support neighborhood as
 * elevation. The source cell categories never become visible polygon edges. */
export function sampleTerrainColor(sampler,siteColors,x,y){
 let weight=0,r=0,g=0,b=0;
 const found=visitTerrainSites(sampler,x,y,(i,w)=>{
  weight+=w;
  const k=i*3;r+=siteColors[k]*w;g+=siteColors[k+1]*w;b+=siteColors[k+2]*w;
 });
 if(found&&weight>1e-15)return [r/weight,g/weight,b/weight];
 // For the rare sparse boundary gap, match sampleElevation's nearest-site
 // fallback rather than manufacturing a dark border at the world edge.
 const k=nearestTerrainSite(sampler,x,y)*3;
 return [siteColors[k],siteColors[k+1],siteColors[k+2]];
}
