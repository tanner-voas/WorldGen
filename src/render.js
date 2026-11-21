export const MIN_RENDER_STAGE=5;
export const RENDER_SIZE_OPTIONS=[1024,1536,2048,3072,4096];

const MODE_LABELS={
 natural:'Natural terrain',
 coast:'Land and sea',
 landforms:'Landforms',
 temperature:'Temperature',
 rain:'Precipitation',
 hydrology:'Hydrology',
 soils:'Soils',
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
  blend:0.55,
  relief:resolved>=4?0.6:0,
  coast:0.9,
  hydro:resolved>=9?0.95:0,
  climateTint:resolved>=8?0.18:0,
  biomeTint:resolved>=11?0.2:0,
  vegetationTint:resolved>=12?0.28:0
 };
}

export function defaultRenderMode(stage){
 if(stage>=12)return 'vegetation';
 if(stage>=11)return 'biomes';
 if(stage>=10)return 'soils';
 if(stage>=9)return 'hydrology';
 if(stage>=8)return 'temperature';
 if(stage>=6)return 'landforms';
 return 'coast';
}

export function renderModeOptions(stage){
 const ids=['natural','coast'];
 if(stage>=6)ids.push('landforms');
 if(stage>=8)ids.push('temperature','rain');
 if(stage>=9)ids.push('hydrology');
 if(stage>=10)ids.push('soils');
 if(stage>=11)ids.push('biomes');
 if(stage>=12)ids.push('vegetation');
 return ids.map(id=>[id,MODE_LABELS[id]||id]);
}

export function renderOptionSupport(stage){
 return {
  relief:stage>=4,
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
  case 'preview':return {sampleStride:2,blur:0.7,riverWidth:0.9};
  case 'high':return {sampleStride:1,blur:1.15,riverWidth:1.2};
  case 'ultra':return {sampleStride:1,blur:1.45,riverWidth:1.35};
  default:return {sampleStride:1,blur:1.0,riverWidth:1.0};
 }
}

export function clamp01(x){return Math.max(0,Math.min(1,Number(x)||0));}
