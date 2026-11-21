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
