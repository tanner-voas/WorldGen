import {lodStepForDistance,adaptiveTileLod,tileVisibleInFrustum} from './terrain-3d-lod.js';
import {cameraRay,pickTerrainRay,surfaceHeightAt} from './terrain-3d-focus.js';
import {closeUpCameraLimits,focusedTerrainTiles,LOCAL_TERRAIN_SUBDIVISIONS} from './terrain-3d-detail.js';
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
out vec3 vMaterial;
out vec3 vNormal;
out vec3 vPosition;
out float vElevation;
void main(){
 vec3 position=vec3(aPosition.x,aPosition.y*uHeightMultiplier,aPosition.z);
 vNormal=normalize(vec3(aNormal.x*uHeightMultiplier,aNormal.y,aNormal.z*uHeightMultiplier));
 vMaterial=aMaterial;
 vPosition=position;
 vElevation=aElevation;
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
 // Sub-vertex detail is a stable surface *material* variation, not new
 // geographic height. Screen-space footprint suppresses high frequencies
 // when zoomed out, avoiding shimmering on mobile GPUs.
 vec2 position=vPosition.xz;
 float footprint=max(length(dFdx(position)),length(dFdy(position)));
 float broad=(1.0-smoothstep(.35,1.0,footprint*28.0));
 float fine=(1.0-smoothstep(.35,1.0,footprint*105.0));
 float grain=0.0;
 if(broad>.001)grain+=(surfaceNoise(position*28.0)-.5)*broad*.75;
 if(fine>.001)grain+=(surfaceNoise(position*105.0)-.5)*fine*.35;
 float roughness=.65+.65*clamp(1.0-n.y,0.0,1.0);
 albedo*=clamp(1.0+grain*.21*roughness,.80,1.19);
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
  this.detailSource={geometry,mesh,elevations,appearance:options.appearance||null,waterMask:options.waterMask||null,seaLevel};
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
  this.detailPatches=new Map();this.activeDetailIds=new Set();this.detailSignature='';this.detailTiles=[];this.detailState=null;this.detailFailure=null;this.tileLodHistory=new Map();
  this.program=program(gl);
  this.cameraLocation=gl.getUniformLocation(this.program,'uCamera');
  this.waterLocation=gl.getUniformLocation(this.program,'uWater');
  this.eyeLocation=gl.getUniformLocation(this.program,'uEye');
  this.seaLocation=gl.getUniformLocation(this.program,'uSeaLevel');
  this.materialLocation=gl.getUniformLocation(this.program,'uMaterialStrength');
  this.heightLocation=gl.getUniformLocation(this.program,'uHeightMultiplier');
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
  this.uniformLevelBuffers=[];
  for(const level of s.uniformLevels||[]){
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
 _requestFocusedDetail(){
  if(!this.surface||!this.detailSource||this.disposed||this.lost)return;
  const close=this.distance<=(this.detailLimits?.detailDistance||.25);
  const tiles=close?focusedTerrainTiles(this.surface,this.target):[];
  const signature=tiles.map(tile=>tile.id).join(',');
  if(signature===this.detailSignature)return;
  this.detailSignature=signature;
  this.activeDetailIds=new Set(tiles.map(tile=>tile.id));
  this.detailTiles=tiles;
  if(!tiles.length){
   this.detailWorker?.terminate();this.detailWorker=null;this.detailState=null;
   this._releaseFocusedPatches();
   return;
  }
  for(const id of this.activeDetailIds){
   if(this.detailPatches.has(id)){
    const cached=this.detailPatches.get(id);
    this.detailPatches.delete(id);this.detailPatches.set(id,cached);
   }
  }
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
        if(this.activeDetailIds.has(tile.id)&&!this.detailPatches.has(tile.id))
         this._uploadFocusedPatch(tile.id,data.patches[k]);
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
    planeWidth:s.planeWidth,planeDepth:s.planeDepth,heightScale:s.heightScale}});
  }catch(error){
   worker?.terminate();this._failFocusedDetail(error.message);
  }
 }
 _dispatchFocusedDetail(){
  const state=this.detailState;
  if(!state?.ready||state.busy||!this.detailWorker||this.disposed||this.lost)return;
  const missing=(this.detailTiles||[]).filter(tile=>!this.detailPatches.has(tile.id));
  if(!missing.length)return;
  state.busy=true;
  state.key=this.detailSignature;
  state.requested=missing;
  try{this.detailWorker.postMessage({kind:'detail',key:state.key,tiles:missing});}
  catch(error){this._failFocusedDetail(error.message);}
 }
 _uploadFocusedPatch(id,patch){
  const gl=this.gl;
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
  this.detailPatches.set(id,{vao,vbo,materialVBO,ibo,count:patch.indices.length});
 }
 _trimFocusedPatches(){
  while(this.detailPatches.size>8){
   const old=[...this.detailPatches.keys()].find(id=>!this.activeDetailIds.has(id));
   if(old===undefined)break;
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
  const selected=meshLod(this.distance);
  gl.uniform1i(this.waterLocation,0);
  gl.disable(gl.BLEND);gl.depthMask(true);
  gl.bindVertexArray(this.terrainVAO);
  this._requestFocusedDetail();
  const hasFocused=[...(this.detailPatches||new Map()).keys()].some(id=>this.activeDetailIds?.has(id));
  const tiled=this.levelBuffers,baseline=tiled.find(level=>level.step===1);
  let selectedTriangles=0,finest=8,coarsest=1;
  if(baseline?.tiles?.length){
   const span=Math.max(s.planeWidth/s.cols,s.planeDepth/s.rows)*32;
   // Determine LOD for each tile before drawing. When every tile requests
   // the same detail, a single uniform draw is substantially cheaper and
   // avoids dense stitched boundaries that are not needed in that view.
   const history=this.tileLodHistory||(this.tileLodHistory=new Map());
   const selectedSteps=baseline.tiles.map(tile=>{
    const step=adaptiveTileLod(eye,tile,span,history.get(tile.id));
    history.set(tile.id,step);return step;
   });
   finest=Math.min(...selectedSteps);coarsest=Math.max(...selectedSteps);
   const uniform=finest===coarsest&&!hasFocused?
    this.uniformLevelBuffers?.find(level=>level.step===finest):null;
   if(uniform){
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,uniform.buffer);
    gl.drawElements(gl.TRIANGLES,uniform.count,gl.UNSIGNED_INT,0);
    selectedTriangles=uniform.count/3;
   }else{
    let currentStep=0;
    for(let i=0;i<baseline.tiles.length;i++){
     const tile=baseline.tiles[i];
     if(this.activeDetailIds?.has(tile.id)&&this.detailPatches?.has(tile.id))continue;
     // The full elevation range makes this culling conservative even when a
     // tile contains steep mountains. Invisible tiles need no GPU draw call.
     const scale=this.heightMultiplier||1;
     const visibleTile=scale===1?tile:{...tile,minY:tile.minY*scale,maxY:tile.maxY*scale};
     if(!tileVisibleInFrustum(camera,visibleTile,s))continue;
     const step=selectedSteps[i],level=tiled.find(row=>row.step===step)||baseline;
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
   for(const [id,patch] of this.detailPatches){
    if(!this.activeDetailIds?.has(id))continue;
    gl.bindVertexArray(patch.vao);
    gl.drawElements(gl.TRIANGLES,patch.count,gl.UNSIGNED_INT,0);
    selectedTriangles+=patch.count/3;
   }
  }
  gl.uniform1i(this.waterLocation,1);
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
  gl.bindVertexArray(this.waterVAO);gl.drawArrays(gl.TRIANGLES,0,s.ocean.length/3);
  // Water features are draped on the terrain and never modify its height.
  // Keep depth testing so rivers cannot shine through mountains.
  for(const water of this.hydroGeometry||[]){
   gl.uniform1i(this.waterLocation,water.kind);
   gl.bindVertexArray(water.vao);gl.drawArrays(gl.TRIANGLES,0,water.count);
  }
  gl.depthMask(true);gl.disable(gl.BLEND);gl.bindVertexArray(null);
  const detail=finest===coarsest?`LOD ${finest}`:`Adaptive LOD ${finest}–${coarsest}`;
  const closeDetail=hasFocused?` · ${LOCAL_TERRAIN_SUBDIVISIONS}× close-up tiles`:
   this.detailWorker?' · refining close-up…':this.detailFailure?' · close-up unavailable':'';
  const status=`${this.label} · ${detail}${closeDetail} · ${selectedTriangles.toLocaleString()} terrain tris · ${s.hydrology?.riverSegments||0} river tris`;
  if(status!==this.lastDrawStatus){this.lastDrawStatus=status;this.onStatus(status);}
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
   if(this.program)gl.deleteProgram(this.program);
   gl.getExtension?.('WEBGL_lose_context')?.loseContext?.();
  }
  this.surface=null;
 }
}
