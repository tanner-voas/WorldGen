// WorldGen v0.1.3 — deterministic geometry / geology engine; no browser globals.
export const WORLD_WIDTH=2048, WORLD_HEIGHT=1024, SCHEMA_VERSION=1;
export const STAGES=[
  ['World setup','Coordinate system and world dimensions'],
  ['Voronoi mesh','Spatial cells and topology'],
  ['Tectonic plates','Plate territories and relative motion'],
  ['Elevation','Crust, collision uplift and terrain noise'],
  ['Oceans & coasts','Sea level, water coverage and coastlines'],
  ['Landforms','Mountains, valleys, geology and fine terrain variation'],
  ['Erosion','Downhill runoff, sediment transport and thermal weathering'],
  ['Climate','Future: seasonal atmosphere and oceans'],
  ['Hydrology','Future: drainage, lakes and rivers'],
  ['Soils','Future: regolith and groundwater'],
  ['Biomes','Future: environmental classification'],
  ['Habitats','Future: vegetation and habitats'],
  ['Local detail','Future: zoom-dependent microterrain']
];
export const IMPLEMENTED=6;
export const LANDFORM_NAMES=['Deep ocean','Shallow sea','Coastal plain','Lowland plain','Hills','Highlands','Mountains','Volcanic terrain','Basin'];
export const DEFAULTS={
  1:{count:900,distribution:'jittered',jitter:0.74,relaxation:1,seed:271828},
  2:{plates:15,continental:0.42,motion:0.7,seed:314159},
  3:{uplift:0.73,roughness:0.46,continentalHeight:0.32,seed:161803},
  4:{land:0.38,seed:141421},
  5:{ridge:0.65,detail:0.58,valleys:0.5,volcanism:0.22,seed:173205},
  6:{rainfall:0.85,hydraulic:0.78,thermal:0.4,hardness:0.48,iterations:18,seed:223607}
};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
/** Polygon area in world-square units, independent of site density. */
export function cellArea(cell){
 const p=cell.poly;let sum=0;
 for(let j=0;j<p.length;j+=2){const k=(j+2)%p.length;sum+=p[j]*p[k+1]-p[k]*p[j+1];}
 return Math.abs(sum)*0.5;
}
/** Recalculate geographic land share for old checkpoints that only stored cell share. */
export function landAreaFraction(mesh,water){
 if(!mesh?.cells||mesh.cells.length!==water?.length)return null;
 let land=0,total=0;
 for(let i=0;i<water.length;i++){
  const a=cellArea(mesh.cells[i]);total+=a;if(!water[i])land+=a;
 }
 return total>0?land/total:null;
}

