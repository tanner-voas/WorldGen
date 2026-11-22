/** Read-only 3D camera picking against the displayed height grid.
 * Picking is deliberately derived from the same vertices as the GPU surface:
 * zooming/focusing never changes source elevations, water, or checkpoints.
 */
import {insideGeometry} from './engine.js';
import {PICK_BLOCK_INDICES,pickBlockIntersects} from './terrain-pick-bounds.js';
const normalize=v=>{const length=Math.hypot(...v)||1;return v.map(x=>x/length);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

/** Construct a world-space ray using the viewer's perspective camera. */
export function cameraRay(eye,target,x,y,width,height,fov=.77){
 if(![...eye,...target,x,y,width,height,fov].every(Number.isFinite)||width<=0||height<=0||fov<=0||fov>=Math.PI)return null;
 const forward=normalize(target.map((value,i)=>value-eye[i]));
 let right=cross(forward,[0,1,0]);
 if(Math.hypot(...right)<1e-6)right=[1,0,0];
 right=normalize(right);
 const up=normalize(cross(right,forward));
 const xAngle=(2*x/width-1)*(width/height)*Math.tan(fov/2);
 const yAngle=(1-2*y/height)*Math.tan(fov/2);
 return normalize(forward.map((value,i)=>value+right[i]*xAngle+up[i]*yAngle));
}

/** Triangle height interpolation in the exact GPU vertex grid. Returns null
 * outside the generated world outline, including excluded curved-edge cells. */
export function surfaceHeightAt(surface,x,z){
 if(!surface||!Number.isFinite(x)||!Number.isFinite(z)||surface.cols<1||surface.rows<1)return null;
 const fx=(x/(surface.planeWidth||1)+.5)*surface.cols;
 const fz=(z/(surface.planeDepth||1)+.5)*surface.rows;
 if(fx<0||fz<0||fx>surface.cols||fz>surface.rows)return null;
 if(surface.outline&&!insideGeometry((fx/surface.cols)*surface.outline.width,(fz/surface.rows)*surface.outline.height,surface.outline))return null;
 const ix=Math.min(Math.floor(fx),surface.cols-1),iz=Math.min(Math.floor(fz),surface.rows-1);
 const tx=Math.min(1,fx-ix),tz=Math.min(1,fz-iz),stride=surface.cols+1;
 const corners=[iz*stride+ix,iz*stride+ix+1,(iz+1)*stride+ix,(iz+1)*stride+ix+1];
 const mask=surface.insideMask;
 if(mask&&(tx+tz<=1?[0,1,2]:[1,2,3]).some(i=>!mask[corners[i]]))return null;
 const values=corners.map(i=>surface.vertexData?.[i*7+1]);
 if(values.some(v=>!Number.isFinite(v)))return null;
 return tx+tz<=1?values[0]+(values[1]-values[0])*tx+(values[2]-values[0])*tz:values[3]+(values[2]-values[3])*(1-tx)+(values[1]-values[3])*(1-tz);
}

/** First visible intersection with terrain or the sea datum. Uses a small
 * bounded raymarch only on a focus gesture, never during animation frames. */
export function pickTerrainRay(surface,eye,direction,heightMultiplier=1){
 if(!surface||!eye||!direction||![...eye,...direction,heightMultiplier].every(Number.isFinite)||heightMultiplier<=0)return null;
 const dir=normalize(direction);
 const maxDistance=100;
 const limitTop=Math.max(surface.maxY??0,(surface.seaLevel??0)*(surface.heightScale??0))*heightMultiplier+.1;
 const limitBottom=Math.min(surface.minY??0,(surface.seaLevel??0)*(surface.heightScale??0))*heightMultiplier-.1;
 let near=0,far=maxDistance;
 if(dir[1]<-1e-5){
  near=Math.max(0,(eye[1]-limitTop)/(-dir[1]));
  far=Math.min(maxDistance,(eye[1]-limitBottom)/(-dir[1]));
  if(far<near)return null;
 }
 const planeY=(surface.seaLevel??0)*(surface.heightScale??0)*heightMultiplier;
 const at=t=>{
  const x=eye[0]+dir[0]*t,y=eye[1]+dir[1]*t,z=eye[2]+dir[2]*t;
  const h=surfaceHeightAt(surface,x,z);
  if(h===null)return null;
  return {x,y,z,gap:y-Math.max(h*heightMultiplier,planeY)};
 };
 let previous=null,previousT=near;
 for(let i=0;i<=192;i++){
  const t=near+(far-near)*i/192;
  const sample=at(t);
  if(sample&&sample.gap<=0){
   if(!previous)return null;
   let lo=previousT,hi=t;
   for(let j=0;j<12;j++){
    const mid=(lo+hi)/2,m=at(mid);
    if(!m||m.gap>0)lo=mid;else hi=mid;
   }
   const p=at(hi);
   return p?[p.x,p.y,p.z]:null;
  }
  previous=sample&&sample.gap>0?sample:null;
  previousT=t;
 }
 return null;
}

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function orbitEye(target,distance,pitch,yaw){
 return [target[0]+distance*Math.cos(pitch)*Math.sin(yaw),target[1]+distance*Math.sin(pitch),target[2]+distance*Math.cos(pitch)*Math.cos(yaw)];
}

/** Fit the full conservative world bounding box into both perspective axes.
 * A corner closer to the camera needs more distance than its projected size. */
export function fitTerrainCamera(surface,pitch,yaw,aspect,multiplier=1,fov=.77,margin=.88){
 const w=surface?.planeWidth||4.8,d=surface?.planeDepth||3.5;
 const low=(surface?.minY??0)*multiplier,high=(surface?.maxY??0)*multiplier;
 const target=[0,(low+high)/2,0],back=orbitEye([0,0,0],1,pitch,yaw);
 const right=normalize(cross([0,1,0],back)),up=cross(back,right);
 const tanY=Math.tan(fov/2)*margin,tanX=tanY*Math.max(.01,aspect||1);
 let distance=.1;
 for(const x of [-w/2,w/2])for(const y of [low,high])for(const z of [-d/2,d/2]){
  const p=[x,y-target[1],z];
  distance=Math.max(distance,dot(p,back)+Math.max(Math.abs(dot(p,right))/tanX,Math.abs(dot(p,up))/tanY)+.01);
 }
 return {target,distance};
}

/** Height on the same diagonal used by the base GPU triangulation. */
export function gridTriangleHeight(data,cols,rows,gx,gz,stride=7,component=1,offset=0){
 if(!data||gx<0||gz<0||gx>cols||gz>rows)return null;
 const x=Math.min(cols-1,Math.floor(gx)),z=Math.min(rows-1,Math.floor(gz)),u=gx-x,v=gz-z;
 const a=offset+(z*(cols+1)+x)*stride+component,b=a+stride,c=a+(cols+1)*stride,d=c+stride;
 const h=u+v<=1?data[a]+(data[b]-data[a])*u+(data[c]-data[a])*v:data[d]+(data[c]-data[d])*(1-u)+(data[b]-data[d])*(1-v);
 return Number.isFinite(h)?h:null;
}

/** Two-sided ray/triangle intersection, matching the renderer (no culling). */
function triangleDistance(eye,ray,ax,ay,az,bx,by,bz,cx,cy,cz){
 const ex=bx-ax,ey=by-ay,ez=bz-az,fx=cx-ax,fy=cy-ay,fz=cz-az;
 const px=ray[1]*fz-ray[2]*fy,py=ray[2]*fx-ray[0]*fz,pz=ray[0]*fy-ray[1]*fx;
 const det=ex*px+ey*py+ez*pz;
 if(Math.abs(det)<1e-14)return Infinity;
 const tx=eye[0]-ax,ty=eye[1]-ay,tz=eye[2]-az,inv=1/det;
 const u=(tx*px+ty*py+tz*pz)*inv;
 if(u< -1e-7||u>1+1e-7)return Infinity;
 const qx=ty*ez-tz*ey,qy=tz*ex-tx*ez,qz=tx*ey-ty*ex;
 const v=(ray[0]*qx+ray[1]*qy+ray[2]*qz)*inv;
 if(v< -1e-7||u+v>1+1e-7)return Infinity;
 const t=(fx*qx+fy*qy+fz*qz)*inv;
 return t>=0?t:Infinity;
}

/** Intersect the exact index ranges submitted for the last rendered frame.
 * Morph references match the vertex shader; water uses its actual triangles.
 * This runs only on focus gestures, never in the animation loop. */
export function pickRenderedRay(surface,frame,eye,ray){
 if(!frame||!surface||!eye||!ray)return null;
 const multiplier=frame.multiplier??1,fields=surface.morphFields?.terrain;
 const stride=surface.cols+1,layerSize=stride*(surface.rows+1)*4;
 let closest=Infinity;
 const forward=frame.target?normalize(frame.target.map((v,i)=>v-eye[i])):ray;
 const along=dot(forward,ray);
 if(along<=0)return null;
 const minimum=(frame.near??0)/along,maximum=(frame.far??Infinity)/along;
 function scan(data,indices,start,count,vertexStride,morph,bounds){
  if(!data||!count)return;
  const weight=morph?.weight??1;
  const height=(index)=>{
   const off=index*vertexStride;
   if(!morph||!fields)return data[off+1]*multiplier;
   if(morph.mode===1){
    const a=fields[morph.from*layerSize+index*4],b=fields[morph.to*layerSize+index*4];
    return (a+(b-a)*weight)*surface.heightScale*multiplier;
   }
   const gx=Math.max(0,Math.min(surface.cols,(data[off]/surface.planeWidth+.5)*surface.cols));
   const gz=Math.max(0,Math.min(surface.rows,(data[off+2]/surface.planeDepth+.5)*surface.rows));
   const a=gridTriangleHeight(fields,surface.cols,surface.rows,gx,gz,4,0);
   return ((a??data[off+6])*(1-weight)+data[off+6]*weight)*surface.heightScale*multiplier;
  };
  const end=start+count;
  for(let block=Math.floor(start/PICK_BLOCK_INDICES);block*PICK_BLOCK_INDICES<end;block++){
   if(bounds&&block*4+3<bounds.length&&!pickBlockIntersects(bounds,block*4,eye,ray,minimum,Math.min(closest,maximum)))continue;
   const last=Math.min(end,(block+1)*PICK_BLOCK_INDICES);
   for(let i=Math.max(start,block*PICK_BLOCK_INDICES);i<last;i+=3){
    const a=indices?indices[i]:i,b=indices?indices[i+1]:i+1,c=indices?indices[i+2]:i+2;
    const ai=a*vertexStride,bi=b*vertexStride,ci=c*vertexStride;
    const ax=data[ai],az=data[ai+2],bx=data[bi],bz=data[bi+2],cx=data[ci],cz=data[ci+2];
    // Cheap horizontal rejection prevents most morph work on distant tiles.
    if(Math.abs(ray[0])<1e-10&&(eye[0]<Math.min(ax,bx,cx)-1e-7||eye[0]>Math.max(ax,bx,cx)+1e-7))continue;
    if(Math.abs(ray[2])<1e-10&&(eye[2]<Math.min(az,bz,cz)-1e-7||eye[2]>Math.max(az,bz,cz)+1e-7))continue;
    // For oblique rays, reject triangles on one side of the horizontal
    // ray line before evaluating their (potentially morphed) heights.
    const sideA=(ax-eye[0])*ray[2]-(az-eye[2])*ray[0],sideB=(bx-eye[0])*ray[2]-(bz-eye[2])*ray[0],sideC=(cx-eye[0])*ray[2]-(cz-eye[2])*ray[0];
    if(Math.min(sideA,sideB,sideC)>1e-7||Math.max(sideA,sideB,sideC)<-1e-7)continue;
    const t=triangleDistance(eye,ray,ax,height(a),az,bx,height(b),bz,cx,height(c),cz);
    if(t>=minimum&&t<=maximum&&t<closest)closest=t;
   }
  }
 }
 for(const draw of frame.terrain||[])scan(draw.vertexData||surface.vertexData,draw.indices,draw.start??0,draw.count,7,draw.morph,draw.pickBounds);
 for(const [kind,water] of [["ocean",surface.ocean],["lakes",surface.hydrology?.lakes],["rivers",surface.hydrology?.rivers]])scan(water,null,0,(water?.length||0)/3,3,null,surface.waterPickBounds?.[kind]);
 return Number.isFinite(closest)?eye.map((v,i)=>v+ray[i]*closest):null;
}

/** Pre-index the actual lake triangles by their horizontal bounds; camera
 * tracking queries the local bucket, not every lake for every gesture. */
export function createLakeHeightLookup(surface){
 const vertices=surface?.hydrology?.lakes;
 if(!vertices?.length)return ()=>null;
 const buckets=new Map(),size=Math.max(surface.planeWidth/surface.cols,surface.planeDepth/surface.rows)*4;
 for(let i=0;i<vertices.length;i+=9){
  const xs=[vertices[i],vertices[i+3],vertices[i+6]],zs=[vertices[i+2],vertices[i+5],vertices[i+8]];
  for(let z=Math.floor(Math.min(...zs)/size);z<=Math.floor(Math.max(...zs)/size);z++)for(let x=Math.floor(Math.min(...xs)/size);x<=Math.floor(Math.max(...xs)/size);x++){
   const key=`${x},${z}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);
  }
 }
 return (x,z)=>{
  let height=null;
  for(const i of buckets.get(`${Math.floor(x/size)},${Math.floor(z/size)}`)||[]){
   const y=vertices[i+1],t=triangleDistance([x,y+1,z],[0,-1,0],vertices[i],y,vertices[i+2],vertices[i+3],vertices[i+4],vertices[i+5],vertices[i+6],vertices[i+7],vertices[i+8]);
   if(Number.isFinite(t))height=height===null?y:Math.max(height,y);
  }
  return height;
 };
}

/** Crossing times for the three families of grid edges, including the
 * B-C diagonal. Clip to the grid rectangle so extreme aspect ratios never
 * enumerate irrelevant out-of-world coordinates. */
export function gridCrossingTimes(a,b,cols,rows){
 const delta=[b[0]-a[0],b[1]-a[1]],times=[];
 let lo=0,hi=1;
 for(let i=0;i<2;i++){
  const max=i===0?cols:rows;
  if(Math.abs(delta[i])<1e-12){if(a[i]<0||a[i]>max)return [];continue;}
  const t0=-a[i]/delta[i],t1=(max-a[i])/delta[i];
  lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));
 }
 if(lo>hi)return [];
 times.push(lo,hi);
 for(const [origin,direction] of [[a[0],delta[0]],[a[1],delta[1]],[a[0]+a[1],delta[0]+delta[1]]]){
  if(Math.abs(direction)<1e-12)continue;
  const start=origin+direction*lo,end=origin+direction*hi;
  for(let k=Math.ceil(Math.min(start,end));k<=Math.floor(Math.max(start,end));k++){
   const t=(k-origin)/direction;if(t>lo&&t<hi)times.push(t);
  }
 }
 return times;
}

/** Raise the eye above terrain along the orbit ray. Between triangular
 * edge crossings height is linear; testing these extrema catches narrow
 * ridges missed by regularly spaced samples. Additional samples cover
 * separate lake surfaces and other non-grid boundaries. */
export function clearTerrainEye(eye,target,heightAt,spacing,clearance,crossings=[]){
 const length=Math.hypot(eye[0]-target[0],eye[2]-target[2]);
 const steps=Math.max(8,Math.min(80,Math.ceil(length/Math.max(spacing*.45,1e-5))));
 let y=eye[1];
 const check=t=>{
  // A focus can temporarily lie just below a morphing surface. Do not
  // divide by an arbitrarily tiny distance to that focus; the eye and
  // the rest of its approach still receive the full clearance test.
  if(!(t>=.025&&t<=1))return;
  const x=target[0]+(eye[0]-target[0])*t,z=target[2]+(eye[2]-target[2])*t;
  const h=heightAt(x,z);if(h===null||!Number.isFinite(h))return;
  y=Math.max(y,target[1]+(h-target[1])/t+clearance);
 };
 for(let i=1;i<=steps;i++)check(i/steps);
 for(const t of new Set(crossings)){check(t);check(t+1e-7);check(t-1e-7);}
 return [eye[0],y,eye[2]];
}
