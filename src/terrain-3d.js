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
export function meshLod(distance){return distance>18?8:distance>11?4:distance>5?2:1;}

const VERTEX=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aElevation;
uniform mat4 uCamera;
out vec3 vNormal;
out vec3 vPosition;
out float vElevation;
void main(){
 vNormal=aNormal;
 vPosition=aPosition;
 vElevation=aElevation;
 gl_Position=uCamera*vec4(aPosition,1.0);
}`;
const FRAGMENT=`#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vPosition;
in float vElevation;
uniform int uWater;
uniform vec3 uEye;
uniform float uSeaLevel;
out vec4 fragColor;
vec3 colorRamp(float h){
 if(h<-.28)return mix(vec3(.12,.26,.28),vec3(.25,.42,.39),smoothstep(-1.5,-.28,h));
 if(h<0.0)return mix(vec3(.25,.42,.39),vec3(.61,.65,.49),smoothstep(-.28,.0,h));
 if(h<.14)return mix(vec3(.44,.57,.36),vec3(.50,.62,.40),smoothstep(.0,.14,h));
 if(h<.42)return mix(vec3(.50,.62,.40),vec3(.57,.55,.40),smoothstep(.14,.42,h));
 if(h<.82)return mix(vec3(.57,.55,.40),vec3(.60,.55,.48),smoothstep(.42,.82,h));
 return mix(vec3(.60,.55,.48),vec3(.91,.93,.92),smoothstep(.82,1.4,h));
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
 vec3 albedo=colorRamp(relativeHeight);
 float exposed=(1.0-smoothstep(.30,.80,n.y))*smoothstep(.02,.7,relativeHeight);
 albedo=mix(albedo,vec3(.48,.46,.42),exposed*.34);
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
 const vert=compile(gl,gl.VERTEX_SHADER,VERTEX),frag=compile(gl,gl.FRAGMENT_SHADER,FRAGMENT);
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
  this.pointers=new Map();this.gesture=null;this.pendingFrame=0;this.resources=[];
  this.onLost=e=>{e.preventDefault();this.lost=true;this.onStatus('Graphics context interrupted');};
  this.onRestored=()=>{this.lost=false;if(this.surface){this._initializeGL();this._uploadSurface();this.drawSoon();}};
  canvas.addEventListener('webglcontextlost',this.onLost);
  canvas.addEventListener('webglcontextrestored',this.onRestored);
  this.onPointerDown=e=>this.pointerDown(e);
  this.onPointerMove=e=>this.pointerMove(e);
  this.onPointerUp=e=>this.pointerUp(e);
  this.onWheel=e=>{e.preventDefault();this.zoom(Math.exp(e.deltaY*.001));};
  this.onDoubleTap=e=>{if(e.detail>=2)this.resetCamera();};
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
   const worker=new Worker(new URL('./terrain-3d-worker.js',import.meta.url),{type:'module'});
   this.worker=worker;
   worker.onmessage=({data})=>{
    if(this.disposed)return;
    if(data.kind==='progress')this.onStatus(`Building surface: ${Math.round(data.value*100)}%`);
    else if(data.kind==='success'){worker.terminate();this.worker=null;resolve(data.result);}
    else{worker.terminate();this.worker=null;reject(Error(data.message||'Elevation mesh failed'));}
   };
   worker.onerror=e=>{worker.terminate();this.worker=null;reject(Error(e.message||'3D worker failed'));};
   worker.postMessage({geometry,mesh,elevations,seaLevel,hydrology:options.hydrology||null,waterMask:options.waterMask||null});
  });
  if(this.disposed)return;
  this.surface=surface;
  this._initializeGL();
  this._uploadSurface();
  this.resetCamera();
  this.onStatus(`${this.label} terrain · ${surface.cols} × ${surface.rows} grid`);
 }
 _initializeGL(){
  const gl=this.canvas.getContext('webgl2',{alpha:false,depth:true,antialias:true,powerPreference:'high-performance'});
  if(!gl)throw Error('WebGL2 is unavailable. Try Safari 26+ with hardware acceleration enabled.');
  this.gl=gl;this.resources=[];
  this.program=program(gl);
  this.cameraLocation=gl.getUniformLocation(this.program,'uCamera');
  this.waterLocation=gl.getUniformLocation(this.program,'uWater');
  this.eyeLocation=gl.getUniformLocation(this.program,'uEye');
  this.seaLocation=gl.getUniformLocation(this.program,'uSeaLevel');
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
  this.levelBuffers=[];
  for(const level of s.levels){
   const buffer=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer);
   gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,level.indices,gl.STATIC_DRAW);
   this.levelBuffers.push({buffer,count:level.indices.length,step:level.step});
  }
  this.waterVAO=gl.createVertexArray();gl.bindVertexArray(this.waterVAO);
  this.waterVBO=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.waterVBO);
  gl.bufferData(gl.ARRAY_BUFFER,s.ocean,gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
  gl.disableVertexAttribArray(1);gl.vertexAttrib3f(1,0,1,0);
  gl.disableVertexAttribArray(2);gl.vertexAttrib1f(2,0);
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
   this.hydroGeometry.push({kind,vao,buffer,count:vertices.length/3});
  }
  gl.bindVertexArray(null);
 }
 resetCamera(){
  this.pitch=.94;this.yaw=-.72;this.target=[0,0,0];
  const span=Math.max(this.surface?.planeWidth||4.8,this.surface?.planeDepth||3.5);
  this.distance=span*1.78;
  this.drawSoon();
 }
 setMode(mode){this.mode=mode==='pan'?'pan':'orbit';}
 zoom(factor){this.distance=clamp(this.distance*factor,.65,32);this.drawSoon();}
 pan(dx,dy){
  const span=this.distance*.0017;
  const right=[Math.cos(this.yaw),-Math.sin(this.yaw)];
  const up=[-Math.sin(this.yaw),-Math.cos(this.yaw)];
  this.target[0]=clamp(this.target[0]-dx*right[0]*span+dy*up[0]*span,-(this.surface?.planeWidth||4.8)*.7,(this.surface?.planeWidth||4.8)*.7);
  this.target[2]=clamp(this.target[2]-dx*right[1]*span+dy*up[1]*span,-(this.surface?.planeDepth||4.8)*.7,(this.surface?.planeDepth||4.8)*.7);
  this.drawSoon();
 }
 pointerDown(e){
  if(this.disposed)return;
  e.preventDefault();this.canvas.setPointerCapture?.(e.pointerId);
  this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});this.gesture=null;
 }
 pointerMove(e){
  const previous=this.pointers.get(e.pointerId);if(!previous||this.disposed)return;
  const next={x:e.clientX,y:e.clientY};this.pointers.set(e.pointerId,next);
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
 pointerUp(e){this.pointers.delete(e.pointerId);this.gesture=null;if(this.canvas.hasPointerCapture?.(e.pointerId))this.canvas.releasePointerCapture(e.pointerId);}
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
  const projection=perspectiveMatrix(.77,width/height,.04,100);
  const view=lookAtMatrix(eye,this.target),camera=multiplyMatrices(projection,view);
  gl.useProgram(this.program);gl.uniformMatrix4fv(this.cameraLocation,false,camera);gl.uniform3fv(this.eyeLocation,new Float32Array(eye));
  gl.uniform1f(this.seaLocation,s.seaLevel||0);
  const selected=meshLod(this.distance);const level=this.levelBuffers.find(b=>b.step===selected)||this.levelBuffers[0];
  gl.uniform1i(this.waterLocation,0);
  gl.disable(gl.BLEND);gl.depthMask(true);
  gl.bindVertexArray(this.terrainVAO);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,level.buffer);
  gl.drawElements(gl.TRIANGLES,level.count,gl.UNSIGNED_INT,0);
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
  this.onStatus(`${this.label} · LOD ${selected===1?'High':selected===2?'Medium':'Wide'} · ${s.hydrology?.riverSegments||0} river triangles · ${s.hydrology?.lakeCells||0} lake cells`);
 }
 dispose(){
  if(this.disposed)return;
  this.disposed=true;if(this.pendingFrame)cancelAnimationFrame(this.pendingFrame);
  this.worker?.terminate();this.worker=null;this.resizeObserver?.disconnect();
  const c=this.canvas;
  c.removeEventListener('webglcontextlost',this.onLost);c.removeEventListener('webglcontextrestored',this.onRestored);
  c.removeEventListener('pointerdown',this.onPointerDown);c.removeEventListener('pointermove',this.onPointerMove);
  c.removeEventListener('pointerup',this.onPointerUp);c.removeEventListener('pointercancel',this.onPointerUp);
  c.removeEventListener('wheel',this.onWheel);c.removeEventListener('dblclick',this.onDoubleTap);
  const gl=this.gl;
  if(gl&&!this.lost){
   for(const b of this.levelBuffers||[])gl.deleteBuffer(b.buffer);
   for(const water of this.hydroGeometry||[]){gl.deleteBuffer(water.buffer);gl.deleteVertexArray(water.vao);}
   if(this.terrainVBO)gl.deleteBuffer(this.terrainVBO);
   if(this.waterVBO)gl.deleteBuffer(this.waterVBO);
   if(this.terrainVAO)gl.deleteVertexArray(this.terrainVAO);
   if(this.waterVAO)gl.deleteVertexArray(this.waterVAO);
   if(this.program)gl.deleteProgram(this.program);
   gl.getExtension?.('WEBGL_lose_context')?.loseContext?.();
  }
  this.surface=null;
 }
}
