import {advanceLodMorph,advanceDetailMorph,morphWeight} from './terrain-3d-morph.js';
import {lodStepForDistance,adaptiveTileLod,tileVisibleInFrustum} from './terrain-3d-lod.js';
import {cameraRay,pickTerrainRay,surfaceHeightAt,fitTerrainCamera,orbitEye,pickRenderedRay,createLakeHeightLookup,clearTerrainEye,gridTriangleHeight,gridCrossingTimes} from './terrain-3d-focus.js';
import {closeUpCameraLimits,planFocusedTerrainTiles,DETAIL_CACHE_BYTE_BUDGET,DETAIL_TRIANGLE_BUDGET,focusedTileTriangles} from './terrain-3d-detail.js';
/** Offline WebGL2 elevation viewer, intentionally independent of Three.js/CDNs.
 * The Web Worker prepares a fixed height mesh; WebGL2 supplies perspective,
 * smooth lighting, water and interactive level-of-detail index buffers.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function vectorNormalize(v){const size=Math.hypot(...v)||1;return v.map(x=>x/size);}
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}

export function perspectiveMatrix(fov,aspect,near,far){
 const f=1/Math.tan(fov/2),range=1/(near-far);
 return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*range,-1,0,0,2*far*near*range,0]);
}
export function lookAtMatrix(eye,center){
 const z=vectorNormalize(eye.map((v,i)=>v-center[i]));
 const x=vectorNormalize(cross([0,1,0],z));
 const y=cross(z,x);
 return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);
}
export function multiplyMatrices(a,b){
 const out=new Float32Array(16);
 for(let c=0;c<4;c++)for(let r=0;r<4;r++){
  let sum=0;for(let k=0;k<4;k++)sum+=a[k*4+r]*b[c*4+k];out[c*4+r]=sum;
 }
 return out;
}
export function meshLod(distance){return lodStepForDistance(distance);}

export const TERRAIN_VERTEX_SHADER=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aElevation;
layout(location=3) in vec3 aMaterial;
uniform mat4 uCamera;
uniform highp int uWater;
uniform float uHeightMultiplier;
uniform int uMorphMode;
uniform int uMorphFrom;
uniform int uMorphTo;
uniform float uMorphWeight;
uniform float uBaseHeightScale;
uniform float uMaterialStrength;
uniform vec2 uPlane;
uniform highp sampler2DArray uTerrainFields;
uniform highp sampler2DArray uMaterialFields;
out vec3 vMaterial;
out vec3 vNormal;
out vec3 vPosition;
out float vElevation;
// Sample the base triangulation, including its diagonal, not a bilinear
// height texture. Local morph endpoints therefore meet the base triangles.
vec4 triangleField(highp sampler2DArray field,vec2 grid,int layer){
 ivec2 size=textureSize(field,0).xy;
 ivec2 cell=clamp(ivec2(floor(grid)),ivec2(0),size-ivec2(2));
 vec2 f=clamp(grid-vec2(cell),0.0,1.0);
 vec4 a=texelFetch(field,ivec3(cell,layer),0);
 vec4 b=texelFetch(field,ivec3(cell+ivec2(1,0),layer),0);
 vec4 c=texelFetch(field,ivec3(cell+ivec2(0,1),layer),0);
 vec4 d=texelFetch(field,ivec3(cell+ivec2(1,1),layer),0);
 return f.x+f.y<=1.0?a+(b-a)*f.x+(c-a)*f.y:d+(c-d)*(1.0-f.x)+(b-d)*(1.0-f.y);
}
void main(){
 vec3 position=vec3(aPosition.x,aPosition.y*uHeightMultiplier,aPosition.z);
 vNormal=normalize(vec3(aNormal.x*uHeightMultiplier,aNormal.y,aNormal.z*uHeightMultiplier));
 vMaterial=aMaterial;
 vPosition=position;
 // Water carries its unexaggerated elevation for optical depth.
 vElevation=uWater!=0&&uBaseHeightScale>0.0?aPosition.y/uBaseHeightScale:aElevation;
 if(uMorphMode!=0){
  vec2 grid=(aPosition.xz/uPlane+.5)*vec2(textureSize(uTerrainFields,0).xy-ivec2(1));
  vec4 sourceField,destField;
  vec3 fromMaterial=aMaterial,toMaterial=aMaterial;
  if(uMorphMode==1){
   ivec2 vertex=ivec2(round(grid));
   sourceField=texelFetch(uTerrainFields,ivec3(vertex,uMorphFrom),0);
   destField=texelFetch(uTerrainFields,ivec3(vertex,uMorphTo),0);
   if(uMaterialStrength>0.0){
    fromMaterial=texelFetch(uMaterialFields,ivec3(vertex,uMorphFrom),0).rgb;
    toMaterial=texelFetch(uMaterialFields,ivec3(vertex,uMorphTo),0).rgb;
   }
  }else{
   sourceField=triangleField(uTerrainFields,grid,0);
   destField=vec4(aElevation,aNormal);
   if(uMaterialStrength>0.0)fromMaterial=triangleField(uMaterialFields,grid,0).rgb;
  }
  vec4 blended=mix(sourceField,destField,uMorphWeight);
  position.y=blended.x*uBaseHeightScale*uHeightMultiplier;
  vPosition=position;vElevation=blended.x;
  vNormal=normalize(vec3(blended.y*uHeightMultiplier,blended.z,blended.w*uHeightMultiplier));
  vMaterial=mix(fromMaterial,toMaterial,uMorphWeight);
 }
 gl_Position=uCamera*vec4(position,1.0);
}`;
export const TERRAIN_FRAGMENT_SHADER=`#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vMaterial;
in vec3 vPosition;
in float vElevation;
uniform highp int uWater;
uniform vec3 uEye;
uniform float uSeaLevel;
uniform float uMaterialStrength;
uniform vec2 uPlane;
uniform float uWorldScale;
uniform highp sampler2DArray uSurfaceMaterials;
uniform highp sampler2DArray uTerrainFields;
uniform int uHasDepthField;
out vec4 fragColor;
vec3 colorRamp(float h){
 if(h<-.28)return mix(vec3(.12,.26,.28),vec3(.25,.42,.39),smoothstep(-1.5,-.28,h));
 if(h<0.0)return mix(vec3(.25,.42,.39),vec3(.61,.65,.49),smoothstep(-.28,.0,h));
 if(h<.14)return mix(vec3(.44,.57,.36),vec3(.50,.62,.40),smoothstep(.0,.14,h));
 if(h<.42)return mix(vec3(.50,.62,.40),vec3(.57,.55,.40),smoothstep(.14,.42,h));
 if(h<.82)return mix(vec3(.57,.55,.40),vec3(.60,.55,.48),smoothstep(.42,.82,h));
 return mix(vec3(.60,.55,.48),vec3(.91,.93,.92),smoothstep(.82,1.4,h));
}
float surfaceHash(vec2 p){
 return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);
}
float surfaceNoise(vec2 p){
 vec2 i=floor(p),f=fract(p);
 f=f*f*(3.0-2.0*f);
 return mix(mix(surfaceHash(i),surfaceHash(i+vec2(1.0,0.0)),f.x),
            mix(surfaceHash(i+vec2(0.0,1.0)),surfaceHash(i+vec2(1.0,1.0)),f.x),f.y);
}
// Soft irregular crown clusters, not individual trees or generated vegetation.
// Four neighboring centers are sufficient because each lobe has compact
// support and its jitter is bounded away from the lattice edge.
float canopyPattern(vec2 p){
 vec2 base=floor(p-.5);
 float crown=0.0;
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  vec2 cell=base+vec2(float(x),float(y));
  vec2 jitter=vec2(surfaceHash(cell),surfaceHash(cell+vec2(19.0,37.0)))-.5;
  vec2 delta=p-(cell+vec2(.5)+jitter*.20);
  float radius=.28+.08*surfaceHash(cell+vec2(7.0,13.0));
  crown=max(crown,1.0-smoothstep(radius*.45,radius,length(delta)));
 }
 return crown-.18;
}
// The base terrain texture already contains the unscaled elevation field.
// Use the same triangle diagonal as the mesh rather than averaging four
// corners. Local refinement can differ away from protected shorelines.
float bedElevation(){
 ivec2 size=textureSize(uTerrainFields,0).xy;
 vec2 grid=clamp(vPosition.xz/uPlane+.5,0.0,1.0)*vec2(size-1);
 ivec2 cell=clamp(ivec2(floor(grid)),ivec2(0),size-2);
 vec2 f=clamp(grid-vec2(cell),0.0,1.0);
 float a=texelFetch(uTerrainFields,ivec3(cell,0),0).x;
 float b=texelFetch(uTerrainFields,ivec3(cell+ivec2(1,0),0),0).x;
 float c=texelFetch(uTerrainFields,ivec3(cell+ivec2(0,1),0),0).x;
 float d=texelFetch(uTerrainFields,ivec3(cell+ivec2(1,1),0),0).x;
 return f.x+f.y<=1.0?a+(b-a)*f.x+(c-a)*f.y:d+(c-d)*(1.0-f.x)+(b-d)*(1.0-f.y);
}
// Restrained distance haze, strongest at grazing angles. Scene-space
// distances keep the overview readable even for very large worlds.
vec3 atmosphere(vec3 color,vec3 view,float distanceToEye){
 float horizon=1.0-smoothstep(.12,.85,abs(view.y));
 float haze=smoothstep(.35,7.0,distanceToEye)*(.10+.26*horizon);
 return mix(color,vec3(.48,.58,.64),haze);
}
float specularLight(vec3 n,vec3 sun,vec3 view,float roughness){
 vec3 halfVector=sun+view;
 float halfLength=length(halfVector);
 float alignment=halfLength>0.0001?max(dot(n,halfVector/halfLength),0.0):0.0;
 float exponent=mix(110.0,5.0,roughness*roughness);
 return pow(alignment,exponent)*max(dot(n,sun),0.0);
}
vec3 shadeWater(int kind,vec3 sun,vec3 view){
 bool river=kind==2;
 // Optical depth is based on stored elevations, never the relief slider.
 // Rivers are decals, so use a small representative optical depth rather
 // than measuring the zero distance between a ribbon and its terrain.
 float depth=river?.002:(kind==1?.22:.018);
 if(!river&&uHasDepthField!=0)depth=max(0.0,vElevation-bedElevation());
 float absorption=1.0-exp(-depth*(kind==1?5.0:22.0));
 vec3 shallow=kind==1?vec3(.24,.57,.56):vec3(.23,.50,.45);
 vec3 deep=kind==1?vec3(.045,.19,.30):vec3(.065,.26,.33);
 vec3 body=mix(shallow,deep,absorption);
 if(river)body=vec3(.18,.48,.56);
 // Filter small static ripples in physical horizontal coordinates. No
 // animated simulation or continuous redraw is needed for a still camera.
 vec2 p=vPosition.xz/max(uWorldScale,1e-8);
 float footprint=max(length(dFdx(p)),length(dFdy(p)));
 float fade=1.0-smoothstep(.1,.65,footprint*.65);
 vec3 n=vec3(0.0,1.0,0.0);
 if(fade>.001){
  float a=sin(dot(p,vec2(.58,.37))*6.2831853);
  float b=sin(dot(p,vec2(-.23,.71))*6.2831853);
  n=normalize(vec3(a*.065*fade,1.0,b*.05*fade));
 }
 float facing=clamp(dot(n,view),0.0,1.0);
 float fresnel=.045+.55*pow(1.0-facing,5.0);
 float glint=specularLight(n,sun,view,river?.47:.31)*.22;
 vec3 reflectedSky=vec3(.47,.61,.70);
 return mix(body,reflectedSky,fresnel)+glint*vec3(1.0,.94,.82);
}
void main(){
 vec3 sun=normalize(vec3(-.52,.80,.32));
 vec3 eyeDelta=uEye-vPosition;
 float distanceToEye=length(eyeDelta);
 vec3 view=eyeDelta/max(distanceToEye,.0001);
 // Solid water avoids visibility depending on draw order or background
 // color. Depth tint simulates absorption rather than alpha blending.
 if(uWater==2){
  fragColor=vec4(atmosphere(shadeWater(2,sun,view),view,distanceToEye),1.0);
  return;
 }
 if(uWater==3){
  fragColor=vec4(atmosphere(shadeWater(3,sun,view),view,distanceToEye),1.0);
  return;
 }
 if(uWater==1){
  fragColor=vec4(atmosphere(shadeWater(1,sun,view),view,distanceToEye),1.0);
  return;
 }
 vec3 n=normalize(vNormal);
 // Steeper faces reveal more rock; heights stay a continuous scalar field.
 float relativeHeight=vElevation-uSeaLevel;
 vec3 albedo=mix(colorRamp(relativeHeight),vMaterial,uMaterialStrength);
 float exposed=(1.0-smoothstep(.30,.80,n.y))*smoothstep(.02,.7,relativeHeight);
 albedo=mix(albedo,vec3(.48,.46,.42),exposed*.34);
 // The coverage field is independent of global/local mesh topology. Its
 // texel centers correspond exactly to geographic grid sample positions.
 vec4 substrate,cover;
 if(uMaterialStrength>0.0){
  vec2 size=vec2(textureSize(uSurfaceMaterials,0).xy);
  vec2 uv=((vPosition.xz/uPlane+.5)*(size-1.0)+.5)/size;
  substrate=texture(uSurfaceMaterials,vec3(uv,0.0));
  cover=texture(uSurfaceMaterials,vec3(uv,1.0));
 }else{
  // Before climate, classify only from the available terrain height/slope.
  float snow=smoothstep(.82,1.40,relativeHeight);
  float rock=max(exposed,smoothstep(.35,.9,relativeHeight))*(1.0-snow);
  float sand=(1.0-smoothstep(.015,.16,relativeHeight))*(1.0-snow)*(1.0-rock);
  float soil=(1.0-snow-rock-sand)*.55;
  substrate=vec4(rock,sand,soil,max(0.0,1.0-snow-rock-sand-soil));
  cover=vec4(0.0,snow,0.0,0.0);
  float submerged=1.0-smoothstep(-.02,0.0,relativeHeight);
  substrate*=1.0-submerged;cover=mix(cover,vec4(0.0,0.0,0.0,1.0),submerged);
 }
 // Each environment has a distinct color/texture response. These patterns
 // are decorative surface materials, NOT newly generated landforms.
 // Use physical horizontal coordinates so changing relief or LOD cannot
 // stretch textures or cause them to swim across the terrain.
 vec2 position=vPosition.xz/uWorldScale;
 float footprint=max(length(dFdx(position)),length(dFdy(position)));
 float broad=1.0-smoothstep(.22,.78,footprint*.16);
 float fine=1.0-smoothstep(.22,.78,footprint*.75);
 float rippleFade=1.0-smoothstep(.17,.50,footprint*.41);
 float micro=1.0-smoothstep(.22,.78,footprint*2.8);
 float crownFade=1.0-smoothstep(.18,.55,footprint*1.4);
 float rock=substrate.x,sand=substrate.y,soil=substrate.z,grass=substrate.w;
 float forest=cover.x,snow=cover.y,wetland=cover.z;
 vec3 tint=rock*vec3(.51,.49,.46)+sand*vec3(.82,.73,.54)+soil*vec3(.59,.48,.35)+grass*vec3(.55,.64,.33)
           +forest*vec3(.24,.43,.26)+snow*vec3(.91,.94,.94)+wetland*vec3(.35,.47,.35);
 float terrestrial=max(0.0,1.0-cover.w);
 if(terrestrial>.0001)albedo=mix(albedo,tint/terrestrial,.23*terrestrial);
 float detail=0.0;
 if(broad>.001){
  float hills=surfaceNoise(position*.16)-.5;
  // Crown clusters, irregular damp patches, and long broken rock strata.
  float crowns=smoothstep(.27,.73,hills+.5)-.5;
  float damp=smoothstep(.37,.63,hills+.5)-.5;
  float strata=surfaceNoise(vec2(position.x*.09+position.y*.045,position.y*.31))-.5;
  detail+=broad*(rock*strata*.30+sand*hills*.10+soil*hills*.18+grass*hills*.23+forest*crowns*.40+snow*hills*.07+wetland*damp*.32);
 }
 if(fine>.001){
  float grains=surfaceNoise(position*.75)-.5;
  float canopy=smoothstep(.28,.72,grains+.5)-.5;
  detail+=fine*(rock*grains*.24+sand*grains*.10+soil*grains*.25+grass*grains*.28+forest*canopy*.30+snow*grains*.045+wetland*grains*.13);
 }
 if(rippleFade>.001){
  float ripple=sin((position.x*.15+position.y*.38)*6.2831853+surfaceNoise(position*.035)*2.5);
  detail+=sand*ripple*.075*rippleFade;
 }
 if(crownFade>.001&&forest>.005){
  detail+=forest*canopyPattern(position*1.4)*.27*crownFade;
 }
 if(micro>.001){
  float flecks=surfaceNoise(position*2.8)-.5;
  float blades=surfaceNoise(vec2(position.x*2.8+position.y*.4,position.y*1.3))-.5;
  detail+=micro*(rock*flecks*.15+sand*flecks*.11+soil*flecks*.20+grass*blades*.23+forest*flecks*.09+snow*flecks*.025+wetland*flecks*.07);
 }
 // Damp and snow surfaces are deliberately smoother; forest canopy and
 // coarse rock retain more contrast. Submerged terrain stays neutral.
 albedo*=clamp(1.0+detail,.70,1.30);
 // Material-dependent roughness: moist soil and wetlands reflect more
 // light than dry soil, grass, or forest. Keep highlights subtle at map scale.
 float roughness=rock*.76+sand*.86+soil*.89+grass*.91+forest*.93+snow*.64+wetland*.42+cover.w*.78;
 roughness=clamp(roughness,.38,.96);
 float diffuse=max(dot(n,sun),0.0);
 float sky=smoothstep(-.15,1.0,n.y);
 // Work in an approximate linear-light space; avoid excessively dark
 // shadowed slopes, and separate the cool sky from warmer direct sunlight.
 vec3 irradiance=mix(vec3(.29,.28,.26),vec3(.46,.51,.58),sky)
                 +diffuse*vec3(.66,.60,.51);
 float spec=specularLight(n,sun,view,roughness)*mix(.015,.075,1.0-roughness);
 vec3 lit=sqrt(clamp(albedo*albedo*irradiance+spec*vec3(1.0,.94,.83),0.0,1.0));
 fragColor=vec4(atmosphere(lit,view,distanceToEye),1.0);
}`;

function compile(gl,kind,source){
 const shader=gl.createShader(kind);gl.shaderSource(shader,source);gl.compileShader(shader);
 if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
  const log=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error(`3D shader compilation failed: ${log}`);
 }
 return shader;
}
function program(gl){
 const vert=compile(gl,gl.VERTEX_SHADER,TERRAIN_VERTEX_SHADER),frag=compile(gl,gl.FRAGMENT_SHADER,TERRAIN_FRAGMENT_SHADER);
 const p=gl.createProgram();gl.attachShader(p,vert);gl.attachShader(p,frag);gl.linkProgram(p);
 gl.deleteShader(vert);gl.deleteShader(frag);
 if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const log=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw Error(`3D program link failed: ${log}`);}
 return p;
}

export class Terrain3DViewer{
 constructor(canvas,{onStatus=()=>{}}={}){
  this.canvas=canvas;
  this.onStatus=onStatus;
  this.disposed=false;this.lost=false;this.worker=null;this.gl=null;this.surface=null;this.label='Elevation';
  this.pitch=.93;this.yaw=-.69;this.distance=7.5;this.target=[0,0,0];this.mode='orbit';
  this.pointers=new Map();this.gesture=null;this.pendingFrame=0;this.tileLodHistory=new Map();
  this.tapStart=null;this.lastTap=null;this.lastFocusTime=-Infinity;this.fitActive=false;this.renderedFrame=null;
  // Height control is viewer-only. Saved elevation and GPU buffers stay unchanged.
  this.heightSteps=0;this.heightMultiplier=1;this.heightTimer=null;this.heightStateCallback=null;
  this.detailWorker=null;this.detailState=null;this.detailSignature='';this.detailPatches=new Map();this.activeDetailIds=new Set();this.detailSource=null;this.detailFailure=null;
  this.onLost=e=>{e.preventDefault();this.lost=true;this.renderedFrame=null;this.clearanceCache=null;
   this.detailWorker?.terminate();this.detailWorker=null;this.detailState=null;this.detailSignature='';
   this.onStatus('Graphics context interrupted');};
  this.onRestored=()=>{this.lost=false;if(this.surface){this._initializeGL();this._uploadSurface();this.drawSoon();}};
  canvas.addEventListener('webglcontextlost',this.onLost);
  canvas.addEventListener('webglcontextrestored',this.onRestored);
  this.onPointerDown=e=>this.pointerDown(e);
  this.onPointerMove=e=>this.pointerMove(e);
  this.onPointerUp=e=>this.pointerUp(e);
  this.onWheel=e=>{e.preventDefault();this.zoom(Math.exp(clamp(e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?this.canvas.clientHeight||400:1),-500,500)*.001),{x:e.clientX,y:e.clientY});};
  this.onDoubleTap=e=>{if(e.detail>=2)this.focusAt(e.clientX,e.clientY);};
  canvas.addEventListener('pointerdown',this.onPointerDown);
  canvas.addEventListener('pointermove',this.onPointerMove);
  canvas.addEventListener('pointerup',this.onPointerUp);
  canvas.addEventListener('pointercancel',this.onPointerUp);
  canvas.addEventListener('lostpointercapture',this.onPointerUp);
  canvas.addEventListener('wheel',this.onWheel,{passive:false});
  canvas.addEventListener('dblclick',this.onDoubleTap);
  this.resizeObserver=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>{if(this.fitActive)this._fitCamera();this.drawSoon();}):null;
  this.resizeObserver?.observe(canvas);
 }
 async initialize(geometry,mesh,elevations,options={}){
  if(this.disposed)return;
  this.label=options.label||'Elevation';
  const seaLevel=Number(options.seaLevel??0);
  if(!Number.isFinite(seaLevel))throw Error('Invalid 3D sea level');
  this.onStatus(`Preparing ${this.label.toLowerCase()} mesh…`);
  const surface=await new Promise((resolve,reject)=>{
   let worker;
   let settled=false;
   const finish=(error,result)=>{
    if(settled)return;
    settled=true;
    worker?.terminate();
    if(this.worker===worker)this.worker=null;
    this.cancelInitialization=null;
    if(error)reject(error);else resolve(result);
   };
   // A closed viewer must settle its build promise, not leave it holding
   // world arrays and a suspended async stack indefinitely.
   this.cancelInitialization=()=>{
    const error=new Error('3D viewer closed');error.name='AbortError';
    finish(error);
   };
   try{
    worker=new Worker(new URL('./terrain-3d-worker.js',import.meta.url),{type:'module'});
    this.worker=worker;
    worker.onmessage=({data})=>{
     if(this.disposed)return;
     if(data.kind==='progress')this.onStatus(`Building surface: ${Math.round(data.value*100)}%`);
     else if(data.kind==='success')finish(null,data.result);
     else finish(Error(data.message||'Elevation mesh failed'));
    };
    worker.onerror=e=>finish(Error(e.message||'3D worker failed'));
    worker.postMessage({geometry,mesh,elevations,seaLevel,hydrology:options.hydrology||null,
     waterMask:options.waterMask||null,appearance:options.appearance||null});
   }catch(error){finish(error);}
  });
  if(this.disposed)return;
  this.surface=surface;this.lakeHeightAt=createLakeHeightLookup(surface);
  this.detailSource={geometry,mesh,elevations,appearance:options.appearance||null,waterMask:options.waterMask||null,seaLevel,hydrology:options.hydrology||null};
  this.detailLimits=closeUpCameraLimits(surface.siteSpacing);
  this._initializeGL();
  this._uploadSurface();
  this.resetCamera();
  this.onStatus(`${this.label} terrain · ${surface.materialName||'Elevation'} materials · ${surface.cols} × ${surface.rows} grid`);
 }
 _initializeGL(){
  const gl=this.canvas.getContext('webgl2',{alpha:false,depth:true,antialias:true,powerPreference:'high-performance'});
  if(!gl)throw Error('WebGL2 is unavailable. Try Safari 26+ with hardware acceleration enabled.');
  this.gl=gl;this.resources=[];
  this.detailPatches=new Map();this.activeDetailIds=new Set();this.detailSignature='';this.detailTiles=[];this.detailPlan=new Map();this.detailState=null;this.detailFailure=null;this.tileLodHistory=new Map();
  this.program=program(gl);
  this.cameraLocation=gl.getUniformLocation(this.program,'uCamera');
  this.waterLocation=gl.getUniformLocation(this.program,'uWater');
  this.eyeLocation=gl.getUniformLocation(this.program,'uEye');
  this.seaLocation=gl.getUniformLocation(this.program,'uSeaLevel');
  this.materialLocation=gl.getUniformLocation(this.program,'uMaterialStrength');
  this.heightLocation=gl.getUniformLocation(this.program,'uHeightMultiplier');
  this.surfaceMaterialLocation=gl.getUniformLocation(this.program,'uSurfaceMaterials');
  this.worldScaleLocation=gl.getUniformLocation(this.program,'uWorldScale');
  this.depthFieldLocation=gl.getUniformLocation(this.program,'uHasDepthField');
  this.surfacePlaneLocation=gl.getUniformLocation(this.program,'uPlane');
  this.morphLocations=Object.fromEntries(['Mode','From','To','Weight','BaseHeightScale','Plane','TerrainFields','MaterialFields'].map(name=>[name,gl.getUniformLocation(this.program,`u${name.startsWith('Base')||name==='Plane'||name.endsWith('Fields')?name:'Morph'+name}`)]));
  this.morphTextures=null;this.globalMorphs=new Map();this.detailDraining=false;
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(.039,.105,.146,1);
 }
 _uploadSurface(){
  const gl=this.gl,s=this.surface;
  this.terrainVAO=gl.createVertexArray();gl.bindVertexArray(this.terrainVAO);
  this.terrainVBO=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.terrainVBO);
  gl.bufferData(gl.ARRAY_BUFFER,s.vertexData,gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);
  gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,28,12);
  gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,1,gl.FLOAT,false,28,24);
  if(s.materialColors?.length===s.vertexCount*3){
   this.materialVBO=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.materialVBO);
   gl.bufferData(gl.ARRAY_BUFFER,s.materialColors,gl.STATIC_DRAW);
   gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,3,gl.FLOAT,false,12,0);
  }else{gl.disableVertexAttribArray(3);gl.vertexAttrib3f(3,0,0,0);this.materialVBO=null;}
  this.levelBuffers=[];
  for(const level of s.levels){
   const buffer=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer);
   gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,level.indices,gl.STATIC_DRAW);
   this.levelBuffers.push({buffer,count:level.indices.length,step:level.step,tiles:level.tiles||null});
  }
  this._uploadMorphFields();
  this._uploadSurfaceMaterials();
  this.uniformLevelBuffers=[];
  for(const level of this.morphTextures?[]:s.uniformLevels||[]){
   const buffer=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer);
   gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,level.indices,gl.STATIC_DRAW);
   this.uniformLevelBuffers.push({buffer,count:level.indices.length,step:level.step});
  }
  this.waterVAO=gl.createVertexArray();gl.bindVertexArray(this.waterVAO);
  this.waterVBO=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.waterVBO);
  gl.bufferData(gl.ARRAY_BUFFER,s.ocean,gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
  gl.disableVertexAttribArray(1);gl.vertexAttrib3f(1,0,1,0);
  gl.disableVertexAttribArray(2);gl.vertexAttrib1f(2,0);
  gl.disableVertexAttribArray(3);gl.vertexAttrib3f(3,0,0,0);
  // Separate arrays for channels and lakes share the position-only water shader.
  this.hydroGeometry=[];
  for(const [kind,vertices] of [[2,s.hydrology?.rivers],[3,s.hydrology?.lakes]]){
   if(!vertices?.length)continue;
   const vao=gl.createVertexArray();gl.bindVertexArray(vao);
   const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
   gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
   gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
   gl.disableVertexAttribArray(1);gl.vertexAttrib3f(1,0,1,0);
   gl.disableVertexAttribArray(2);gl.vertexAttrib1f(2,0);
   gl.disableVertexAttribArray(3);gl.vertexAttrib3f(3,0,0,0);
   this.hydroGeometry.push({kind,vao,buffer,count:vertices.length/3});
  }
  gl.bindVertexArray(null);
 }
 /** One immutable, linearly filtered RGBA8 array, shared by all meshes. */
 _uploadSurfaceMaterials(){
  const gl=this.gl,field=this.surface.surfaceMaterials;
  const texture=gl.createTexture();this.surfaceMaterialTexture=texture;
  gl.activeTexture(gl.TEXTURE0+2);gl.bindTexture(gl.TEXTURE_2D_ARRAY,texture);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  // A complete neutral texture is required for the elevation-only shader too.
  gl.texImage3D(gl.TEXTURE_2D_ARRAY,0,gl.RGBA8,field?.width||1,field?.height||1,2,0,gl.RGBA,gl.UNSIGNED_BYTE,field?.data||new Uint8Array([0,0,0,0,0,0,0,255]));
  gl.activeTexture(gl.TEXTURE0);
 }
 /** Shared immutable references. No per-frame geometry uploads. */
 _uploadMorphFields(){
  const gl=this.gl,s=this.surface,fields=s.morphFields;
  if(!fields)return;
  const texture=(data,unit)=>{
   const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D_ARRAY,t);
   gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
   gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
   gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   gl.texImage3D(gl.TEXTURE_2D_ARRAY,0,gl.RGBA32F,s.cols+1,s.rows+1,fields.layers,0,gl.RGBA,gl.FLOAT,data);
   return t;
  };
  const terrain=texture(fields.terrain,0),material=fields.material?texture(fields.material,1):null;
  this.morphTextures={terrain,material};
  // A complete dummy binding is needed even without material data.
  gl.activeTexture(gl.TEXTURE0+1);gl.bindTexture(gl.TEXTURE_2D_ARRAY,material||terrain);
  gl.activeTexture(gl.TEXTURE0);
 }
 _setMorph(mode,from=0,to=0,weight=1){
  if(!this.morphTextures)return;
  const gl=this.gl,l=this.morphLocations;
  gl.uniform1i(l.Mode,mode);
  if(mode){gl.uniform1i(l.From,from);gl.uniform1i(l.To,to);gl.uniform1f(l.Weight,weight);}
 }
 /** Fade an old patch to the base before replacing its GPU allocation.
  * Keep retiring patches only when the new plan has budget for them. */
 _updateFocusedMorphs(now){
  const plan=this.detailPlan||new Map(),tiles=this.detailTiles||[];
  let spare=DETAIL_TRIANGLE_BUDGET-tiles.reduce((sum,t)=>sum+focusedTileTriangles(t),0);
  let animating=false;
  for(const [id,p] of this.detailPatches){
   const desired=plan.get(id),exact=desired===p.subdivisions;
   const global=this.globalMorphs?.get(id);
   // A rapid jump from overview to close-up must finish the global
   // transition to step 1 before the local patch takes over.
   if(exact&&!p.visible&&global&&(global.from!==1||global.to!==1)){
    p.phase=0;p.morphTime=null;animating=true;continue;
   }
   const tile=tiles.find(t=>t.id===id),reserved=tile?focusedTileTriangles(tile):0;
   const extra=Math.max(0,p.count/3-reserved);
   const retiring=!exact&&p.visible&&p.phase>0&&extra<=spare;
   if(retiring)spare-=extra;
   if(!exact&&!retiring){p.phase=0;p.visible=false;p.morphTime=null;continue;}
   p.phase=advanceDetailMorph(p.phase,p.morphTime,exact,now);p.morphTime=now;
   p.visible=exact||p.phase>0;
   if(!p.visible)p.morphTime=null;
   if(exact?p.phase<1:p.phase>0)animating=true;
  }
  if(this.detailDraining&&![...this.detailPatches.values()].some(p=>p.visible)){
   this._releaseFocusedPatches();this.detailDraining=false;
  }
  this._trimFocusedPatches();this._dispatchFocusedDetail();
  return animating;
 }
 /** Release only focused refinement buffers; the global terrain remains. */
 _deleteFocusedPatch(id){
  const gl=this.gl,p=this.detailPatches.get(id);
  if(!p)return;
  if(gl&&!this.lost){
   gl.deleteBuffer(p.vbo);gl.deleteBuffer(p.ibo);
   if(p.materialVBO)gl.deleteBuffer(p.materialVBO);
   gl.deleteVertexArray(p.vao);
  }
  this.detailPatches.delete(id);this.clearanceCache=null;
 }
 _releaseFocusedPatches(){
  for(const id of [...this.detailPatches.keys()])this._deleteFocusedPatch(id);
  this.activeDetailIds?.clear();
 }
 /** One long-lived, immutable close-up source per zoom session. The worker
  * receives full world data only once; subsequent requests are tile IDs and
  * bounds. While busy, camera motion replaces the pending request rather
  * than building an ever-growing queue of obsolete meshes. */
 _requestFocusedDetail(camera,width,height){
  if(!this.surface||!this.detailSource||this.disposed||this.lost)return;
  const close=this.distance<=(this.detailLimits?.detailDistance||.25);
  // Tests and direct callers can omit the matrices; use the same camera
  // projection as draw() with a portrait viewport in that case.
  if(close&&!camera){
   width=width||390;height=height||700;
   const eye=Number.isFinite(this.pitch)&&Number.isFinite(this.yaw)?this._cameraEye():orbitEye(this.target,this.distance,this.pitch??.93,this.yaw??-.69);
   camera=multiplyMatrices(perspectiveMatrix(.77,width/height,Math.max(.00035,Math.min(.04,this.distance*.045)),100),lookAtMatrix(eye,this.target));
  }
  const tiles=close?planFocusedTerrainTiles(this.surface,{camera,width,height,heightMultiplier:this.heightMultiplier??1,
   previous:this.detailPlan||new Map()}):[];
  const signature=tiles.map(tile=>`${tile.id}:${tile.subdivisions}`).join(',');
  if(signature===this.detailSignature)return;
  this.detailSignature=signature;
  this.activeDetailIds=new Set(tiles.map(tile=>tile.id));
  this.detailTiles=tiles;
  this.detailPlan=new Map(tiles.map(tile=>[tile.id,tile.subdivisions]));
  if(!tiles.length){
   this.detailWorker?.terminate();this.detailWorker=null;this.detailState=null;
   if(this.morphTextures)this.detailDraining=true;else this._releaseFocusedPatches();
   return;
  }
  this.detailDraining=false;
  for(const id of this.activeDetailIds){
   if(this.detailPatches.has(id)){
    const cached=this.detailPatches.get(id);
    this.detailPatches.delete(id);this.detailPatches.set(id,cached);
   }
  }
  this._trimFocusedPatches();
  if(this.detailFailure)return;
  if(!this.detailWorker)this._startDetailWorker();
  this._dispatchFocusedDetail();
 }
 _startDetailWorker(){
  let worker;
  try{
   worker=new Worker(new URL('./terrain-3d-worker.js',import.meta.url),{type:'module'});
   const source=this.detailSource,s=this.surface;
   this.detailWorker=worker;
   this.detailState={ready:false,busy:false,key:''};
   worker.onmessage=({data})=>{
    if(this.disposed||this.lost||this.detailWorker!==worker)return;
    if(data.kind==='detail-ready'){
     this.detailState.ready=true;
     this._dispatchFocusedDetail();
    }else if(data.kind==='detail'){
     if(!this.detailState.busy||data.key!==this.detailState.key)return;
     this.detailState.busy=false;
     // A response belongs to its dispatched request, not necessarily the
     // newest camera plan. Keep only tiles still required at the exact LOD.
     {
      try{
       const requested=this.detailState.requested||[];
       if(data.patches.length!==requested.length)throw Error('Incomplete close-up tile response');
       for(let k=0;k<data.patches.length;k++){
        const tile=requested[k];
        const patch=data.patches[k];
        if(patch.subdivisions!==tile.subdivisions||patch.x0!==tile.x0||patch.x1!==tile.x1||patch.y0!==tile.y0||patch.y1!==tile.y1||
           patch.indices.length/3>focusedTileTriangles(tile))throw Error('Unexpected close-up mesh resolution');
        if(this.detailPlan?.get(tile.id)===tile.subdivisions&&this.detailPatches.get(tile.id)?.subdivisions!==tile.subdivisions)
         this._uploadFocusedPatch(tile.id,patch);
       }
       this._trimFocusedPatches();
       this.drawSoon();
      }catch(error){this._failFocusedDetail(error.message);return;}
     }
     // This may dispatch a newer region chosen while the worker was busy.
     this._dispatchFocusedDetail();
    }else if(data.kind==='error')this._failFocusedDetail(data.message);
   };
   worker.onerror=e=>{if(this.detailWorker===worker)this._failFocusedDetail(e.message||'worker failed');};
   worker.postMessage({kind:'init-detail',...source,grid:{cols:s.cols,rows:s.rows,
    planeWidth:s.planeWidth,planeDepth:s.planeDepth,heightScale:s.heightScale,insideMask:s.insideMask,riverMask:s.hydrology?.riverMask||null}});
  }catch(error){
   worker?.terminate();this._failFocusedDetail(error.message);
  }
 }
 _dispatchFocusedDetail(){
  const state=this.detailState;
  if(!state?.ready||state.busy||!this.detailWorker||this.disposed||this.lost)return;
  const missing=(this.detailTiles||[]).filter(tile=>{
   const p=this.detailPatches.get(tile.id);
   return p?.subdivisions!==tile.subdivisions&&!(this.morphTextures&&p?.visible&&p.phase>0);
  });
  if(!missing.length)return;
  state.busy=true;
  state.key=this.detailSignature;
  state.requested=missing;
  try{this.detailWorker.postMessage({kind:'detail',key:state.key,tiles:missing});}
  catch(error){this._failFocusedDetail(error.message);}
 }
 _uploadFocusedPatch(id,patch){
  const gl=this.gl;
  this._deleteFocusedPatch(id);
  const vao=gl.createVertexArray();gl.bindVertexArray(vao);
  const vbo=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
  gl.bufferData(gl.ARRAY_BUFFER,patch.vertexData,gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);
  gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,28,12);
  gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,1,gl.FLOAT,false,28,24);
  let materialVBO=null;
  if(patch.materialColors){
   materialVBO=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,materialVBO);
   gl.bufferData(gl.ARRAY_BUFFER,patch.materialColors,gl.STATIC_DRAW);
   gl.enableVertexAttribArray(3);gl.vertexAttribPointer(3,3,gl.FLOAT,false,12,0);
  }else{gl.disableVertexAttribArray(3);gl.vertexAttrib3f(3,0,0,0);}
  const ibo=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,patch.indices,gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  this.detailPatches.set(id,{vao,vbo,materialVBO,ibo,count:patch.indices.length,subdivisions:patch.subdivisions,
   bytes:patch.vertexData.byteLength+patch.indices.byteLength+(patch.materialColors?.byteLength||0),
   pickBounds:patch.pickBounds,
   vertexData:patch.vertexData,indices:patch.indices,x0:patch.x0,y0:patch.y0,x1:patch.x1,y1:patch.y1,phase:0,morphTime:null,visible:false});
 }
 // A cached lower-resolution patch can remain visible during an upgrade.
 // A higher-resolution patch must not exceed the new plan's budget: fall back
 // to the global mesh until its smaller replacement is ready.
 _activeFocusedPatch(id){
  const desired=this.detailPlan?.get(id),patch=this.detailPatches?.get(id);
  if(this.morphTextures)return patch?.visible?patch:null;
  return desired&&patch&&patch.subdivisions<=desired?patch:null;
 }
 _trimFocusedPatches(){
  let bytes=0;
  for(const patch of this.detailPatches.values())bytes+=patch.bytes||0;
  while(bytes>DETAIL_CACHE_BYTE_BUDGET||this.detailPatches.size>32){
   const old=[...this.detailPatches.keys()].find(id=>!this._activeFocusedPatch(id)&&(!this.morphTextures||this.detailPlan?.get(id)!==this.detailPatches.get(id)?.subdivisions));
   if(old===undefined)break; // the active geometry is independently bounded
   bytes-=this.detailPatches.get(old).bytes||0;
   this._deleteFocusedPatch(old);
  }
 }
 _failFocusedDetail(message){
  this.detailFailure=message||'worker failed';
  this.detailWorker?.terminate();this.detailWorker=null;this.detailState=null;
  this.onStatus(`Close-up refinement unavailable: ${this.detailFailure}`);
 }

 /** Each step is exactly one factor of 1.05 from the unmodified world-aware
  * relief scale. Updating the label does not redraw until the user stops
  * tapping for 2 seconds. The GPU transforms all terrain and water together.
  */
 queueHeightStep(direction,onState=()=>{}){
  if(this.disposed||![1,-1].includes(direction))return;
  this.heightSteps=(this.heightSteps||0)+direction;
  this.heightStateCallback=onState;
  if(this.heightTimer!==null)clearTimeout(this.heightTimer);
  onState(this.heightSteps,true);
  this.heightTimer=setTimeout(()=>{
   this.heightTimer=null;
   if(this.disposed)return;
   this.applyHeightSteps();
   this.heightStateCallback?.(this.heightSteps,false);
  },2000);
 }
 applyHeightSteps(){
  if(this.disposed)return;
  const next=Math.pow(1.05,this.heightSteps||0);
  if(!Number.isFinite(next)||next<=0)return;
  const previous=this.heightMultiplier||1;
  this.heightMultiplier=next;
  // Preserve an existing local terrain focus when its Y position changes.
  if(this.target) this.target[1]*=next/previous;
  if(this.fitActive)this._fitCamera();
  this.lastDrawStatus='';
  this.drawSoon();
 }
 _fitCamera(){
  const rect=this.canvas?.getBoundingClientRect?.();
  const fitted=fitTerrainCamera(this.surface,this.pitch,this.yaw,(rect?.width||390)/(rect?.height||650),this.heightMultiplier||1);
  this.target=fitted.target;this.distance=fitted.distance;
 }
 resetCamera(){
  this.pitch=.94;this.yaw=-.72;this.fitActive=true;this.tileLodHistory?.clear();
  this._fitCamera();this.drawSoon();
 }
 setMode(mode){this.mode=mode==='pan'?'pan':'orbit';}
 _heightAt(x,z){
  const s=this.surface;if(!s)return null;
  const base=surfaceHeightAt(s,x,z);
  const lake=this.lakeHeightAt?.(x,z)??null;
  if(base===null&&lake===null)return null;
  let h=base??-Infinity;
  const gx=(x/s.planeWidth+.5)*s.cols,gz=(z/s.planeDepth+.5)*s.rows;
  // Active refined grids use the same diagonal and blend as the GPU.
  if(base!==null)for(const id of this.detailPatches?.keys()||[]){
   const patch=this._activeFocusedPatch(id);
   if(!patch?.vertexData||gx<patch.x0||gz<patch.y0||gx>patch.x1||gz>patch.y1)continue;
   const n=patch.subdivisions;
   const fine=gridTriangleHeight(patch.vertexData,(patch.x1-patch.x0)*n,(patch.y1-patch.y0)*n,(gx-patch.x0)*n,(gz-patch.y0)*n);
   if(fine!==null){
    const weight=this.morphTextures?morphWeight(patch.phase??1):1;
    h=h+(fine-h)*weight;
   }
  }
  const sea=(s.seaLevel||0)*(s.heightScale??0);
  return Math.max(h,sea,lake??-Infinity)*(this.heightMultiplier||1);
 }
 _cameraEye(){
  const eye=orbitEye(this.target,this.distance,this.pitch,this.yaw);
  if(!this.surface||this.distance>.65||!this.surface.vertexData){this.clearanceCache=null;return eye;}
  const active=[];
  for(const id of this.detailPatches?.keys()||[]){const p=this._activeFocusedPatch(id);if(p?.vertexData)active.push(p,p.phase);}
  const key=[this.surface,...this.target,...eye,this.distance,this.heightMultiplier,...active];
  const cached=this.clearanceCache;
  if(cached&&key.length===cached.key.length&&key.every((v,i)=>v===cached.key[i]))return cached.eye.slice();
  const spacing=Math.min(this.surface.planeWidth/this.surface.cols,this.surface.planeDepth/this.surface.rows);
  const s=this.surface,toGrid=p=>[(p[0]/s.planeWidth+.5)*s.cols,(p[2]/s.planeDepth+.5)*s.rows];
  const a=toGrid(this.target),b=toGrid(eye),crossings=gridCrossingTimes(a,b,s.cols,s.rows);
  let detail=1;
  for(const id of this.detailPatches?.keys()||[]){
   const patch=this._activeFocusedPatch(id);if(!patch?.vertexData)continue;
   const n=patch.subdivisions,toLocal=p=>[(p[0]-patch.x0)*n,(p[1]-patch.y0)*n];
   detail=Math.max(detail,n);
   crossings.push(...gridCrossingTimes(toLocal(a),toLocal(b),(patch.x1-patch.x0)*n,(patch.y1-patch.y0)*n));
  }
  const corrected=clearTerrainEye(eye,this.target,(x,z)=>this._heightAt(x,z),spacing/detail,Math.max(.0004,this.distance*.025),crossings);
  this.clearanceCache={key,eye:corrected};return corrected.slice();
 }
 _maximumDistance(){
  const rect=this.canvas?.getBoundingClientRect?.();
  return Math.max(32,this.distance||0,fitTerrainCamera(this.surface,this.pitch,this.yaw,(rect?.width||390)/(rect?.height||650),this.heightMultiplier||1).distance);
 }
 _followTerrain(){
  if(!this.surface||this.distance>.65)return;
  const ground=this._heightAt(this.target[0],this.target[2]);
  if(ground!==null)this.target[1]=ground;
 }
 _planePoint(point,planeY){
  const rect=this.canvas?.getBoundingClientRect?.();if(!rect||!(rect.height>0&&rect.width>0))return null;
  const eye=this._cameraEye(),ray=cameraRay(eye,this.target,point.x-(rect.left||0),point.y-(rect.top||0),rect.width,rect.height);
  if(!ray||ray[1]>=-.035)return null;
  const t=(planeY-eye[1])/ray[1];
  if(t<0||t>this.distance*8)return null;
  return [eye[0]+ray[0]*t,eye[2]+ray[2]*t];
 }
 _translateTarget(dx,dz){
  this.target[0]=clamp(this.target[0]+dx,-(this.surface?.planeWidth||4.8)*.7,(this.surface?.planeWidth||4.8)*.7);
  this.target[2]=clamp(this.target[2]+dz,-(this.surface?.planeDepth||4.8)*.7,(this.surface?.planeDepth||4.8)*.7);
 }
 zoom(factor,anchor=null){
  if(!Number.isFinite(factor)||factor<=0||factor===1)return;
  this.fitActive=false;
  const plane=this.target[1],before=anchor&&this._planePoint(anchor,plane);
  this.distance=clamp(this.distance*factor,this.detailLimits?.minimumDistance||.008,this._maximumDistance());
  const after=before&&this._planePoint(anchor,plane);
  if(after)this._translateTarget(before[0]-after[0],before[1]-after[1]);
  this._followTerrain();this.drawSoon();
 }
 pan(dx,dy,previous=null,next=null){
  if(dx===0&&dy===0)return;
  this.fitActive=false;
  const before=previous&&this._planePoint(previous,this.target[1]),after=next&&this._planePoint(next,this.target[1]);
  if(before&&after)this._translateTarget(before[0]-after[0],before[1]-after[1]);
  else{
   const height=this.canvas?.getBoundingClientRect?.().height||460;
   const span=2*this.distance*Math.tan(.77/2)/height;
   const right=[Math.cos(this.yaw),-Math.sin(this.yaw)],up=[-Math.sin(this.yaw),-Math.cos(this.yaw)];
   this._translateTarget(-dx*right[0]*span+dy*up[0]*span,-dx*right[1]*span+dy*up[1]*span);
  }
  this._followTerrain();this.drawSoon();
 }
 _pinchState(){
  if(this.pointers.size!==2)return null;
  const [a,b]=[...this.pointers.values()];
  return {distance:Math.hypot(a.x-b.x,a.y-b.y),middle:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};
 }
 pointerDown(e){
  if(this.disposed||(e.pointerType==='mouse'&&e.button!=null&&e.button!==0))return;
  e.preventDefault();this.canvas.setPointerCapture?.(e.pointerId);
  if(this.pointers.size===0)this.tapStart={x:e.clientX,y:e.clientY,time:performance.now(),type:e.pointerType,moved:false};
  else{this.tapStart=null;this.lastTap=null;}
  this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});this.gesture=this._pinchState();
 }
 pointerMove(e){
  const previous=this.pointers.get(e.pointerId);if(!previous||this.disposed)return;
  const next={x:e.clientX,y:e.clientY};this.pointers.set(e.pointerId,next);
  if(this.tapStart&&!this.tapStart.moved){
   if(Math.hypot(e.clientX-this.tapStart.x,e.clientY-this.tapStart.y)>8){this.tapStart.moved=true;this.lastTap=null;}
   else if(this.tapStart.type!=='mouse')return;
  }
  if(next.x===previous.x&&next.y===previous.y)return;
  if(this.pointers.size===1){
   const dx=next.x-previous.x,dy=next.y-previous.y;
   if(this.mode==='pan')this.pan(dx,dy,previous,next);
   else{this.fitActive=false;this.yaw-=dx*.009;this.pitch=clamp(this.pitch+dy*.006,.14,1.48);this.drawSoon();}
  }else if(this.pointers.size===2){
   const {distance,middle}=this._pinchState();
   if(this.gesture){
    if(this.gesture.distance>0)this.zoom(clamp(this.gesture.distance/Math.max(1,distance),.65,1.5),this.gesture.middle);
    this.pan(middle.x-this.gesture.middle.x,middle.y-this.gesture.middle.y,this.gesture.middle,middle);
   }
   this.gesture={distance,middle};
  }
 }
 pointerUp(e){
  if(!this.pointers.has(e.pointerId))return;
  const cancelled=e.type==='pointercancel'||e.type==='lostpointercapture';
  if(cancelled)this.lastTap=null;
  if(!cancelled&&this.pointers.size===1&&this.tapStart&&!this.tapStart.moved&&
     performance.now()-this.tapStart.time<400&&this.tapStart.type!=='mouse'){
   const now=performance.now(),prior=this.lastTap;
   if(prior&&now-prior.time<340&&Math.hypot(e.clientX-prior.x,e.clientY-prior.y)<28){
    this.focusAt(e.clientX,e.clientY);this.lastTap=null;
   }else this.lastTap={x:e.clientX,y:e.clientY,time:now};
  }
  this.pointers.delete(e.pointerId);this.gesture=this._pinchState();this.tapStart=null;
  if(this.canvas.hasPointerCapture?.(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);
 }
 /** Focus on the first visible terrain surface under a double-tap/click. */
 focusAt(clientX,clientY){
  if(!this.surface||this.disposed||this.lost)return false;
  const now=performance.now();if(this.lastFocusTime>0&&now-this.lastFocusTime<140)return false;
  const rect=this.canvas.getBoundingClientRect();
  const x=clientX-rect.left,y=clientY-rect.top;
  if(!(rect.width>0&&rect.height>0)||!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>rect.width||y>rect.height)return false;
  const frame=this.renderedFrame,eye=frame?.eye||this._cameraEye(),target=frame?.target||this.target;
  const aspect=frame?.aspect||rect.width/rect.height;
  const ray=cameraRay(eye,target,x/rect.width*aspect,y/rect.height,aspect,1);
  const point=ray&&(frame?pickRenderedRay(this.surface,frame,eye,ray):pickTerrainRay(this.surface,eye,ray,this.heightMultiplier||1));
  if(!point)return false;
  this.fitActive=false;this.target=point;this.distance=clamp(this.distance*.78,this.detailLimits?.minimumDistance||.008,this._maximumDistance());
  this.lastFocusTime=now;this.drawSoon();return true;
 }

 drawSoon(){
  if(this.disposed||this.pendingFrame||!this.gl||this.lost||!this.surface)return;
  this.pendingFrame=requestAnimationFrame(()=>{this.pendingFrame=0;this.draw();});
 }
 draw(){
  const gl=this.gl,s=this.surface;
  if(this.disposed||!gl||!s||this.lost)return;
  const bounds=this.canvas.getBoundingClientRect();
  const dpr=Math.min(1.75,window.devicePixelRatio||1),width=Math.max(1,Math.round(bounds.width*dpr)),height=Math.max(1,Math.round(bounds.height*dpr));
  if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
  gl.viewport(0,0,width,height);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  const eye=this._cameraEye();
  const near=Math.max(.00035,Math.min(.04,this.distance*.045));
  const far=Math.max(100,Math.hypot(...eye)+Math.max(s.planeWidth,s.planeDepth,Math.abs(s.minY||0)*(this.heightMultiplier||1),Math.abs(s.maxY||0)*(this.heightMultiplier||1))*3);
  const projection=perspectiveMatrix(.77,width/height,near,far);
  // Store lightweight references to exactly the draws in this frame. The
  // buffers are immutable; a picking gesture never needs GPU readback.
  const frame={eye,target:this.target.slice(),multiplier:this.heightMultiplier||1,terrain:[],aspect:width/height,near,far};
  const record=(level,start,count,morph=null)=>{if(level?.indices)frame.terrain.push({indices:level.indices,start,count,morph,pickBounds:level.pickBounds});};
  const view=lookAtMatrix(eye,this.target),camera=multiplyMatrices(projection,view);
  gl.useProgram(this.program);gl.uniformMatrix4fv(this.cameraLocation,false,camera);gl.uniform3fv(this.eyeLocation,new Float32Array(eye));
  gl.uniform1f(this.seaLocation,s.seaLevel||0);
  gl.uniform1f(this.materialLocation,s.materialColors?.length?0.88:0);
  gl.uniform1f(this.heightLocation,this.heightMultiplier??1);
  if(this.surfaceMaterialTexture){
   gl.uniform1i(this.surfaceMaterialLocation,2);
   gl.uniform1f(this.worldScaleLocation,s.worldScale);
   gl.uniform2f(this.surfacePlaneLocation,s.planeWidth,s.planeDepth);
  }
  gl.uniform1i(this.depthFieldLocation,this.morphTextures?1:0);
  const now=performance.now();let animating=false;
  if(this.morphTextures){
   const l=this.morphLocations;
   gl.uniform1i(l.TerrainFields,0);gl.uniform1i(l.MaterialFields,1);
   gl.uniform1f(l.BaseHeightScale,s.heightScale);gl.uniform2f(l.Plane,s.planeWidth,s.planeDepth);
   this._setMorph(0);
  }
  const selected=meshLod(this.distance);
  gl.uniform1i(this.waterLocation,0);
  gl.disable(gl.BLEND);gl.depthMask(true);
  gl.bindVertexArray(this.terrainVAO);
  this._requestFocusedDetail(camera,width,height);
  if(this.morphTextures)animating=this._updateFocusedMorphs(now);
  const activePatches=[...(this.detailPatches||new Map()).keys()].map(id=>this._activeFocusedPatch(id)).filter(Boolean);
  const hasFocused=activePatches.length>0;
  const tiled=this.levelBuffers,baseline=tiled.find(level=>level.step===1);
  let selectedTriangles=0,finest=8,coarsest=1;
  if(baseline?.tiles?.length){
   const span=Math.max(s.planeWidth/s.cols,s.planeDepth/s.rows)*32;
   // Determine LOD for each tile before drawing. When every tile requests
   // the same settled detail, a single draw batches the stitched indices.
   const history=this.tileLodHistory||(this.tileLodHistory=new Map());
   const selectedSteps=baseline.tiles.map(tile=>{
    const step=adaptiveTileLod(eye,tile,span,history.get(tile.id));
    history.set(tile.id,step);return step;
   });
   const morphs=this.morphTextures?baseline.tiles.map((tile,i)=>{
    // Local refinement uses the base (step 1) surface as its bridge.
    const desired=this._activeFocusedPatch(tile.id)||this.detailPlan?.has(tile.id)?1:selectedSteps[i];
    const state=advanceLodMorph(this.globalMorphs.get(tile.id),desired,now);
    this.globalMorphs.set(tile.id,state);
    if(state.from!==state.to)animating=true;
    return state;
   }):null;
   const drawSteps=morphs?morphs.map(m=>m.from===m.to?m.to:1):selectedSteps;
   finest=Math.min(...drawSteps);coarsest=Math.max(...drawSteps);
   // Use the identical stitched mesh in batched and mixed-detail paths.
   const uniform=finest===coarsest&&!hasFocused&&!morphs?.some(m=>m.from!==m.to)&&this.distance>(this.detailLimits?.detailDistance||.25)?
    (this.morphTextures?tiled:this.uniformLevelBuffers)?.find(level=>level.step===finest):null;
   if(uniform){
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,uniform.buffer);
    gl.drawElements(gl.TRIANGLES,uniform.count,gl.UNSIGNED_INT,0);
    selectedTriangles=uniform.count/3;
    record((this.morphTextures?s.levels:s.uniformLevels)?.find(l=>l.step===finest),0,uniform.count);
   }else{
    let currentStep=0;
    for(let i=0;i<baseline.tiles.length;i++){
     const tile=baseline.tiles[i];
     if(this._activeFocusedPatch(tile.id))continue;
     // The full elevation range makes this culling conservative even when a
     // tile contains steep mountains. Invisible tiles need no GPU draw call.
     const scale=this.heightMultiplier||1;
     const visibleTile=scale===1?tile:{...tile,minY:tile.minY*scale,maxY:tile.maxY*scale};
     if(!tileVisibleInFrustum(camera,visibleTile,s))continue;
     const m=morphs?.[i];
     if(m&&m.from!==m.to)this._setMorph(1,Math.log2(m.from),Math.log2(m.to),morphWeight(m.phase));
     else this._setMorph(0);
     const step=drawSteps[i],level=tiled.find(row=>row.step===step)||baseline;
     const range=level.tiles?.[i];if(!range?.count)continue;
     if(currentStep!==step){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,level.buffer);currentStep=step;}
     gl.drawElements(gl.TRIANGLES,range.count,gl.UNSIGNED_INT,range.offset*4);
     selectedTriangles+=range.count/3;
     record(s.levels?.find(l=>l.step===step),range.offset,range.count,m&&m.from!==m.to?{mode:1,from:Math.log2(m.from),to:Math.log2(m.to),weight:morphWeight(m.phase)}:null);
    }
   }
  }else{
   const level=tiled.find(row=>row.step===selected)||tiled[0];
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,level.buffer);
   gl.drawElements(gl.TRIANGLES,level.count,gl.UNSIGNED_INT,0);
   selectedTriangles=level.count/3;finest=coarsest=level.step;
   record(s.levels?.find(l=>l.step===level.step),0,level.count);
  }
  if(hasFocused){
   for(const patch of activePatches){
    this._setMorph(patch.phase<1?2:0,0,0,morphWeight(patch.phase??1));
    gl.bindVertexArray(patch.vao);
    gl.drawElements(gl.TRIANGLES,patch.count,gl.UNSIGNED_INT,0);
    selectedTriangles+=patch.count/3;
    if(patch.vertexData&&patch.indices)frame.terrain.push({vertexData:patch.vertexData,indices:patch.indices,pickBounds:patch.pickBounds,count:patch.count,morph:this.morphTextures&&patch.phase<1?{mode:2,weight:morphWeight(patch.phase)}:null});
   }
  }
  // Coplanar decals use a depth-buffer bias, not a physical height offset.
  // Draw water afterward so it covers submerged portions of lake outlets.
  this._setMorph(0);
  // All water is opaque with optical depth shading. Write depth so near
  // water correctly occludes more distant water and river surfaces.
  gl.disable(gl.BLEND);gl.depthMask(true);
  for(const water of this.hydroGeometry||[]){
   if(water.kind!==2)continue;
   gl.uniform1i(this.waterLocation,2);
   gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-1,-1);
   gl.bindVertexArray(water.vao);gl.drawArrays(gl.TRIANGLES,0,water.count);
   gl.disable(gl.POLYGON_OFFSET_FILL);
  }
  gl.uniform1i(this.waterLocation,1);
  gl.bindVertexArray(this.waterVAO);gl.drawArrays(gl.TRIANGLES,0,s.ocean.length/3);
  for(const water of this.hydroGeometry||[]){
   if(water.kind!==3)continue;
   gl.uniform1i(this.waterLocation,3);
   gl.bindVertexArray(water.vao);gl.drawArrays(gl.TRIANGLES,0,water.count);
  }
  gl.depthMask(true);gl.disable(gl.BLEND);gl.bindVertexArray(null);
  this.renderedFrame=frame;
  const detail=finest===coarsest?`LOD ${finest}`:`Adaptive LOD ${finest}–${coarsest}`;
  const subdivisions=activePatches.map(p=>p.subdivisions);
  const detailRange=hasFocused?(Math.min(...subdivisions)===Math.max(...subdivisions)?`${subdivisions[0]}×`:`${Math.min(...subdivisions)}–${Math.max(...subdivisions)}×`):'';
  const closeDetail=hasFocused?` · ${detailRange} close-up (${activePatches.length} tiles)` :
   this.detailWorker?' · refining close-up…':this.detailFailure?' · close-up unavailable':'';
  const status=`${this.label} · ${detail}${closeDetail} · ${selectedTriangles.toLocaleString()} terrain tris · ${s.hydrology?.riverSegments||0} river tris`;
  if(status!==this.lastDrawStatus){this.lastDrawStatus=status;this.onStatus(status);}
  if(animating)this.drawSoon();
 }
 dispose(){
  if(this.disposed)return;
  this.disposed=true;
  if(this.heightTimer!==null){clearTimeout(this.heightTimer);this.heightTimer=null;}
  this.heightStateCallback=null;
  if(this.pendingFrame)cancelAnimationFrame(this.pendingFrame);
  this.cancelInitialization?.();
  this.worker?.terminate();this.worker=null;
  this.detailWorker?.terminate();this.detailWorker=null;this.detailState=null;
  this._releaseFocusedPatches();this.detailSource=null;
  this.resizeObserver?.disconnect();
  const c=this.canvas;
  c.removeEventListener('webglcontextlost',this.onLost);c.removeEventListener('webglcontextrestored',this.onRestored);
  c.removeEventListener('pointerdown',this.onPointerDown);c.removeEventListener('pointermove',this.onPointerMove);
  c.removeEventListener('pointerup',this.onPointerUp);c.removeEventListener('pointercancel',this.onPointerUp);c.removeEventListener('lostpointercapture',this.onPointerUp);
  this.renderedFrame=null;this.clearanceCache=null;this.lakeHeightAt=null;this.pointers?.clear();
  c.removeEventListener('wheel',this.onWheel);c.removeEventListener('dblclick',this.onDoubleTap);
  const gl=this.gl;
  if(gl&&!this.lost){
   for(const b of this.levelBuffers||[])gl.deleteBuffer(b.buffer);
   for(const b of this.uniformLevelBuffers||[])gl.deleteBuffer(b.buffer);
   for(const water of this.hydroGeometry||[]){gl.deleteBuffer(water.buffer);gl.deleteVertexArray(water.vao);}
   if(this.terrainVBO)gl.deleteBuffer(this.terrainVBO);
   if(this.materialVBO)gl.deleteBuffer(this.materialVBO);
   if(this.waterVBO)gl.deleteBuffer(this.waterVBO);
   if(this.terrainVAO)gl.deleteVertexArray(this.terrainVAO);
   if(this.waterVAO)gl.deleteVertexArray(this.waterVAO);
   if(this.morphTextures){gl.deleteTexture(this.morphTextures.terrain);if(this.morphTextures.material)gl.deleteTexture(this.morphTextures.material);}
   if(this.surfaceMaterialTexture)gl.deleteTexture(this.surfaceMaterialTexture);
   if(this.program)gl.deleteProgram(this.program);
   gl.getExtension?.('WEBGL_lose_context')?.loseContext?.();
  }
  this.surfaceMaterialTexture=null;this.morphTextures=null;this.globalMorphs?.clear();
  this.surface=null;
 }
}