export function random(seed){let a=(seed|0)>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
function hash2(x,y,seed){let n=Math.imul(x|0,0x1f123bb5)^Math.imul(y|0,0x4f1bbcdc)^Math.imul(seed|0,0x27d4eb2d);n=Math.imul(n^(n>>>15),0x85ebca6b);n=Math.imul(n^(n>>>13),0xc2b2ae35);return ((n^(n>>>16))>>>0)/4294967295;}
function noise(x,y,s){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);const a=hash2(ix,iy,s),b=hash2(ix+1,iy,s),c=hash2(ix,iy+1,s),d=hash2(ix+1,iy+1,s);return ((a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v)*2-1;}
function fbm(x,y,seed,octaves=5){let sum=0,amp=0.55,total=0,frequency=1;for(let k=0;k<octaves;k++){sum+=noise(x*frequency,y*frequency,seed+k*1013)*amp;total+=amp;frequency*=2;amp*=0.48;}return sum/total;}
function clip(poly,nx,ny,c){const next=[];if(!poly.length)return next;let prev=poly[poly.length-1],dp=nx*prev[0]+ny*prev[1]-c;for(const cur of poly){const dc=nx*cur[0]+ny*cur[1]-c;if((dp<=0)!==(dc<=0)){const t=dp/(dp-dc);next.push([prev[0]+t*(cur[0]-prev[0]),prev[1]+t*(cur[1]-prev[1])]);}if(dc<=0)next.push(cur);prev=cur;dp=dc;}return next;}
function centroid(poly){let a=0,cx=0,cy=0;for(let k=0;k<poly.length;k++){const p=poly[k],q=poly[(k+1)%poly.length],f=p[0]*q[1]-q[0]*p[1];a+=f;cx+=(p[0]+q[0])*f;cy+=(p[1]+q[1])*f;}return Math.abs(a)<1e-8?null:[cx/(3*a),cy/(3*a)];}
function initialSites(settings){const rand=random(settings.seed),n=clamp(Math.round(settings.count),100,3200),sites=[];
 const columns=Math.round(Math.sqrt(n*WORLD_WIDTH/WORLD_HEIGHT)),rows=Math.ceil(n/columns),stepX=WORLD_WIDTH/columns,stepY=WORLD_HEIGHT/rows;
 if(settings.distribution==='random'){
  const grid=new Map(),dist=Math.sqrt(WORLD_WIDTH*WORLD_HEIGHT/n)*0.48,sz=dist;
  for(let i=0;i<n;i++){
   let x=0,y=0,found=false;
   for(let attempt=0;attempt<35;attempt++){
    x=rand()*WORLD_WIDTH;y=rand()*WORLD_HEIGHT;const ix=Math.floor(x/sz),iy=Math.floor(y/sz);let good=true;
    for(let xx=ix-1;xx<=ix+1;xx++)for(let yy=iy-1;yy<=iy+1;yy++)for(const p of grid.get(`${xx},${yy}`)||[]){if((p[0]-x)**2+(p[1]-y)**2<dist*dist)good=false;}
    if(good){found=true;const key=`${ix},${iy}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push([x,y]);break;}
   }
   if(!found){const ix=Math.floor(x/sz),iy=Math.floor(y/sz),key=`${ix},${iy}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push([x,y]);}
   sites.push([x,y]);
  }
 }else{
  const jitter=clamp(+settings.jitter,0,1.7);
  for(let row=0;row<rows;row++)for(let col=0;col<columns&&sites.length<n;col++){
   let x=(col+0.5+(rand()-0.5)*jitter)*stepX,y=(row+0.5+(rand()-0.5)*jitter)*stepY;
   if(settings.distribution==='clustered'){
    const drift=fbm(x/330,y/330,settings.seed,3)*stepX*1.15;
    x+=drift;y+=fbm(x/310,y/310,settings.seed+31,3)*stepY*1.15;
   }
   sites.push([clamp(x,0.001,WORLD_WIDTH-0.001),clamp(y,0.001,WORLD_HEIGHT-0.001)]);
  }
 }
 return sites;
}
function cellPolygons(sites,onProgress=null){
 const n=sites.length,spacing=Math.sqrt(WORLD_WIDTH*WORLD_HEIGHT/n),sz=spacing*1.25;
 const nx=Math.ceil(WORLD_WIDTH/sz),ny=Math.ceil(WORLD_HEIGHT/sz),buckets=new Map();
 function bucketIndex(ix,iy){return iy*nx+ix;}
 for(let i=0;i<n;i++){const p=sites[i],ix=clamp(Math.floor(p[0]/sz),0,nx-1),iy=clamp(Math.floor(p[1]/sz),0,ny-1),k=bucketIndex(ix,iy);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(i);}
 const result=new Array(n),adj=new Array(n);
 for(let i=0;i<n;i++){
  if(onProgress && i%Math.max(10,Math.floor(n/45))===0)onProgress(i/n);
  const [x,y]=sites[i],ix=clamp(Math.floor(x/sz),0,nx-1),iy=clamp(Math.floor(y/sz),0,ny-1);
  const seen=new Set(),candidates=[];
  function addNearby(radius){const lowX=clamp(Math.floor((x-radius)/sz),0,nx-1),highX=clamp(Math.floor((x+radius)/sz),0,nx-1),lowY=clamp(Math.floor((y-radius)/sz),0,ny-1),highY=clamp(Math.floor((y+radius)/sz),0,ny-1);
   for(let by=lowY;by<=highY;by++)for(let bx=lowX;bx<=highX;bx++)for(const k of buckets.get(bucketIndex(bx,by))||[]){if(k!==i&&!seen.has(k)){seen.add(k);candidates.push(k);}}
  }
  addNearby(spacing*3.2);
  candidates.sort((a,b)=>(sites[a][0]-x)**2+(sites[a][1]-y)**2-((sites[b][0]-x)**2+(sites[b][1]-y)**2));
  let poly=[[0,0],[WORLD_WIDTH,0],[WORLD_WIDTH,WORLD_HEIGHT],[0,WORLD_HEIGHT]];
  const processed=new Set();
  function apply(){for(const k of candidates){if(processed.has(k))continue;processed.add(k);const [px,py]=sites[k],dx=px-x,dy=py-y;poly=clip(poly,dx,dy,(px*px+py*py-x*x-y*y)*0.5);if(!poly.length)break;}}
  apply();
  let maxRadius=0;for(const p of poly)maxRadius=Math.max(maxRadius,Math.hypot(p[0]-x,p[1]-y));
  // Any site farther than twice the provisional cell radius cannot bisect its cell.
  // This bound gives exact Voronoi cells even for sparse/clustered distributions.
  addNearby(Math.min(Math.hypot(WORLD_WIDTH,WORLD_HEIGHT)*2,maxRadius*2+0.01));apply();
  result[i]=poly;
  // An edge's midpoint lies on a shared bisector (unless it borders the map).
  // Find the nearest competing site to derive a symmetric topology graph.
  const neighbors=new Set();
  for(let j=0;j<poly.length;j++){
   const a=poly[j],b=poly[(j+1)%poly.length],mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;
   if((mx<1e-6&&Math.abs(a[0]-b[0])<1e-6)||(mx>WORLD_WIDTH-1e-6&&Math.abs(a[0]-b[0])<1e-6)||(my<1e-6&&Math.abs(a[1]-b[1])<1e-6)||(my>WORLD_HEIGHT-1e-6&&Math.abs(a[1]-b[1])<1e-6))continue;
   let best=-1,score=Infinity;
   for(const k of processed){const dd=(sites[k][0]-mx)**2+(sites[k][1]-my)**2;if(dd<score){score=dd;best=k;}}
   if(best>=0)neighbors.add(best);
  }
  adj[i]=Array.from(neighbors).sort((a,b)=>a-b);
 }
 // Fix minor numerical asymmetry without changing polygon edges.
 for(let i=0;i<n;i++)for(const j of adj[i])if(!adj[j].includes(i))adj[j].push(i);
 for(const row of adj)row.sort((a,b)=>a-b);
 return {polygons:result,neighbors:adj};
}
export function generateMesh(settings,onProgress=null){let sites=initialSites(settings),geo;
 const passes=clamp(Math.round(settings.relaxation),0,3);
 for(let t=0;t<=passes;t++){
  geo=cellPolygons(sites,onProgress?fraction=>onProgress((t+fraction)/(passes+1)):null);
  if(t===passes)break;
  sites=sites.map((p,i)=>{const c=centroid(geo.polygons[i]);return c?[clamp(c[0],0.001,WORLD_WIDTH-0.001),clamp(c[1],0.001,WORLD_HEIGHT-0.001)]:p;});
 }
 onProgress?.(1);
 const cells=sites.map((p,i)=>({x:+p[0].toFixed(4),y:+p[1].toFixed(4),poly:geo.polygons[i].flat().map(z=>+z.toFixed(4)),neighbors:geo.neighbors[i]}));
 return {width:WORLD_WIDTH,height:WORLD_HEIGHT,cells};
}
function farSeeds(cells,count,seed){const rng=random(seed),chosen=[Math.floor(rng()*cells.length)];let distances=cells.map(c=>(c.x-cells[chosen[0]].x)**2+(c.y-cells[chosen[0]].y)**2);
 for(let j=1;j<count;j++){let best=0,bestScore=-1;for(let i=0;i<cells.length;i++){const score=distances[i]*(0.65+0.7*hash2(i,j,seed));if(score>bestScore){bestScore=score;best=i;}}chosen.push(best);for(let i=0;i<cells.length;i++)distances[i]=Math.min(distances[i],(cells[i].x-cells[best].x)**2+(cells[i].y-cells[best].y)**2);}
 return chosen;
}
export function generatePlates(mesh,settings){const rng=random(settings.seed),cells=mesh.cells,pCount=clamp(Math.round(settings.plates),3,50),seeds=farSeeds(cells,pCount,settings.seed),plates=seeds.map((index,id)=>{const theta=rng()*Math.PI*2;return {id,x:cells[index].x,y:cells[index].y,continental:rng()<settings.continental,vx:Math.cos(theta)*settings.motion,vy:Math.sin(theta)*settings.motion};});
 const owners=cells.map(c=>{let chosen=0,min=Infinity;for(const plate of plates){const dx=(c.x-plate.x)/WORLD_WIDTH,dy=(c.y-plate.y)/WORLD_HEIGHT,d=dx*dx+dy*dy;if(d<min){min=d;chosen=plate.id;}}return chosen;});
 return {plates,owners};
}
export function generateElevation(mesh,plateData,settings){const cells=mesh.cells,{plates,owners}=plateData,base=new Float32Array(cells.length),boundary=new Float32Array(cells.length),frontier=[];
 for(let i=0;i<cells.length;i++){
  const c=cells[i],plate=plates[owners[i]];let coll=0,edge=false;
  for(const j of c.neighbors){if(owners[j]===owners[i])continue;edge=true;const o=plates[owners[j]],vX=o.vx-plate.vx,vY=o.vy-plate.vy,dx=cells[j].x-c.x,dy=cells[j].y-c.y;
   // Opposing velocities raise convergent mountain belts; divergence creates rifts.
   const convergence=-(vX*dx+vY*dy)/(Math.hypot(dx,dy)||1);
   coll+=clamp(convergence,-1.8,1.8)*(plate.continental||o.continental?1:0.45);
  }
  boundary[i]=edge?Math.sign(coll||1)*Math.min(Math.abs(coll),2):0;
  if(edge)frontier.push(i);
  const continent=plate.continental?(settings.continentalHeight+0.12):-(0.48-settings.continentalHeight*0.2);
  const macro=fbm(c.x/550,c.y/550,settings.seed,4)*0.32;
  const local=fbm(c.x/90,c.y/90,settings.seed+999,5)*(0.08+settings.roughness*0.25);
  base[i]=continent+macro+local;
 }
 // Multi-source breadth-first distance to nearest boundary. Smoothed uplift
 // spreads a few cells inland instead of producing sharp one-cell ridges.
 const dist=new Int16Array(cells.length);dist.fill(-1);
 for(const i of frontier)dist[i]=0;
 for(let index=0;index<frontier.length;index++){
  const i=frontier[index];for(const j of cells[i].neighbors)if(dist[j]<0){dist[j]=dist[i]+1;frontier.push(j);}
 }
 const elevations=new Array(cells.length);
 for(let i=0;i<cells.length;i++){
  const c=cells[i];let pressure=boundary[i];
  for(const j of c.neighbors)if(Math.abs(boundary[j])>Math.abs(pressure))pressure=boundary[j]*0.72;
  const ridge=(dist[i]>=0?Math.exp(-dist[i]*0.63):0)*pressure*settings.uplift*0.43;
  elevations[i]=+clamp(base[i]+ridge,-1.8,1.8).toFixed(4);
 }
 return {elevations};
}
/** Select sea level by *geographic area*, not cell count. Variable-size
 * Voronoi cells otherwise make requested land coverage misleading.
 * The optional mesh argument keeps the old direct-call API compatible.
 */
export function generateCoasts(elevationData,settings,mesh=null){
 const es=elevationData.elevations,landTarget=clamp(Number(settings.land),0.05,0.9);
 if(!Array.isArray(es)||!es.length)throw Error('Elevation samples required');
 if(mesh&&mesh.cells.length!==es.length)throw Error('Elevation and mesh dimensions differ');
 const weights=mesh?mesh.cells.map(cellArea):es.map(()=>1);
 const indices=es.map((_,i)=>i).sort((a,b)=>es[a]-es[b]||a-b);
 const total=weights.reduce((a,b)=>a+b,0);
 if(!(total>0))throw Error('Invalid geographic cell areas');
 const waterTarget=total*(1-landTarget);
 let accumulated=0,bestDifference=Infinity,bestSplit=-1;
 // A threshold may not split cells of exactly the same elevation.
 for(let k=1;k<indices.length;k++){
  accumulated+=weights[indices[k-1]];
  if(es[indices[k-1]]===es[indices[k]])continue;
  const difference=Math.abs(accumulated-waterTarget);
  if(difference<bestDifference){bestDifference=difference;bestSplit=k;}
 }
 const seaLevel=bestSplit<0?es[indices[0]]+(landTarget>=0.5?-0.000001:0.000001):
  (es[indices[bestSplit-1]]+es[indices[bestSplit]])*0.5;
 const water=es.map(value=>value<seaLevel?1:0);
 const landFraction=water.filter(v=>!v).length/water.length;
 const landAreaFraction=mesh?landAreaFractionFromWeights(weights,water,total):landFraction;
 return {seaLevel,water,landFraction,landAreaFraction};
}
function landAreaFractionFromWeights(weights,water,total){
 let land=0;for(let i=0;i<water.length;i++)if(!water[i])land+=weights[i];
 return land/total;
}
/** Detailed relief is added *without mutating* the locked height/sea layers.
 * Preserve the layer-4 land/water mask so locked coastlines remain stable.
 * Class IDs match LANDFORM_NAMES and will remain part of the save schema.
 */
export function generateLandforms(mesh,plateData,heightData,coastData,settings){
 const cells=mesh.cells,base=heightData.elevations,water=coastData.water,sea=coastData.seaLevel;
 const {plates,owners}=plateData,seed=settings.seed|0;
 const elevations=new Array(cells.length),ruggedness=new Array(cells.length),classes=new Array(cells.length),volcanoes=[];
 const ridgePower=clamp(Number(settings.ridge),0,1.6),detailPower=clamp(Number(settings.detail),0,1.6);
 const valleys=clamp(Number(settings.valleys),0,1.6),volcanism=clamp(Number(settings.volcanism),0,1);
 for(let i=0;i<cells.length;i++){
  const c=cells[i],plate=plates[owners[i]];
  let border=0,convergent=0;
  for(const j of c.neighbors){
   if(owners[i]===owners[j])continue;
   border=1;
   const other=plates[owners[j]],dx=cells[j].x-c.x,dy=cells[j].y-c.y;
   convergent=Math.max(convergent,-((other.vx-plate.vx)*dx+(other.vy-plate.vy)*dy)/(Math.hypot(dx,dy)||1));
  }
  // Orient successive ridges in the direction of local plate travel.
  const direction=Math.atan2(plate.vy,plate.vx)+Math.PI/2;
  const rx=(c.x*Math.cos(direction)+c.y*Math.sin(direction))/105;
  const ry=(-c.x*Math.sin(direction)+c.y*Math.cos(direction))/340;
  const coherentRidge=Math.abs(fbm(rx,ry,seed+29,4));
  const noiseDetail=fbm(c.x/64,c.y/64,seed+431,5);
  const valleyMask=Math.max(0,1-Math.abs(fbm(c.x/180,c.y/180,seed+149,3))*3.1);
  const rough=(0.11+detailPower*.26)*(noiseDetail + ridgePower*.7*coherentRidge);
  const tectonic=border?Math.max(0,convergent)*ridgePower*.13:0;
  const cut=valleys*.11*valleyMask;
  let height=base[i]+rough+tectonic-cut;
  // A coastline is a deliberate locked result, not a byproduct to rewrite.
  height=water[i]?Math.min(sea-.002,height):Math.max(sea+.002,height);
  elevations[i]=+clamp(height,-1.8,1.8).toFixed(4);
 }
 for(let i=0;i<cells.length;i++){
  const c=cells[i],height=elevations[i],relative=height-sea;
  let slope=0;
  for(const j of c.neighbors)slope+=Math.abs(height-elevations[j])/(Math.hypot(c.x-cells[j].x,c.y-cells[j].y)+.001)*42;
  slope=c.neighbors.length?clamp(slope/c.neighbors.length,0,1):0;
  ruggedness[i]=+slope.toFixed(4);
  if(water[i]){classes[i]=relative<-.48?0:1;continue;}
  const plateEdge=c.neighbors.some(j=>owners[i]!==owners[j]);
  const volcanic=plateEdge&&hash2(i,owners[i],seed+801)<volcanism*.48;
  if(volcanic){classes[i]=7;volcanoes.push(i);}
  else if(relative<.085)classes[i]=2;
  else if(relative>.70 || (relative>.4&&slope>.55))classes[i]=6;
  else if(relative>.39)classes[i]=5;
  else if(slope>.33)classes[i]=4;
  else if(relative<.17&&slope<.12)classes[i]=8;
  else classes[i]=3;
 }
 const counts=Array(LANDFORM_NAMES.length).fill(0);
 for(const type of classes)counts[type]++;
 return {elevations,ruggedness,classes,volcanoes,counts};
}
/** Coarse graph-based landscape evolution. Landforms and sea-level geometry are
 * immutable inputs: this layer never rewrites the coast mask or earlier heights.
 * Runoff follows steepest downhill cell neighbors; sediment moves along those
 * directed edges. This is deliberately not a sub-cell hydraulic solver.
 */
function downhillFlow(cells,heights,water){
 const n=cells.length,flowTo=new Array(n).fill(-1),slopes=new Float64Array(n);
 for(let i=0;i<n;i++){
  if(water[i])continue;
  for(const j of cells[i].neighbors){
   if(j===i)continue;
   const diff=heights[i]-heights[j];
   if(diff<=0)continue;
   const dist=Math.hypot(cells[i].x-cells[j].x,cells[i].y-cells[j].y);
   if(dist<=1e-8)continue;
   const slope=diff/dist;
   if(slope>slopes[i]){slopes[i]=slope;flowTo[i]=j;}
  }
 }
 return {flowTo,slopes};
}
export function generateErosion(mesh,coasts,landforms,settings,onProgress=null){
 const cells=mesh.cells,n=cells.length,base=landforms.elevations,water=coasts.water,sea=coasts.seaLevel;
 if(!Array.isArray(base)||base.length!==n||water.length!==n)throw Error('Erosion requires matching landforms and coastlines');
 const heights=base.slice(),areas=cells.map(cellArea),areaMean=(WORLD_WIDTH*WORLD_HEIGHT)/n;
 const rain=clamp(Number(settings.rainfall),0,1.6),hydraulic=clamp(Number(settings.hydraulic),0,1.6);
 const thermal=clamp(Number(settings.thermal),0,1.6),hardness=clamp(Number(settings.hardness),0,1);
 const steps=clamp(Math.round(Number(settings.iterations)||1),1,40),seed=settings.seed|0;
 const removed=new Float64Array(n),deposited=new Float64Array(n);
 const rainAt=cells.map((c,i)=>water[i]?0:rain*(.52+.48*(noise(c.x/240,c.y/240,seed)+1)*.5)*areas[i]/areaMean);
 let exported=0;
 for(let step=0;step<steps;step++){
  const {flowTo,slopes}=downhillFlow(cells,heights,water);
  const order=Array.from({length:n},(_,i)=>i).filter(i=>!water[i]).sort((a,b)=>heights[b]-heights[a]||a-b);
  const runoff=Float64Array.from(rainAt),sediment=new Float64Array(n),delta=new Float64Array(n);
  for(const i of order){
   const downstream=flowTo[i],slope=slopes[i],volume=runoff[i];
   // Normalize by local cell area to avoid over-eroding small polygons.
   const intensity=Math.sqrt(Math.max(0,volume)*areaMean/Math.max(1,areas[i]));
   const potential=hydraulic*(1.25-.85*hardness)*.0028*intensity*Math.sqrt(Math.min(2,slope*95));
   const cut=Math.min(.018,Math.max(0,heights[i]-sea-.002),potential);
   if(cut>0){delta[i]-=cut;removed[i]+=cut;sediment[i]+=cut*areas[i];}
   let carry=sediment[i];
   if(downstream<0){
    const put=Math.min(carry,areas[i]*.008);
    if(put>0){delta[i]+=put/areas[i];deposited[i]+=put/areas[i];carry-=put;}
    exported+=carry;continue;
   }
   if(!water[downstream]){
    const depositRate=.06+.38*(1-clamp(slope*95,0,1));
    const put=Math.min(carry*depositRate,areas[i]*.009);
    if(put>0){delta[i]+=put/areas[i];deposited[i]+=put/areas[i];carry-=put;}
    sediment[downstream]+=carry;
    runoff[downstream]+=volume;
   }else exported+=carry;
  }
  // Thermal weathering is approximately area-conserving between neighboring
  // land cells and skips the ocean entirely.
  if(thermal>0){
   for(let i=0;i<n;i++){
    if(water[i])continue;
    for(const j of cells[i].neighbors){
     if(j<=i||water[j])continue;
     const diff=heights[i]-heights[j];
     const dist=Math.hypot(cells[i].x-cells[j].x,cells[i].y-cells[j].y);
     if(dist<1e-8||Math.abs(diff)/dist<=.001)continue;
     const upper=diff>0?i:j,lower=diff>0?j:i;
     const moved=Math.min(.006,thermal*(1-.4*hardness)*.11*(Math.abs(diff)/dist-.001));
     const amount=moved*Math.min(areas[upper],areas[lower]);
     const cut=Math.min(amount/areas[upper],Math.max(0,heights[upper]+delta[upper]-sea-.002));
     if(cut>0){delta[upper]-=cut;delta[lower]+=cut*areas[upper]/areas[lower];removed[upper]+=cut;deposited[lower]+=cut*areas[upper]/areas[lower];}
    }
   }
  }
  for(let i=0;i<n;i++)if(!water[i])heights[i]=clamp(Math.max(sea+.002,heights[i]+delta[i]),-1.8,1.8);
  onProgress?.((step+1)/steps*.94);
 }
 // Recalculate drainage from saved precision, so inspected flow links always
 // correspond to the exact elevations in an exported checkpoint.
 const elevations=heights.map(h=>+h.toFixed(4));
 const {flowTo}=downhillFlow(cells,elevations,water);
 const order=Array.from({length:n},(_,i)=>i).filter(i=>!water[i]).sort((a,b)=>elevations[b]-elevations[a]||a-b);
 const discharge=Array.from(rainAt);
 for(const i of order){const j=flowTo[i];if(j>=0&&!water[j])discharge[j]+=discharge[i];}
 const flowing=order.filter(i=>flowTo[i]>=0&&discharge[i]>0);
 const sorted=flowing.map(i=>discharge[i]).sort((a,b)=>a-b);
 const cutoff=sorted.length?sorted[Math.floor(sorted.length*.88)]:Infinity;
 const channels=flowing.filter(i=>discharge[i]>=cutoff);
 const erosionDepth=Array.from(removed,x=>+x.toFixed(5));
 const deposition=Array.from(deposited,x=>+x.toFixed(5));
 onProgress?.(1);
 return {elevations,erosionDepth,deposition,flowTo,discharge:discharge.map(v=>+v.toFixed(4)),channels,
  summary:{channels:channels.length,exportedSediment:+exported.toFixed(2),meanErosion:+(erosionDepth.reduce((a,b)=>a+b,0)/n).toFixed(4),
   maxDischarge:+Math.max(0,...discharge).toFixed(2)}};
}
export function generateStage(stage,locked,settings,onProgress=null){
 const mesh=locked[0]?.data;
 if(stage===1)return generateMesh(settings,onProgress);
 if(stage===2){if(!mesh)throw Error('Voronoi mesh required');return generatePlates(mesh,settings);}
 if(stage===3){if(!locked[1]?.data)throw Error('Tectonic layer required');return generateElevation(mesh,locked[1].data,settings);}
 if(stage===4){if(!locked[2]?.data)throw Error('Elevation layer required');return generateCoasts(locked[2].data,settings,mesh);}
 if(stage===5){if(!locked[3]?.data)throw Error('Ocean layer required');return generateLandforms(mesh,locked[1].data,locked[2].data,locked[3].data,settings);}
 if(stage===6){if(!locked[4]?.data)throw Error('Landform layer required');return generateErosion(mesh,locked[3].data,locked[4].data,settings,onProgress);}
 throw Error('Stage not yet implemented');
}
export function newWorld(name='Untitled world'){
 return {schema:SCHEMA_VERSION,id:`world-${Date.now()}`,name,created:new Date().toISOString(),updated:new Date().toISOString(),locked:[],working:{stage:1,settings:{...DEFAULTS[1]},data:null,dataSettings:null},viewStage:1,viewMode:'auto',showEdges:true,showPlateBorders:false,showCoastBorders:false,showFlow:false,exploreMode:false,selected:null};
}
export function validateWorld(world){
 if(!world||world.schema!==SCHEMA_VERSION||!Array.isArray(world.locked)||world.locked.length>IMPLEMENTED)throw Error('Unsupported or invalid world save');
 if(typeof world.name!=='string'||world.name.length>200)throw Error('Save has an invalid world name');
 for(let i=0;i<world.locked.length;i++)if(world.locked[i]?.stage!==i+1||!world.locked[i]?.data)throw Error('Save has missing or unordered layers');
 if(!world.working||!Number.isInteger(world.working.stage)||world.working.stage<1||world.working.stage>IMPLEMENTED+1)throw Error('Save has invalid working layer');
 if(world.working.stage!==world.locked.length+1)throw Error('Save has inconsistent layer progression');
 const records=[...world.locked];
 if(world.working.data)records.push(world.working);
 const mesh=records.find(r=>r.stage===1)?.data;
 if(mesh){
  if(!Array.isArray(mesh.cells)||mesh.cells.length<1||mesh.cells.length>3200)throw Error('Invalid world mesh size');
  for(const c of mesh.cells){
   if(!Number.isFinite(c.x)||!Number.isFinite(c.y)||c.x<0||c.x>WORLD_WIDTH||c.y<0||c.y>WORLD_HEIGHT)throw Error('Invalid mesh site');
   if(!Array.isArray(c.poly)||c.poly.length<6||c.poly.length>256||c.poly.length%2)throw Error('Invalid polygon');
   if(!Array.isArray(c.neighbors)||c.neighbors.length>80||c.neighbors.some(j=>!Number.isInteger(j)||j<0||j>=mesh.cells.length))throw Error('Invalid mesh neighbors');
   if(c.poly.some((v,i)=>!Number.isFinite(v)||v<-.01||v>(i%2?WORLD_HEIGHT:WORLD_WIDTH)+.01))throw Error('Invalid polygon coordinates');
  }
 }
 const n=mesh?.cells.length;
 for(const record of records){
  if(record.stage===1)continue;
  if(!n)throw Error('Missing base mesh for a generated layer');
  const d=record.data;
  if(record.stage===2&&(!Array.isArray(d.plates)||d.plates.length<3||d.plates.length>50||!Array.isArray(d.owners)||d.owners.length!==n||d.owners.some(x=>!Number.isInteger(x)||x<0||x>=d.plates.length)||d.plates.some((p,i)=>p.id!==i||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.vx)||!Number.isFinite(p.vy)||typeof p.continental!=='boolean')))throw Error('Invalid plate data');
  if((record.stage===3||record.stage===5||record.stage===6)&&(!Array.isArray(d.elevations)||d.elevations.length!==n||d.elevations.some(x=>!Number.isFinite(x)||Math.abs(x)>2)))throw Error('Invalid elevation data');
  if(record.stage===4&&(!Array.isArray(d.water)||d.water.length!==n||!Number.isFinite(d.seaLevel)||d.water.some(x=>x!==0&&x!==1)))throw Error('Invalid coast data');
  if(record.stage===5&&(!Array.isArray(d.classes)||d.classes.length!==n||d.classes.some(x=>!Number.isInteger(x)||x<0||x>=LANDFORM_NAMES.length)||!Array.isArray(d.ruggedness)||d.ruggedness.length!==n||d.ruggedness.some(x=>!Number.isFinite(x)||x<0||x>1)||!Array.isArray(d.counts)||d.counts.length!==LANDFORM_NAMES.length||d.counts.some(x=>!Number.isInteger(x)||x<0)||d.counts.reduce((a,b)=>a+b,0)!==n||!Array.isArray(d.volcanoes)||d.volcanoes.some(x=>!Number.isInteger(x)||x<0||x>=n)))throw Error('Invalid landform data');
  if(record.stage===6){
   if(!Array.isArray(d.erosionDepth)||!Array.isArray(d.deposition)||!Array.isArray(d.flowTo)||!Array.isArray(d.discharge)||!Array.isArray(d.channels)
    ||[d.erosionDepth,d.deposition,d.flowTo,d.discharge].some(a=>a.length!==n)
    ||d.erosionDepth.some(x=>!Number.isFinite(x)||x<0||x>3)
    ||d.deposition.some(x=>!Number.isFinite(x)||x<0||x>3)
    ||d.discharge.some(x=>!Number.isFinite(x)||x<0)
    ||d.flowTo.some((x,i)=>!Number.isInteger(x)||x< -1||x>=n||x===i||(x>=0&&!mesh.cells[i].neighbors.includes(x)))
    ||d.channels.some(x=>!Number.isInteger(x)||x<0||x>=n)
    ||!d.summary||!Number.isFinite(d.summary.meanErosion)||!Number.isFinite(d.summary.maxDischarge))throw Error('Invalid erosion data');
  }
 }
 return world;
}

/** Upgrade incomplete settings in older saves without rewriting locked data.
 * In v0.1.0, stage 5 was only a placeholder and had no parameter defaults.
 */
const INPUT_RANGES={
  1:{count:[100,3200],jitter:[0,1.7],relaxation:[0,3]},
  2:{plates:[3,50],continental:[0.1,0.9],motion:[0,2]},
  3:{uplift:[0,1.6],roughness:[0,1.4],continentalHeight:[0.05,0.8]},
  4:{land:[0.1,0.85]},
  5:{ridge:[0,1.6],detail:[0,1.6],valleys:[0,1.6],volcanism:[0,1]},
  6:{rainfall:[0,1.6],hydraulic:[0,1.6],thermal:[0,1.6],hardness:[0,1],iterations:[1,40]}
};
export function upgradeWorld(world){
 validateWorld(world);
 const stage=world.working.stage;
 if(stage<=IMPLEMENTED){
  const defaults=DEFAULTS[stage];
  const current=world.working.settings||{};
  const next={...defaults,...current};
  for(const [key,baseline] of Object.entries(defaults)){
   if(typeof baseline==='number'&&(!Number.isFinite(Number(next[key]))||next[key]===''))next[key]=baseline;
   if(typeof baseline==='string'&&!['jittered','random','clustered'].includes(next[key]))next[key]=baseline;
  }
  for(const [key,[min,max]] of Object.entries(INPUT_RANGES[stage])){
   next[key]=clamp(Number(next[key]),min,max);
   if(['count','relaxation','plates','iterations'].includes(key))next[key]=Math.round(next[key]);
  }
  const seed=Number(next.seed);
  next.seed=Number.isFinite(seed)?Math.floor(clamp(seed,0,0xffffffff)):defaults.seed;
  world.working.settings=next;
 }
 if(!['auto','natural','geometry','plates','height','coast','landforms','erosion','flow'].includes(world.viewMode))world.viewMode='auto';
 world.exploreMode=!!world.exploreMode;
 world.showEdges=world.showEdges!==false;
 world.showPlateBorders=!!world.showPlateBorders;
 world.showCoastBorders=!!world.showCoastBorders;
 world.showFlow=!!world.showFlow;
 return world;
}

/** Self-contained checkpoint through a selected layer. Later layers never leak in. */
export function snapshotThroughStage(world,stage){
 validateWorld(world);
 if(!Number.isInteger(stage)||stage<1||stage>IMPLEMENTED)throw Error('Invalid checkpoint stage');
 const target=world.locked[stage-1]||(world.working.stage===stage?world.working:null);
 if(!target?.data)throw Error('Selected layer has no generated data');
 const result=structuredClone(world);
 result.locked=result.locked.filter(record=>record.stage<=stage);
 if(world.working.stage!==stage){
  result.working={stage:stage+1,settings:stage+1<=IMPLEMENTED?{...DEFAULTS[stage+1]}:{},data:null,dataSettings:null};
 }
 result.viewStage=stage;
 return result;
}
