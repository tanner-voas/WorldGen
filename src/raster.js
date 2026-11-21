import {buildCellIndex,cellAtPoint} from './spatial.js';
import {clamp01,smoothstep,createTerrainSampler,visitTerrainSites,renderInsideGeometry,terrainTexture,coastCoverage} from './render.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function mixRgb(a,b,t){const u=clamp01(t);return [a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,a[2]+(b[2]-a[2])*u];}
function weightedSample(state,wx,wy){
 let wSum=0,land=0,elev=0,temp=0,moist=0,canopy=0,ground=0,lake=0,discharge=0,productivity=0;
 const biome=[0,0,0],veg=[0,0,0];
 const collect=(j,w)=>{
  wSum+=w;
  land+=(state.water[j]?0:1)*w;
  elev+=state.elevations[j]*w;
  if(state.climate){temp+=state.climate.meanTemp[j]*w;moist+=state.climate.moisture[j]*w;}else{temp+=12*w;moist+=0.42*w;}
  let treeHere=0.2,productivityHere=0.38;
  if(state.biomes){productivityHere=state.biomes.productivity[j];treeHere=state.biomes.treePotential[j];const rgb=state.biomeRgb[j];biome[0]+=rgb[0]*w;biome[1]+=rgb[1]*w;biome[2]+=rgb[2]*w;}
  productivity+=productivityHere*w;
  if(state.vegetation){canopy+=state.vegetation.canopyCover[j]*w;ground+=state.vegetation.groundCover[j]*w;const rgb=state.vegetationRgb[j];veg[0]+=rgb[0]*w;veg[1]+=rgb[1]*w;veg[2]+=rgb[2]*w;}
  else if(state.soils){ground+=state.soils.fertility[j]*0.55*w;canopy+=treeHere*.35*w;}
  else ground+=(state.climate?state.climate.moisture[j]:.42)*.35*w;
  if(state.hydrology){lake+=(state.hydrology.lakeId[j]>=0?1:0)*w;discharge+=Math.min(1,state.hydrology.discharge[j]/Math.max(.001,state.hydrology.summary.maxDischarge))*w;}
 };
 visitTerrainSites(state.sampler,wx,wy,collect);
 // A very sparse or highly clustered mesh can have empty sampling disks.
 // Fall back to its containing cell instead of leaving a dark rendering hole.
 if(wSum<1e-8){const owner=cellAtPoint(state.spatial,wx,wy);if(owner!==null)collect(owner,1);}
 if(wSum<1e-8)return {landFrac:0,elev:state.seaLevel-.18,tempC:8,moist:.45,canopy:0,ground:.05,biomeRgb:[146,157,124],vegetationRgb:[153,167,128],lake:0,discharge:0,productivity:.3};
 return {landFrac:land/wSum,elev:elev/wSum,tempC:temp/wSum,moist:moist/wSum,canopy:canopy/wSum,ground:ground/wSum,biomeRgb:biome.map(v=>v/wSum),vegetationRgb:veg.map(v=>v/wSum),lake:lake/wSum,discharge:discharge/wSum,productivity:productivity/wSum};
}
function climateRamp(tempNorm,moist){
 const cold=[86,120,168],temperate=[175,191,137],warm=[210,178,108],hot=[186,113,73],lush=[67,132,89];
 let rgb=tempNorm<0.45?mixRgb(cold,temperate,tempNorm/0.45):tempNorm<0.72?mixRgb(temperate,warm,(tempNorm-.45)/.27):mixRgb(warm,hot,(tempNorm-.72)/.28);
 rgb=mixRgb(rgb,lush,clamp01(moist)*0.45);
 return rgb;
}
function terrainColorFromSample(sample,state,settings){
 const mode=settings.mode||'satellite';
 const landFrac=clamp01(sample.landFrac),tempNorm=clamp01((sample.tempC+15)/50),moist=clamp01(sample.moist),vegness=clamp01(sample.ground*.55+sample.canopy*.45),landHeight=clamp01((sample.elev-state.seaLevel)/Math.max(.001,state.maxLand-state.seaLevel)),depth=clamp01((state.seaLevel-sample.elev)/Math.max(.001,state.seaLevel-state.minWater));
 let ocean=mixRgb([92,169,184],[11,59,97],Math.pow(depth,.72));
 ocean=mixRgb(ocean,[109,191,194],(1-smoothstep(.12,.62,depth))*.32);
 let color;
 if(mode==='climate')color=climateRamp(tempNorm,moist);
 else if(mode==='biomes'&&state.biomes)color=sample.biomeRgb;
 else if(mode==='vegetation'&&state.vegetation)color=sample.vegetationRgb;
 else if(mode==='relief'){
  let low=mixRgb([196,186,142],[92,130,88],moist*.65);
  low=mixRgb(low,[150,140,118],smoothstep(.38,.92,landHeight)*.72);
  color=mixRgb(low,[241,243,242],smoothstep(.82,1,landHeight));
 }else{
  let arid=mixRgb([220,203,155],[181,164,118],landHeight*.4),lush=mixRgb([122,156,97],[67,116,79],clamp01(vegness*.9+moist*.5));
  color=mixRgb(arid,lush,clamp01(moist*.95+.18*sample.productivity));
  color=mixRgb(color,[127,114,103],smoothstep(.46,.88,landHeight)*.7);
  color=mixRgb(color,[164,157,147],smoothstep(.72,1,landHeight)*.35);
  const beach=(1-smoothstep(.58,.76,landFrac))*clamp01(1-landHeight*3.2);
  color=mixRgb(color,[223,210,168],beach*.75);
  if(state.climate&&settings.climateTint>0){
   const dry=[208,176,116],wet=[78,132,111];
   color=mixRgb(color,mixRgb(dry,wet,moist),settings.climateTint*.42);
  }
  if(state.biomes&&settings.biomeTint>0)color=mixRgb(color,sample.biomeRgb,settings.biomeTint*.44);
  if(state.vegetation&&settings.vegetationTint>0)color=mixRgb(color,sample.vegetationRgb,settings.vegetationTint*.54);
  const snow=clamp01((2-sample.tempC)/18 + smoothstep(.8,1,landHeight)*.6);
  color=mixRgb(color,[242,245,244],snow);
 }
 if(mode==='hydrology'){
  color=mixRgb(color,[85,135,104],.18+.18*sample.productivity);
  color=mixRgb(color,[72,176,186],clamp01(settings.hydro*sample.discharge*.28));
 }
 const coastBlend=smoothstep(.32,.68,landFrac);
 color=mixRgb(ocean,color,coastBlend);
 if(sample.lake>0)color=mixRgb(color,[83,168,193],smoothstep(.18,.8,sample.lake)*clamp01(settings.hydro));
 return {rgb:color,surface:landFrac>=.5?landHeight:-depth*.38,landFrac};
}

