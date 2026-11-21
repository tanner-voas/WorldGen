/** Read-only 3D camera picking against the displayed height grid.
 * Picking is deliberately derived from the same vertices as the GPU surface:
 * zooming/focusing never changes source elevations, water, or checkpoints.
 */
import {insideGeometry} from './engine.js';
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

/** Bilinear height interpolation in the exact GPU vertex grid. Returns null
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
 if(mask&&corners.every(i=>mask[i]===0))return null;
 const values=corners.map(i=>surface.vertexData?.[i*7+1]);
 if(values.some(v=>!Number.isFinite(v)))return null;
 return (values[0]*(1-tx)+values[1]*tx)*(1-tz)+(values[2]*(1-tx)+values[3]*tx)*tz;
}

/** First visible intersection with terrain or the sea datum. Uses a small
 * bounded raymarch only on a focus gesture, never during animation frames. */
export function pickTerrainRay(surface,eye,direction,heightMultiplier=1){
 if(!surface||!eye||!direction||![...eye,...direction,heightMultiplier].every(Number.isFinite)||heightMultiplier<=0)return null;
 const dir=normalize(direction);
 const maxDistance=100;
 const limitTop=Math.max(surface.maxY??0,(surface.seaLevel??0)*(surface.heightScale??.73))*heightMultiplier+.1;
 const limitBottom=Math.min(surface.minY??0,(surface.seaLevel??0)*(surface.heightScale??.73))*heightMultiplier-.1;
 let near=0,far=maxDistance;
 if(dir[1]<-1e-5){
  near=Math.max(0,(eye[1]-limitTop)/(-dir[1]));
  far=Math.min(maxDistance,(eye[1]-limitBottom)/(-dir[1]));
  if(far<near)return null;
 }
 const planeY=(surface.seaLevel??0)*(surface.heightScale??.73)*heightMultiplier;
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
