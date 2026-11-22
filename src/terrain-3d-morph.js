/** Geomorph references are rasterized from the actual stitched LOD triangles,
 * not a second height sampler. One RGBA texel stores elevation and normal;
 * optional RGB material data occupies a second RGBA texture array. */
export const LOD_MORPH_MS=220;
const clamp01=t=>Math.max(0,Math.min(1,t));
export const morphWeight=t=>{t=clamp01(t);return t*t*(3-2*t);};

export function buildMorphFields(surface){
 const {cols,rows,vertexData,materialColors,levels}=surface;
 const stride=cols+1,count=stride*(rows+1),layers=levels.length;
 const terrain=new Float32Array(count*layers*4),material=materialColors?new Float32Array(terrain.length):null;
 for(let layer=0;layer<layers;layer++){
  const offset=layer*count*4;
  // Direct copies also provide safe values for excluded outline vertices.
  for(let i=0;i<count;i++){
   const o=offset+i*4,v=i*7;
   terrain[o]=vertexData[v+6];terrain[o+1]=vertexData[v+3];terrain[o+2]=vertexData[v+4];terrain[o+3]=vertexData[v+5];
   if(material)material.set(materialColors.subarray(i*3,i*3+3),o);
  }
  if(levels[layer].step===1)continue;
  const indices=levels[layer].indices;
  for(let k=0;k<indices.length;k+=3){
   const a=indices[k],b=indices[k+1],c=indices[k+2];
   const ax=a%stride,ay=Math.floor(a/stride),bx=b%stride,by=Math.floor(b/stride),cx=c%stride,cy=Math.floor(c/stride);
   const det=(bx-ax)*(cy-ay)-(cx-ax)*(by-ay);
   if(!det)continue;
   for(let y=Math.min(ay,by,cy);y<=Math.max(ay,by,cy);y++)for(let x=Math.min(ax,bx,cx);x<=Math.max(ax,bx,cx);x++){
    const u=((x-ax)*(cy-ay)-(cx-ax)*(y-ay))/det,v=((bx-ax)*(y-ay)-(x-ax)*(by-ay))/det,w=1-u-v;
    if(Math.min(u,v,w)<-1e-8)continue;
    const o=offset+(y*stride+x)*4;
    for(let j=0;j<4;j++){
     const component=j===0?6:j+2;
     terrain[o+j]=vertexData[a*7+component]*w+vertexData[b*7+component]*u+vertexData[c*7+component]*v;
    }
    if(material)for(let j=0;j<3;j++)material[o+j]=materialColors[a*3+j]*w+materialColors[b*3+j]*u+materialColors[c*3+j]*v;
   }
  }
 }
 return {terrain,material,layers};
}

/** Retarget without resetting the animation. A reversal retraces the same
 * surface; unrelated requests wait at most one short transition. */
export function advanceLodMorph(state,desired,now){
 if(!state)return {from:desired,to:desired,phase:1,time:now};
 let {from,to,phase,time}=state;
 if(from!==to){
  const dt=Math.max(0,now-time)/LOD_MORPH_MS;
  phase=clamp01(phase+(desired===from?-dt:dt));
  if(phase===0){to=from;phase=1;}else if(phase===1)from=to;
 }
 if(from===to&&desired!==to){to=desired;phase=0;}
 return {from,to,phase,time:now};
}

export function advanceDetailMorph(phase,time,target,now){
 const dt=time==null?0:Math.max(0,now-time)/LOD_MORPH_MS;
 return clamp01((phase||0)+(target?dt:-dt));
}
