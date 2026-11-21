// WorldGen v0.1.0 — deterministic geometry / geology engine; no browser globals.
export const WORLD_WIDTH=2048, WORLD_HEIGHT=1024, SCHEMA_VERSION=1;
export const STAGES=[
  ['World setup','Coordinate system and world dimensions'],
  ['Voronoi mesh','Spatial cells and topology'],
  ['Tectonic plates','Plate territories and relative motion'],
  ['Elevation','Crust, collision uplift and terrain noise'],
  ['Oceans & coasts','Sea level, water coverage and coastlines'],
  ['Landforms','Future: geomorphology and geology'],
  ['Erosion','Future: hydraulic and thermal erosion'],
  ['Climate','Future: seasonal atmosphere and oceans'],
  ['Hydrology','Future: drainage, lakes and rivers'],
  ['Soils','Future: regolith and groundwater'],
  ['Biomes','Future: environmental classification'],
  ['Habitats','Future: vegetation and habitats'],
  ['Local detail','Future: zoom-dependent microterrain']
];
export const IMPLEMENTED=4;
export const DEFAULTS={
  1:{count:900,distribution:'jittered',jitter:0.74,relaxation:1,seed:271828},
  2:{plates:15,continental:0.42,motion:0.7,seed:314159},
  3:{uplift:0.73,roughness:0.46,continentalHeight:0.32,seed:161803},
  4:{land:0.38,seed:141421}
};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
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
function cellPolygons(sites){
 const n=sites.length,spacing=Math.sqrt(WORLD_WIDTH*WORLD_HEIGHT/n),sz=spacing*1.25;
 const nx=Math.ceil(WORLD_WIDTH/sz),ny=Math.ceil(WORLD_HEIGHT/sz),buckets=new Map();
 function bucketIndex(ix,iy){return iy*nx+ix;}
 for(let i=0;i<n;i++){const p=sites[i],ix=clamp(Math.floor(p[0]/sz),0,nx-1),iy=clamp(Math.floor(p[1]/sz),0,ny-1),k=bucketIndex(ix,iy);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(i);}
 const result=new Array(n),adj=new Array(n);
 for(let i=0;i<n;i++){
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
export function generateMesh(settings){let sites=initialSites(settings),geo;
 const passes=clamp(Math.round(settings.relaxation),0,3);
 for(let t=0;t<=passes;t++){
  geo=cellPolygons(sites);
  if(t===passes)break;
  sites=sites.map((p,i)=>{const c=centroid(geo.polygons[i]);return c?[clamp(c[0],0.001,WORLD_WIDTH-0.001),clamp(c[1],0.001,WORLD_HEIGHT-0.001)]:p;});
 }
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
export function generateCoasts(elevationData,settings){const es=elevationData.elevations,sorted=[...es].sort((a,b)=>a-b),land=clamp(+settings.land,0.05,0.9),seaLevel=sorted[Math.min(sorted.length-1,Math.floor((1-land)*sorted.length))];
 const water=es.map(value=>value<seaLevel?1:0);
 return {seaLevel,water,landFraction:water.filter(v=>!v).length/water.length};
}
export function generateStage(stage,locked,settings){
 const mesh=locked[0]?.data;
 if(stage===1)return generateMesh(settings);
 if(stage===2){if(!mesh)throw Error('Voronoi mesh required');return generatePlates(mesh,settings);}
 if(stage===3){if(!locked[1]?.data)throw Error('Tectonic layer required');return generateElevation(mesh,locked[1].data,settings);}
 if(stage===4){if(!locked[2]?.data)throw Error('Elevation layer required');return generateCoasts(locked[2].data,settings);}
 throw Error('Stage not available in v0.1.0');
}
export function newWorld(name='Untitled world'){
 return {schema:SCHEMA_VERSION,id:`world-${Date.now()}`,name,created:new Date().toISOString(),updated:new Date().toISOString(),locked:[],working:{stage:1,settings:{...DEFAULTS[1]},data:null},viewStage:1,viewMode:'auto',showEdges:true,selected:null};
}
export function validateWorld(world){
 if(!world||world.schema!==SCHEMA_VERSION||!Array.isArray(world.locked)||world.locked.length>IMPLEMENTED)throw Error('Unsupported or invalid world save');
 for(let i=0;i<world.locked.length;i++)if(world.locked[i]?.stage!==i+1||!world.locked[i]?.data)throw Error('Save has missing or unordered layers');
 if(!world.working||!Number.isInteger(world.working.stage)||world.working.stage<1||world.working.stage>IMPLEMENTED+1)throw Error('Save has invalid working layer');
 if(world.working.stage!==Math.min(IMPLEMENTED+1,world.locked.length+1))throw Error('Save has inconsistent layer progression');
 if(world.locked.length && (!Array.isArray(world.locked[0].data.cells)||world.locked[0].data.cells.length>4000))throw Error('Save mesh is not supported');
 return world;
}
