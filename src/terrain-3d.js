import {advanceLodMorph,advanceDetailMorph,morphWeight} from './terrain-3d-morph.js';
import {lodStepForDistance,adaptiveTileLod,tileVisibleInFrustum} from './terrain-3d-lod.js';
import {cameraRay,pickTerrainRay,surfaceHeightAt} from './terrain-3d-focus.js';
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
 vElevation=aElevation;
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
uniform int uWater;
uniform vec3 uEye;
uniform float uSeaLevel;
uniform float uMaterialStrength;
uniform vec2 uPlane;
uniform float uWorldScale;
uniform highp sampler2DArray uSurfaceMaterials;
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
void main(){
 vec3 sun=normalize(vec3(-.52,.80,.32));
 if(uWater==2){
  vec3 sunlit=vec3(.12,.64,.76);
  fragColor=vec4(sunlit,1.0);
  return;
 }
 if(uWater==3){
  vec3 sunlit=vec3(.12,.43,.58);
  fragColor=vec4(sunlit,.94);
  return;
 }
 if(uWater==1){
  vec3 view=normalize(uEye-vPosition);
  float glint=pow(max(dot(reflect(-sun,vec3(0.0,1.0,0.0)),view),0.0),46.0);
  float shallow=.06*sin(vPosition.x*7.0+vPosition.z*3.0);
  fragColor=vec4(vec3(.10,.31,.43)+vec3(shallow*.15,shallow*.20,shallow*.22)+glint*vec3(.30,.36,.36),.82);
  return;
 }
 vec3 n=normalize(vNormal);
 float shade=.54+.46*max(dot(n,sun),0.0);
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
 float ambient=clamp(.88+.12*n.y,.73,1.0);
 fragColor=vec4(albedo*shade*ambient,1.0);
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
  this.tapStart=null;this.lastTap=null;this.lastFocusTime=0;
  // Height control is viewer-only. Saved elevation and GPU buffers stay unchanged.
  this.heightSteps=0;this.heightMultiplier=1;this.heightTimer=null;this.heightStateCallback=null;
  this.detailWorker=null;this.detailState=null;this.detailSignature='';this.detailPatches=new Map();this.activeDetailIds=new Set();this.detailSource=null;this.detailFailure=null;
  this.onLost=e=>{e.preventDefault();this.lost=true;
   this.detailWorker?.terminate();this.detailWorker=null;this.detailState=null;this.detailSignature='';
   this.onStatus('Graphics context interrupted');};
  this.onRestored=()=>{this.lost=false;if(this.surface){this._initializeGL();this._uploadSurface();this.drawSoon();}};
  canvas.addEventListener('webglcontextlost',this.onLost);
  canvas.addEventListener('webglcontextrestored',this.onRestored);
  this.onPointerDown=e=>this.pointerDown(e);
  this.onPointerMove=e=>this.pointerMove(e);
  this.onPointerUp=e=>this.pointerUp(e);
  this.onWheel=e=>{e.preventDefault();this.zoom(Math.exp(e.deltaY*.001));};
  this.onDoubleTap=e=>{if(e.detail>=2)this.focusAt(e.clientX,e.clientY);};
  canvas.addEventListener('pointerdown',this.onPointerDown);
  canvas.addEventListener('pointermove',this.onPointerMove);
  canvas.addEventListener('pointerup',this.onPointerUp);
  canvas.addEventListener('pointercancel',this.onPointerUp);
  canvas.addEventListener('wheel',this.onWheel,{passive:false});
  canvas.addEventListener('dblclick',this.onDoubleTap);
  this.resizeObserver=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>this.drawSoon()):null;
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
  this.surface=surface;
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
  this.detailPatches.delete(id);
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
   const pitch=this.pitch??.93,yaw=this.yaw??-.69;
   const eye=[this.target[0]+this.distance*Math.cos(pitch)*Math.sin(yaw),this.target[1]+this.distance*Math.sin(pitch),this.target[2]+this.distance*Math.cos(pitch)*Math.cos(yaw)];
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
     this.detailState.busy=false;
     const matched=data.key===this.detailSignature;
     if(matched){
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
   bytes:patch.vertexData.byteLength+patch.indices.byteLength+(patch.materialColors?.byteLength||0),phase:0,morphTime:null,visible:false});
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
  if(!(next>0)&&next!==Infinity)return;
  const previous=this.heightMultiplier||1;
  this.heightMultiplier=next;
  // Preserve an existing local terrain focus when its Y position changes.
  if(this.target) this.target[1]*=next/previous;
  this.lastDrawStatus='';
  this.drawSoon();
 }
 resetCamera(){
  this.pitch=.94;this.yaw=-.72;this.target=[0,0,0];this.tileLodHistory?.clear();
  const span=Math.max(this.surface?.planeWidth||4.8,this.surface?.planeDepth||3.5);
  this.distance=span*1.78;
  this.drawSoon();
 }
 setMode(mode){this.mode=mode==='pan'?'pan':'orbit';}
 _followTerrain(){
  if(!this.surface||this.distance>.65)return;
  const ground=surfaceHeightAt(this.surface,this.target[0],this.target[2]);
  if(ground===null)return;
  const sea=(this.surface.seaLevel||0)*(this.surface.heightScale??0);
  this.target[1]=Math.max(ground,sea)*(this.heightMultiplier||1);
 }
 zoom(factor){this.distance=clamp(this.distance*factor,this.detailLimits?.minimumDistance||.008,32);
  this._followTerrain();this.drawSoon();}
 pan(dx,dy){
  const span=this.distance*.0017;
  const right=[Math.cos(this.yaw),-Math.sin(this.yaw)];
  const up=[-Math.sin(this.yaw),-Math.cos(this.yaw)];
  this.target[0]=clamp(this.target[0]-dx*right[0]*span+dy*up[0]*span,-(this.surface?.planeWidth||4.8)*.7,(this.surface?.planeWidth||4.8)*.7);
  this.target[2]=clamp(this.target[2]-dx*right[1]*span+dy*up[1]*span,-(this.surface?.planeDepth||4.8)*.7,(this.surface?.planeDepth||4.8)*.7);
  this._followTerrain();this.drawSoon();
 }
 pointerDown(e){
  if(this.disposed)return;
  e.preventDefault();this.canvas.setPointerCapture?.(e.pointerId);
  if(this.pointers.size===0)this.tapStart={x:e.clientX,y:e.clientY,time:performance.now(),type:e.pointerType,moved:false};
  else{this.tapStart=null;this.lastTap=null;}
  this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});this.gesture=null;
 }
 pointerMove(e){
  const previous=this.pointers.get(e.pointerId);if(!previous||this.disposed)return;
  const next={x:e.clientX,y:e.clientY};this.pointers.set(e.pointerId,next);
  if(this.tapStart&&Math.hypot(e.clientX-this.tapStart.x,e.clientY-this.tapStart.y)>8){this.tapStart.moved=true;this.lastTap=null;}
  if(this.pointers.size===1){
   const dx=next.x-previous.x,dy=next.y-previous.y;
   if(this.mode==='pan')this.pan(dx,dy);
   else{this.yaw-=dx*.009;this.pitch=clamp(this.pitch+dy*.006,.14,1.48);this.drawSoon();}
  }else if(this.pointers.size===2){
   const [a,b]=[...this.pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y),middle={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
   if(this.gesture){
    if(this.gesture.distance>0)this.zoom(clamp(this.gesture.distance/Math.max(1,distance),.65,1.5));
    this.pan(middle.x-this.gesture.middle.x,middle.y-this.gesture.middle.y);
   }
   this.gesture={distance,middle};
  }
 }
 pointerUp(e){
  if(e.type!=='pointercancel'&&this.pointers.size===1&&this.tapStart&&!this.tapStart.moved&&
     performance.now()-this.tapStart.time<400&&this.tapStart.type!=='mouse'){
   const now=performance.now(),prior=this.lastTap;
   if(prior&&now-prior.time<340&&Math.hypot(e.clientX-prior.x,e.clientY-prior.y)<28){
    this.focusAt(e.clientX,e.clientY);this.lastTap=null;
   }else this.lastTap={x:e.clientX,y:e.clientY,time:now};
  }
  this.pointers.delete(e.pointerId);this.gesture=null;this.tapStart=null;
  if(this.canvas.hasPointerCapture?.(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);
 }
 /** Focus on the first visible terrain surface under a double-tap/click. */
 focusAt(clientX,clientY){
  if(!this.surface||this.disposed)return false;
  const now=performance.now();if(now-this.lastFocusTime<140)return false;
  const rect=this.canvas.getBoundingClientRect();
  const x=clientX-rect.left,y=clientY-rect.top;
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>rect.width||y>rect.height)return false;
  const cp=Math.cos(this.pitch),sp=Math.sin(this.pitch),sy=Math.sin(this.yaw),cy=Math.cos(this.yaw);
  const eye=[this.target[0]+this.distance*cp*sy,this.target[1]+this.distance*sp,this.target[2]+this.distance*cp*cy];
  const ray=cameraRay(eye,this.target,x,y,rect.width,rect.height);
  const point=ray&&pickTerrainRay(this.surface,eye,ray,this.heightMultiplier||1);
  if(!point)return false;
  this.target=point;this.distance=clamp(this.distance*.78,this.detailLimits?.minimumDistance||.008,32);
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
  const cp=Math.cos(this.pitch),sp=Math.sin(this.pitch),sy=Math.sin(this.yaw),cy=Math.cos(this.yaw);
  const eye=[this.target[0]+this.distance*cp*sy,this.target[1]+this.distance*sp,this.target[2]+this.distance*cp*cy];
  const near=Math.max(.00035,Math.min(.04,this.distance*.045));
  const projection=perspectiveMatrix(.77,width/height,near,100);
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
    }
   }
  }else{
   const level=tiled.find(row=>row.step===selected)||tiled[0];
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,level.buffer);
   gl.drawElements(gl.TRIANGLES,level.count,gl.UNSIGNED_INT,0);
   selectedTriangles=level.count/3;finest=coarsest=level.step;
  }
  if(hasFocused){
   for(const patch of activePatches){
    this._setMorph(patch.phase<1?2:0,0,0,morphWeight(patch.phase??1));
    gl.bindVertexArray(patch.vao);
    gl.drawElements(gl.TRIANGLES,patch.count,gl.UNSIGNED_INT,0);
    selectedTriangles+=patch.count/3;
   }
  }
  // Coplanar decals use a depth-buffer bias, not a physical height offset.
  // Draw water afterward so it covers submerged portions of lake outlets.
  this._setMorph(0);
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
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
  c.removeEventListener('pointerup',this.onPointerUp);c.removeEventListener('pointercancel',this.onPointerUp);
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