// Sample the gradient in units of a cell radius, so changing PNG size or LOD
// does not change the apparent strength of the same hillside.
function shadeRow(data,surface,land,width,height,y,gainX,gainY){
 for(let x=0;x<width;x++){
  const i=y*width+x;
  if(!Number.isFinite(surface[i]))continue;
  const center=surface[i];
  const neighbor=j=>Number.isFinite(surface[j])?surface[j]:center;
  const dx=(neighbor(x+1<width?i+1:i)-neighbor(x>0?i-1:i))*gainX;
  const dy=(neighbor(y+1<height?i+width:i)-neighbor(y>0?i-width:i))*gainY;
  const limit=land[i]>.5?.26:.12;
  const light=1+clamp(-.8*dx-.6*dy,-limit,limit);
  for(let c=0;c<3;c++)data[4*i+c]*=light;
 }
}

export async function rasterize({state,settings,geometry,width,height},checkpoint){
 state={...state,sampler:createTerrainSampler(state.mesh,settings.blend),spatial:buildCellIndex(state.mesh)};
 const data=new Uint8ClampedArray(width*height*4);
 const relief=settings.relief>0;
 const surface=relief?new Float32Array(width*height):null;
 const land=relief?new Float32Array(width*height):null;
 const stepX=geometry.width/width,stepY=geometry.height/height;
 const gain=state.avgRadius*settings.relief*.5;
 const textureScale=Math.max(1,state.avgRadius*.67);
 let deadline=performance.now()+12;
 const total=height*(relief?2:1);
 for(let row=0;row<total;row++){
  if(row>=height)shadeRow(data,surface,land,width,height,row-height,gain/stepX,gain/stepY);
  else for(let x=0;x<width;x++){
   const wx=(x+.5)*stepX,wy=(row+.5)*stepY,index=row*width+x,o=index*4;
   data[o+3]=255;
   if(!renderInsideGeometry(wx,wy,geometry)){
    data[o]=11;data[o+1]=40;data[o+2]=54;
    if(relief)surface[index]=NaN;
    continue;
   }
   const sample=weightedSample(state,wx,wy);
   const detail=terrainTexture(wx,wy,textureScale)-.5;
   sample.landFrac=coastCoverage(sample.landFrac,detail,settings.blend);
   const mapped=terrainColorFromSample(sample,state,settings);
   const tint=1+detail*.15*smoothstep(.37,.8,mapped.landFrac);
   for(let c=0;c<3;c++)data[o+c]=mapped.rgb[c]*tint;
   if(relief){surface[index]=mapped.surface+detail*.035*mapped.landFrac;land[index]=mapped.landFrac;}
  }
  if(performance.now()>=deadline){
   await checkpoint((row+1)/total);
   deadline=performance.now()+12;
  }
 }
 return data;
}
