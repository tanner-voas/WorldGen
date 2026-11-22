// The legacy elevation fields remain in encoded units; physical calculations
// use the shared 2.7 km/unit convention without migrating locked worlds.
import {REFERENCE_DISTANCE_KM,REFERENCE_AREA_KM2,distanceLoss} from './geographic-units.js';
import {ELEVATION_KM_PER_UNIT,elevationToKm,physicalSlope} from './elevation-units.js';
export const WORLD_WIDTH=2048, WORLD_HEIGHT=1024, SCHEMA_VERSION=2;
export const STAGES=[
  ['World setup','Coordinate system and world dimensions'],
  ['World geometry','Define the 2D world shape and its physical size in kilometers'],
  ['Voronoi mesh','Spatial cells and topology'],
  ['Tectonic plates','Plate territories and relative motion'],
  ['Elevation','Crust, collision uplift and terrain noise'],
  ['Oceans & coasts','Sea level, water coverage and coastlines'],
  ['Landforms','Mountains, valleys, geology and fine terrain variation'],
  ['Erosion','Downhill runoff, sediment transport and thermal weathering'],
  ['Climate','Seasonal temperature, precipitation, ocean moderation and orographic rain shadows'],
  ['Hydrology','Climate-driven runoff, connected rivers, inland lakes and drainage basins'],
  ['Soils','Surface depth, texture, organic matter, permeability and groundwater potential'],
  ['Biomes','Climate- and soil-driven natural environments, ecological potential and transitions'],
  ['Vegetation & habitats','Potential vegetation cover and structural habitat mosaic'],
  ['Local detail','Future: zoom-dependent microterrain']
];
export const IMPLEMENTED=12;
/** Geometry and coastline generation are deterministic without an independent
 * seed. Keep historical seed fields in existing saves; this is UI capability,
 * not a change to the generation inputs or save schema. */
export function stageUsesSeed(stage){return Number.isInteger(stage)&&stage>=2&&stage<=IMPLEMENTED&&stage!==5;}
export const SOIL_NAMES=['Open water','Exposed rock','Thin upland','Coarse / sandy','Loam','Clay-rich','Organic wetland','Volcanic','Arid mineral','Cold / tundra'];
export const BIOME_NAMES=['Ocean','Freshwater lake','Permanent snow / ice','Tundra','Boreal forest','Temperate rainforest','Temperate forest','Temperate grassland','Dry steppe','Desert / barren','Dry shrubland','Tropical rainforest','Tropical seasonal forest','Savanna','Alpine','Wetland','Montane forest'];
export const VEGETATION_NAMES=['Ocean','Freshwater','Bare / ice','Sparse tundra','Grassland','Shrubland','Open woodland','Closed forest','Wet forest','Wetland vegetation','Riparian corridor','Alpine meadow','Desert scrub'];
export const MAX_CELLS=5000;
export const LANDFORM_NAMES=['Deep ocean','Shallow sea','Coastal plain','Lowland plain','Hills','Highlands','Mountains','Volcanic terrain','Basin'];
export const DEFAULTS={
  1:{shape:'rectangle',width:2048,height:1024,radius:750,radiusX:1100,radiusY:600},
  2:{averageArea:2300,distribution:'jittered',jitter:0.74,relaxation:1,seed:271828},
  3:{plates:15,continental:0.42,motion:0.7,seed:314159},
  4:{uplift:0.73,roughness:0.46,continentalHeight:0.32,seed:161803},
  5:{land:0.38,edgeOcean:0.9,edgeFade:1.5,setbackStrength:1.15,setbackWidth:10,seed:141421},
  6:{ridge:0.65,detail:0.58,valleys:0.5,volcanism:0.22,seed:173205},
  7:{rainfall:0.85,hydraulic:0.78,thermal:0.4,hardness:0.48,iterations:18,seed:223607},
 8:{equatorTemp:29,latitudeCenter:0,latitudeSpan:125,axialTilt:23.5,rainfall:1100,windDirection:45,rainShadow:0.9,maritime:0.7,seed:271829},
 9:{runoffScale:1,infiltration:0.32,evaporation:0.52,riverThreshold:4,lakeDepth:0.008,minLakeCells:1,seed:314160},
 10:{weathering:1,organicInput:1,alluvialInput:1,permeabilityBias:1,groundwaterRecharge:1,seed:173206},
 11:{temperatureShift:0,rainfallResponse:1,forestThreshold:.90,wetlandThreshold:.65,alpineLimit:9,patchVariation:.12,seed:271830},
 12:{vegetationDensity:1,maturity:.8,disturbance:.16,riparianStrength:.65,patchiness:.16,seed:271831}
};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/** Width/height and physical area are recorded in kilometers and square kilometers.
 * This layer is intentionally planar; no globe, depth, or vertical projection yet. */
export function generateGeometry(settings){
 const shape=settings.shape;
 if(!['rectangle','circle','ellipse'].includes(shape))throw Error('Unsupported world shape');
 const dimension=(key)=>{const n=Number(settings[key]);if(!Number.isFinite(n)||n<50||n>20000)throw Error(`${key} must be 50–20,000 km`);return n;};
 let width,height,areaKm2,radiusX,radiusY;
 if(shape==='rectangle'){
  width=dimension('width');height=dimension('height');areaKm2=width*height;
 }else{
  radiusX=dimension(shape==='circle'?'radius':'radiusX');
  radiusY=shape==='circle'?radiusX:dimension('radiusY');
  width=radiusX*2;height=radiusY*2;areaKm2=Math.PI*radiusX*radiusY;
 }
 return {shape,width,height,areaKm2,radiusX:radiusX??null,radiusY:radiusY??null,unit:'km',depth:0};
}
export function insideGeometry(x,y,g){
 if(x<0||y<0||x>g.width||y>g.height)return false;
 if(g.shape==='rectangle')return true;
 return ((x-g.width/2)/(g.width/2))**2+((y-g.height/2)/(g.height/2))**2<=1+1e-5;
}
function boundaryPolygon(g){
 if(g.shape==='rectangle')return [[0,0],[g.width,0],[g.width,g.height],[0,g.height]];
 const segments=128,points=[];
 for(let j=0;j<segments;j++){
  const angle=j*2*Math.PI/segments;
  points.push([g.width/2+Math.cos(angle)*g.width/2,g.height/2+Math.sin(angle)*g.height/2]);
 }
 return points;
}
export function meshTargetCount(geometry,averageArea){
 const area=Number(averageArea);
 if(!Number.isFinite(area)||area<=0)throw Error('Average polygon area must be positive');
 return clamp(Math.round(geometry.areaKm2/area),100,MAX_CELLS);
}

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
function initialSites(settings,geometry){
 const rand=random(settings.seed),n=meshTargetCount(geometry,settings.averageArea),sites=[];
 const {width,height}=geometry,coverage=geometry.areaKm2/(width*height);
 const columns=Math.max(1,Math.round(Math.sqrt(n*width/height/coverage))),rows=Math.ceil(n/columns/coverage);
 const stepX=width/columns,stepY=height/rows;
 const jitter=clamp(Number(settings.jitter),0,1.7);
 if(settings.distribution!=='random'){
  const candidates=[];
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
   let x=(col+.5+(rand()-.5)*jitter)*stepX,y=(row+.5+(rand()-.5)*jitter)*stepY;
   if(settings.distribution==='clustered'){
    const drift=fbm(x/(width*.17),y/(height*.32),settings.seed,3)*stepX*1.15;
    x+=drift;y+=fbm(x/(width*.15),y/(height*.3),settings.seed+31,3)*stepY*1.15;
   }
   x=clamp(x,.001,width-.001);y=clamp(y,.001,height-.001);
   if(insideGeometry(x,y,geometry))candidates.push([x,y]);
  }
  // Shuffle before truncation: avoid bias towards the top-left edge.
  for(let i=candidates.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
  sites.push(...candidates.slice(0,n));
 }
 const distance=Math.sqrt(geometry.areaKm2/n)*.43,cellSize=distance,grid=new Map();
 for(const p of sites){const ix=Math.floor(p[0]/cellSize),iy=Math.floor(p[1]/cellSize),key=`${ix},${iy}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(p);}
 // Fill gaps or generate a blue-noise-like random distribution.
 while(sites.length<n){
  let best=null;
  for(let tries=0;tries<55;tries++){
   const x=rand()*width,y=rand()*height;if(!insideGeometry(x,y,geometry))continue;
   const ix=Math.floor(x/cellSize),iy=Math.floor(y/cellSize);let good=true;
   for(let xx=ix-1;xx<=ix+1;xx++)for(let yy=iy-1;yy<=iy+1;yy++)for(const p of grid.get(`${xx},${yy}`)||[])if((p[0]-x)**2+(p[1]-y)**2<distance**2)good=false;
   best=[x,y];if(good)break;
  }
  if(!best)continue;
  const [x,y]=best,key=`${Math.floor(x/cellSize)},${Math.floor(y/cellSize)}`;
  if(!grid.has(key))grid.set(key,[]);grid.get(key).push(best);sites.push(best);
 }
 return sites;
}
function cellPolygons(sites,geometry,onProgress=null){
 const {width,height}=geometry,n=sites.length,spacing=Math.sqrt(geometry.areaKm2/n),sz=spacing*1.25;
 const nx=Math.ceil(width/sz),ny=Math.ceil(height/sz),buckets=new Map();
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
  let poly=boundaryPolygon(geometry);
  const processed=new Set();
  function apply(){for(const k of candidates){if(processed.has(k))continue;processed.add(k);const [px,py]=sites[k],dx=px-x,dy=py-y;poly=clip(poly,dx,dy,(px*px+py*py-x*x-y*y)*0.5);if(!poly.length)break;}}
  apply();
  let maxRadius=0;for(const p of poly)maxRadius=Math.max(maxRadius,Math.hypot(p[0]-x,p[1]-y));
  // Any site farther than twice the provisional cell radius cannot bisect its cell.
  // This bound gives exact Voronoi cells even for sparse/clustered distributions.
  addNearby(Math.min(Math.hypot(width,height)*2,maxRadius*2+0.01));apply();
  result[i]=poly;
  // An edge's midpoint lies on a shared bisector (unless it borders the map).
  // Find the nearest competing site to derive a symmetric topology graph.
  const neighbors=new Set();
  for(let j=0;j<poly.length;j++){
   const a=poly[j],b=poly[(j+1)%poly.length],mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;
   if((mx<1e-6&&Math.abs(a[0]-b[0])<1e-6)||(mx>width-1e-6&&Math.abs(a[0]-b[0])<1e-6)||(my<1e-6&&Math.abs(a[1]-b[1])<1e-6)||(my>height-1e-6&&Math.abs(a[1]-b[1])<1e-6))continue;
   let best=-1,score=Infinity;
   for(const k of processed){const dd=(sites[k][0]-mx)**2+(sites[k][1]-my)**2;if(dd<score){score=dd;best=k;}}
   // The outer clipping boundary also contributes polygon edges. They do
   // not correspond to a Voronoi bisector and must not create spurious
   // graph connections (especially on circles and ellipses). Only accept
   // an edge when another site is genuinely equidistant at its midpoint.
   const own=(x-mx)**2+(y-my)**2;
   if(best>=0&&Math.abs(score-own)<=Math.max(1,own)*1e-7)neighbors.add(best);
  }
  adj[i]=Array.from(neighbors).sort((a,b)=>a-b);
 }
 // Fix minor numerical asymmetry without changing polygon edges.
 for(let i=0;i<n;i++)for(const j of adj[i])if(!adj[j].includes(i))adj[j].push(i);
 for(const row of adj)row.sort((a,b)=>a-b);
 return {polygons:result,neighbors:adj};
}
export function generateMesh(settings,onProgress=null,geometry=generateGeometry(DEFAULTS[1])){let sites=initialSites(settings,geometry),geo;
 const passes=clamp(Math.round(settings.relaxation),0,3);
 for(let t=0;t<=passes;t++){
  geo=cellPolygons(sites,geometry,onProgress?fraction=>onProgress((t+fraction)/(passes+1)):null);
  if(t===passes)break;
  sites=sites.map((p,i)=>{const c=centroid(geo.polygons[i]);return c?[clamp(c[0],0.001,geometry.width-0.001),clamp(c[1],0.001,geometry.height-0.001)]:p;});
 }
 onProgress?.(1);
 const cells=sites.map((p,i)=>({x:+p[0].toFixed(4),y:+p[1].toFixed(4),poly:geo.polygons[i].flat().map(z=>+z.toFixed(4)),neighbors:geo.neighbors[i]}));
 return {width:geometry.width,height:geometry.height,shape:geometry.shape,areaKm2:geometry.areaKm2,cells};
}
function farSeeds(cells,count,seed){const rng=random(seed),chosen=[Math.floor(rng()*cells.length)];let distances=cells.map(c=>(c.x-cells[chosen[0]].x)**2+(c.y-cells[chosen[0]].y)**2);
 for(let j=1;j<count;j++){let best=0,bestScore=-1;for(let i=0;i<cells.length;i++){const score=distances[i]*(0.65+0.7*hash2(i,j,seed));if(score>bestScore){bestScore=score;best=i;}}chosen.push(best);for(let i=0;i<cells.length;i++)distances[i]=Math.min(distances[i],(cells[i].x-cells[best].x)**2+(cells[i].y-cells[best].y)**2);}
 return chosen;
}
export function generatePlates(mesh,settings){const rng=random(settings.seed),cells=mesh.cells,pCount=clamp(Math.round(settings.plates),3,50),seeds=farSeeds(cells,pCount,settings.seed),plates=seeds.map((index,id)=>{const theta=rng()*Math.PI*2;return {id,x:cells[index].x,y:cells[index].y,continental:rng()<settings.continental,vx:Math.cos(theta)*settings.motion,vy:Math.sin(theta)*settings.motion};});
 const owners=cells.map(c=>{let chosen=0,min=Infinity;for(const plate of plates){const dx=(c.x-plate.x)/mesh.width,dy=(c.y-plate.y)/mesh.height,d=dx*dx+dy*dy;if(d<min){min=d;chosen=plate.id;}}return chosen;});
 return {plates,owners};
}
// Crust height, uplift and terrain noise remain calibrated in the compact
// elevation encoding. Every encoded unit represents 2.7 km of relief.
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
 // Follow the nearest plate boundary in physical kilometres. Carry its
 // signed pressure inland; a denser graph must not narrow mountain belts.
 const {distance:dist,source}=geographicDistances(cells,frontier);
 const elevations=new Array(cells.length);
 for(let i=0;i<cells.length;i++){
  const pressure=source[i]>=0?boundary[source[i]]:0;
  const ridge=Math.exp(-dist[i]*.63/REFERENCE_DISTANCE_KM)*pressure*settings.uplift*.43;
  elevations[i]=+clamp(base[i]+ridge,-1.8,1.8).toFixed(4);
 }
 return {elevations};
}
/** Distance to the actual clipped world outline, in km. For circles and
 * ellipses the outline is the same 128-segment path as the Voronoi clipper,
 * so both edge detection and the visual rim agree with saved mesh geometry.
 */
function outlineDistance(x,y,outline){
 let nearest=Infinity;
 for(let i=0;i<outline.length;i++){
  const a=outline[i],b=outline[(i+1)%outline.length];
  const dx=b[0]-a[0],dy=b[1]-a[1];
  const t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1),0,1);
  nearest=Math.min(nearest,Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy));
 }
 return nearest;
}
function rectangleEdgeDistance(x,y,geometry){
 return Math.min(x,geometry.width-x,y,geometry.height-y);
}
/** A cell is exposed to the outside if even one of its polygon vertices
 * reaches the clipping outline. The rounded saved coordinates need a small
 * tolerance. This catches long, irregular Voronoi boundary polygons, not just
 * cells whose sites happen to be close to the outer edge.
 */
function boundaryCells(mesh,outline){
 const rectangle=mesh.shape==='rectangle',distance=rectangle?
  (x,y)=>rectangleEdgeDistance(x,y,mesh):(x,y)=>outlineDistance(x,y,outline);
 const near=new Array(mesh.cells.length),touches=new Array(mesh.cells.length).fill(false);
 for(let i=0;i<mesh.cells.length;i++){
  const cell=mesh.cells[i];near[i]=Math.max(0,distance(cell.x,cell.y));
  // The site-to-corner radius is an exact bound on polygon extent.
  let maxRadius=0;
  for(let j=0;j<cell.poly.length;j+=2)maxRadius=Math.max(maxRadius,Math.hypot(cell.poly[j]-cell.x,cell.poly[j+1]-cell.y));
  if(near[i]>maxRadius+.002)continue;
  for(let j=0;j<cell.poly.length;j+=2){
   if(distance(cell.poly[j],cell.poly[j+1])<.002){touches[i]=true;break;}
  }
 }
 return {near,touches};
}
/** The protected rim is a topological constraint, not a width in km. The
 * bound uses actual clipped polygon areas, including on elongated worlds. */
export function boundaryLandCapacity(mesh){
 const weights=mesh.cells.map(cellArea),total=weights.reduce((a,b)=>a+b,0);
 if(!(total>0))throw Error('Invalid geographic cell areas');
 const {touches}=boundaryCells(mesh,boundaryPolygon(mesh));
 return rimCapacity(weights,total,touches);
}
function rimCapacity(weights,total,protectedCells){
 let availableArea=0,protectedCount=0;
 for(let i=0;i<weights.length;i++){
  if(protectedCells[i])protectedCount++;else availableArea+=weights[i];
 }
 return {protectedCount,availableCount:weights.length-protectedCount,
  maxLandFraction:clamp(availableArea/total,0,1)};
}
/** Select geographic-area-weighted sea level with an edge-local ocean bias.
 * A narrow rim and a broader continental setback fade independently; the
 * inner elevation field remains unchanged beyond both influence widths. All actual boundary-contacting polygons remain
 * water, even when a high continental plate reaches the edge. Edge water is
 * counted toward the target rather than silently increasing overall ocean
 * coverage whenever sufficient non-edge cells are available.
 *
 * With no mesh (legacy direct API), or with both edge strengths zero, the
 * original sea-level threshold behavior is preserved. This layer owns its adjusted elevations:
 * the locked tectonic/elevation layers are never modified. Later landforms
 * consume this coastal field so land/sea and heights remain consistent.
 */
export function generateCoasts(elevationData,settings,mesh=null){
 const es=elevationData.elevations,landTarget=clamp(Number(settings.land),0.05,0.9);
 if(!Number.isFinite(landTarget))throw Error('Land coverage target must be finite');
 if(!Array.isArray(es)||!es.length)throw Error('Elevation samples required');
 if(mesh&&mesh.cells.length!==es.length)throw Error('Elevation and mesh dimensions differ');
 const weights=mesh?mesh.cells.map(cellArea):es.map(()=>1);
 const total=weights.reduce((a,b)=>a+b,0);
 if(!(total>0))throw Error('Invalid geographic cell areas');
 const strength=clamp(Number(settings.edgeOcean)||0,0,1.5);
 const fade=clamp(Number(settings.edgeFade??1.5),.5,5);
 // The guaranteed one-polygon wet rim is deliberately separate from this
 // broad, low-frequency continental setback. The broad component weakens
 // gradually with distance, without any noise tied to the map outline.
 const setbackStrength=clamp(Number(settings.setbackStrength??0),0,1.8);
 const setbackWidth=clamp(Number(settings.setbackWidth??9),2,18);
 const protectedCells=new Array(es.length).fill(false);
 const elevations=es.slice();
 let edgeWidthKm=0,retreatWidthKm=0;
 if(mesh&&(strength>0||setbackStrength>0)){
  const outline=boundaryPolygon(mesh);
  const {near,touches}=boundaryCells(mesh,outline);
  // Prevent the ocean rim from engulfing thin maps or very coarse meshes.
  edgeWidthKm=Math.min(fade*REFERENCE_DISTANCE_KM,Math.min(mesh.width,mesh.height)*.12);
  retreatWidthKm=Math.min(setbackWidth*REFERENCE_DISTANCE_KM,Math.min(mesh.width,mesh.height)*.16);
  for(let i=0;i<es.length;i++){
   protectedCells[i]=strength>0&&touches[i];
   const normalized=clamp(1-near[i]/Math.max(.001,edgeWidthKm),0,1);
   const smooth=normalized*normalized*(3-2*normalized);
   const inland=clamp(1-near[i]/Math.max(.001,retreatWidthKm),0,1);
   const broad=inland*inland*(3-2*inland);
   // No noise is added along the edge: the underlying geology supplies
   // variation, while smoothstep prevents an artificial concentric ridge.
   elevations[i]=+clamp(es[i]-strength*smooth-setbackStrength*broad,-1.8,1.8).toFixed(4);
  }
 }
 const capacity=rimCapacity(weights,total,protectedCells);
 const available=es.map((_,i)=>i).filter(i=>!protectedCells[i]);
 const availableArea=available.reduce((sum,i)=>sum+weights[i],0);
 const target=clamp(availableArea-total*landTarget,0,availableArea);
 const indices=available.sort((a,b)=>elevations[a]-elevations[b]||a-b);
 let seaLevel;
 if(!indices.length)seaLevel=0;
 else if(target<=0)seaLevel=elevations[indices[0]]-.000001;
 else if(target>=availableArea)seaLevel=elevations[indices.at(-1)]+.000001;
 else{
  // Consider both endpoints as well as each distinct elevation boundary.
  // Equal-height groups cannot be split by a single sea-level datum. At an
  // exact tie prefer the smaller water area; never split a plateau arbitrarily.
  let accumulated=0,bestDifference=target,bestSplit=0;
  for(let k=1;k<=indices.length;k++){
   accumulated+=weights[indices[k-1]];
   if(k<indices.length&&elevations[indices[k-1]]===elevations[indices[k]])continue;
   const difference=Math.abs(accumulated-target);
   if(difference<bestDifference){bestDifference=difference;bestSplit=k;}
  }
  seaLevel=bestSplit===0?elevations[indices[0]]-.000001:
   bestSplit===indices.length?elevations[indices.at(-1)]+.000001:
   (elevations[indices[bestSplit-1]]+elevations[indices[bestSplit]])*.5;
 }
 const water=elevations.map((value,i)=>protectedCells[i]||value<seaLevel?1:0);
 // The boundary must be below sea level in the *derived* height field, too.
 // Leave the original tectonic elevations intact for stage-4 exploration.
 for(let i=0;i<elevations.length;i++)if(protectedCells[i])elevations[i]=Math.min(elevations[i],seaLevel-.015);
 const landFraction=water.filter(v=>!v).length/water.length;
 const landAreaFraction=mesh?landAreaFractionFromWeights(weights,water,total):landFraction;
 const edgeWaterCells=protectedCells.filter(Boolean).length;
 return {seaLevel,water,landFraction,landAreaFraction,elevations,edgeWaterCells,coverage:{target:landTarget,maxLandFraction:capacity.maxLandFraction,availableCount:capacity.availableCount},edgeWidthKm:+edgeWidthKm.toFixed(2),retreatWidthKm:+retreatWidthKm.toFixed(2)};
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
 const cells=mesh.cells,base=coastData.elevations||heightData.elevations,water=coastData.water,sea=coastData.seaLevel;
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
  const c=cells[i],height=elevations[i],relative=elevationToKm(height,sea);
  let slope=0;
  for(const j of c.neighbors)slope+=physicalSlope(Math.abs(height-elevations[j]),Math.hypot(c.x-cells[j].x,c.y-cells[j].y)+.001)*(42/ELEVATION_KM_PER_UNIT);
  slope=c.neighbors.length?clamp(slope/c.neighbors.length,0,1):0;
  ruggedness[i]=+slope.toFixed(4);
  if(water[i]){classes[i]=relative<elevationToKm(-.48)?0:1;continue;}
  const plateEdge=c.neighbors.some(j=>owners[i]!==owners[j]);
  const volcanic=plateEdge&&hash2(i,owners[i],seed+801)<volcanism*.48;
  if(volcanic){classes[i]=7;volcanoes.push(i);}
  else if(relative<elevationToKm(.085))classes[i]=2;
  else if(relative>elevationToKm(.70) || (relative>elevationToKm(.4)&&slope>.55))classes[i]=6;
  else if(relative>elevationToKm(.39))classes[i]=5;
  else if(slope>.33)classes[i]=4;
  else if(relative<elevationToKm(.17)&&slope<.12)classes[i]=8;
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
   const slope=physicalSlope(diff,dist);
   if(slope>slopes[i]){slopes[i]=slope;flowTo[i]=j;}
  }
 }
 return {flowTo,slopes};
}
export function generateErosion(mesh,coasts,landforms,settings,onProgress=null){
 const cells=mesh.cells,n=cells.length,base=landforms.elevations,water=coasts.water,sea=coasts.seaLevel;
 if(!Array.isArray(base)||base.length!==n||water.length!==n)throw Error('Erosion requires matching landforms and coastlines');
 const heights=base.slice(),areas=cells.map(cellArea);
 const rain=clamp(Number(settings.rainfall),0,1.6),hydraulic=clamp(Number(settings.hydraulic),0,1.6);
 const thermal=clamp(Number(settings.thermal),0,1.6),hardness=clamp(Number(settings.hardness),0,1);
 const steps=clamp(Math.round(Number(settings.iterations)||1),1,40),seed=settings.seed|0;
 const removed=new Float64Array(n),deposited=new Float64Array(n);
 const rainDepth=cells.map((c,i)=>water[i]?0:rain*(.52+.48*(noise(c.x/240,c.y/240,seed)+1)*.5));
 const rainAt=rainDepth.map((r,i)=>r*areas[i]/REFERENCE_AREA_KM2);
 let exported=0;
 for(let step=0;step<steps;step++){
  const {flowTo,slopes}=downhillFlow(cells,heights,water);
  const order=Array.from({length:n},(_,i)=>i).filter(i=>!water[i]).sort((a,b)=>heights[b]-heights[a]||a-b);
  const runoff=Float64Array.from(rainAt),sediment=new Float64Array(n),delta=new Float64Array(n);
  for(const i of order){
   const downstream=flowTo[i],slope=slopes[i],volume=runoff[i];
   // Accumulated runoff is measured in reference-area equivalents, not
   // counts of current polygons. Local rainfall retains hillslope erosion.
   const intensity=Math.sqrt(Math.max(rainDepth[i],volume,0));
   const potential=hydraulic*(1.25-.85*hardness)*.0028*intensity*Math.sqrt(Math.min(2,slope*(95/ELEVATION_KM_PER_UNIT)));
   const cut=Math.min(.018,Math.max(0,heights[i]-sea-.002),potential);
   if(cut>0){delta[i]-=cut;removed[i]+=cut;sediment[i]+=cut*areas[i];}
   let carry=sediment[i];
   if(downstream<0){
    const put=Math.min(carry,areas[i]*.008);
    if(put>0){delta[i]+=put/areas[i];deposited[i]+=put/areas[i];carry-=put;}
    exported+=carry;continue;
   }
   if(!water[downstream]){
    const distance=Math.hypot(cells[i].x-cells[downstream].x,cells[i].y-cells[downstream].y);
    const depositRate=distanceLoss(.06+.38*(1-clamp(slope*(95/ELEVATION_KM_PER_UNIT),0,1)),distance);
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
     if(dist<1e-8)continue;
     const gradient=physicalSlope(Math.abs(diff),dist);
     if(gradient<=elevationToKm(.001))continue;
     const upper=diff>0?i:j,lower=diff>0?j:i;
     const moved=Math.min(.006,thermal*(1-.4*hardness)*.11*((gradient-elevationToKm(.001))/ELEVATION_KM_PER_UNIT));
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
 // Legacy persisted depths are in elevation units, exported sediment in unit × km².
 const erosionDepth=Array.from(removed,x=>+x.toFixed(5));
 const deposition=Array.from(deposited,x=>+x.toFixed(5));
 onProgress?.(1);
 return {elevations,erosionDepth,deposition,flowTo,discharge:discharge.map(v=>+v.toFixed(4)),channels,
  summary:{channels:channels.length,exportedSediment:+exported.toFixed(2),meanErosion:+(erosionDepth.reduce((sum,depth,i)=>sum+depth*areas[i],0)/Math.max(1e-12,areas.reduce((a,b)=>a+b,0))).toFixed(4),
   maxDischarge:+Math.max(0,...discharge).toFixed(2)}};
}
/** Deterministic first-pass climate on the existing Voronoi graph. This is a
 * geography-aware climate field, not a global fluid dynamics solver. Y is
 * mapped to a configurable notional latitude: the underlying world is planar.
 * Locked coastlines, erosion, and drainage are not rewritten.
 */
export function generateClimate(mesh,coasts,erosion,settings,onProgress=null){
 const cells=mesh.cells,n=cells.length,water=coasts.water,heights=erosion.elevations;
 if(!n||water.length!==n||heights.length!==n)throw Error('Climate requires completed ocean and erosion layers');
 const span=clamp(Number(settings.latitudeSpan),20,180);
 const center=clamp(Number(settings.latitudeCenter),-70,70);
 const equatorTemp=clamp(Number(settings.equatorTemp),10,40);
 const tilt=clamp(Number(settings.axialTilt),0,45);
 const baseRain=clamp(Number(settings.rainfall),100,4000);
 const shadow=clamp(Number(settings.rainShadow),0,2);
 const maritime=clamp(Number(settings.maritime),0,1.5);
 const angle=clamp(Number(settings.windDirection),-180,180)*Math.PI/180;
 const wx=Math.cos(angle),wy=-Math.sin(angle),seed=settings.seed|0;
 // Maritime moderation decays over a fixed geographic distance. Ocean
 // sites seed a weighted shortest-path traversal of the Voronoi graph.
 const {distance:seaDistance}=geographicDistances(cells,water.flatMap((w,i)=>w?[i]:[]));
 onProgress?.(.12);
 const meanTemp=new Array(n),seasonalRange=new Array(n),latitudes=new Array(n),precipitation=new Array(n);
 const janTemp=new Array(n),julTemp=new Array(n),janRain=new Array(n),julRain=new Array(n);
 const airMoisture=new Float64Array(n),humidity=new Array(n),moisture=new Array(n);
 const projection=cells.map((c,i)=>({i,d:c.x*wx+c.y*wy}));
 projection.sort((a,b)=>a.d-b.d||a.i-b.i);
 for(let i=0;i<n;i++){
  const c=cells[i],lat=clamp(center+(mesh.height*.5-c.y)/mesh.height*span,-90,90);
  latitudes[i]=+lat.toFixed(2);
  const at=Math.abs(lat)*Math.PI/180;
  const altitude=water[i]?0:Math.max(0,elevationToKm(heights[i],coasts.seaLevel));
  const oceanEffect=clamp(1-seaDistance[i]/(6*REFERENCE_DISTANCE_KM),0,1)*maritime;
  const landSwing=clamp(2.5+Math.pow(Math.abs(lat)/90,1.3)*22+(water[i]?0:6*(1-oceanEffect*.65))*(.15+Math.abs(lat)/90),0,33);
  const swing=tilt/23.5*landSwing;
  const noiseTemp=fbm(c.x/360,c.y/360,seed+71,3)*1.8;
  const t=equatorTemp-52*Math.pow(Math.sin(at),1.27)-6.2*altitude+noiseTemp+(water[i]?1:0)*oceanEffect*.7;
  meanTemp[i]=+clamp(t,-65,55).toFixed(2);
  seasonalRange[i]=+clamp(swing,0,39).toFixed(2);
  // January is northern winter, July is northern summer; the two are equal
  // at zero axial tilt and reverse sign for southern latitudes.
  const hemisphere=lat>0?1:lat<0?-1:0;
  janTemp[i]=+clamp(t-swing*hemisphere,-90,75).toFixed(2);
  julTemp[i]=+clamp(t+swing*hemisphere,-90,75).toFixed(2);
 }
 onProgress?.(.32);
 // Downwind transport: the nearest upwind neighbors supply a weighted humidity
 // value. Sea cells refill the air; mountains precipitate moisture before it
 // reaches the leeward side. This creates coherent rain shadows, not random
 // per-cell spots. A small background moisture term avoids absolute dry traps.
 for(const {i} of projection){
  const c=cells[i];
  if(water[i]){airMoisture[i]=1;continue;}
  let supply=0,weight=0;
  for(const j of c.neighbors){
   const d=(c.x-cells[j].x)*wx+(c.y-cells[j].y)*wy;
   if(d<=1e-6)continue;
   const w=d/(Math.hypot(c.x-cells[j].x,c.y-cells[j].y)||1);
   // Background exchange scales with travel distance; orographic loss
   // scales with total ascent, not the number of graph edges crossed.
   const mixing=-Math.log(.91)*d/REFERENCE_DISTANCE_KM;
   const rise=Math.max(0,elevationToKm(heights[i],heights[j]));
   const loss=mixing+shadow*rise*1.9/ELEVATION_KM_PER_UNIT;
   // Exact exponential exchange on a constant-slope edge: subdividing
   // that edge leaves the atmospheric moisture at its endpoint unchanged.
   const equilibrium=(.06/.09)*mixing/loss;
   const incoming=airMoisture[j]+(equilibrium-airMoisture[j])*(-Math.expm1(-loss));
   supply+=incoming*w;
   weight+=w;
  }
  airMoisture[i]=clamp(weight>0?supply/weight:.43,0,1.3);
 }
 onProgress?.(.60);
 let totalRain=0,totalTemp=0,totalArea=0,minTemp=Infinity,maxTemp=-Infinity;
 for(let i=0;i<n;i++){
  const c=cells[i],at=Math.abs(latitudes[i]),w=water[i];
  const tropics=1+.92*Math.exp(-(((at)/16)**2))-.67*Math.exp(-(((at-28)/14)**2))+.32*Math.exp(-(((at-55)/14)**2));
  let ascent=0,weight=0;
  for(const j of c.neighbors){const d=(c.x-cells[j].x)*wx+(c.y-cells[j].y)*wy;if(d<=0)continue;const ww=d/(Math.hypot(c.x-cells[j].x,c.y-cells[j].y)||1);ascent+=Math.max(0,elevationToKm(heights[i],heights[j]))*REFERENCE_DISTANCE_KM/Math.max(.001,Math.hypot(c.x-cells[j].x,c.y-cells[j].y))*ww;weight+=ww;}
  const rise=weight?ascent/weight:0;
  const relative=clamp(tropics*(.18+airMoisture[i]*1.12)*(1+shadow*Math.min(1.3,rise*(2.3/ELEVATION_KM_PER_UNIT)))*(.85+.25*noise(c.x/300,c.y/300,seed+3)),.015,4.4);
  const mm=clamp(baseRain*relative,8,12000);
  precipitation[i]=+mm.toFixed(1);
  // Summer rainfall is mildly more concentrated over continental areas;
  // this is an explicit approximation rather than a circulation solver.
  const season=clamp((tilt/45)*.24*(w?.3:1)*Math.sin(latitudes[i]*Math.PI/180),-.24,.24);
  janRain[i]=+(mm/12*(1-2*season)).toFixed(1);
  julRain[i]=+(mm/12*(1+2*season)).toFixed(1);
  humidity[i]=+clamp(airMoisture[i]/1.3,0,1).toFixed(4);
  // Simple availability proxy for the later vegetation/biome layer.
  moisture[i]=+clamp(mm/(mm+350+Math.max(0,meanTemp[i])*28),0,1).toFixed(4);
  const area=cellArea(c);totalArea+=area;totalRain+=mm*area;totalTemp+=meanTemp[i]*area;minTemp=Math.min(minTemp,meanTemp[i]);maxTemp=Math.max(maxTemp,meanTemp[i]);
 }
 onProgress?.(1);
 return {meanTemp,seasonalRange,latitudes,precipitation,humidity,moisture,janTemp,julTemp,janRain,julRain,
  summary:{avgTemp:+(totalTemp/totalArea).toFixed(1),avgRain:+(totalRain/totalArea).toFixed(1),minTemp,maxTemp}};
}

/** Priority-flood hydrology. Elevations are immutable. Water moves along a
 * directed forest rooted at the ocean; parents are always visited before their
 * children, including within level-filled depressions. Unlike a naive local
 * steepest-downhill pass, this cannot create drainage cycles or stranded sinks.
 * Filled heights approximate spill levels; cell-resolution lakes are candidates
 * for retained water, not a transient fluid dynamics simulation.
 */
class MinHeap {
 constructor(){this.a=[];}
 push(height,index){const a=this.a;let i=a.length;a.push([height,index]);while(i>0){const j=(i-1)>>1;if(a[j][0]<height||(a[j][0]===height&&a[j][1]<=index))break;a[i]=a[j];i=j;}a[i]=[height,index];}
 pop(){const a=this.a,top=a[0],last=a.pop();if(a.length){let i=0;while(2*i+1<a.length){let j=2*i+1;if(j+1<a.length&&(a[j+1][0]<a[j][0]||(a[j+1][0]===a[j][0]&&a[j+1][1]<a[j][1])))j++;if(last[0]<a[j][0]||(last[0]===a[j][0]&&last[1]<=a[j][1]))break;a[i]=a[j];i=j;}a[i]=last;}return top;}
 get length(){return this.a.length;}
}
/** Multi-source Dijkstra over geographic edges, with optional traversal
 * mask. Unreachable sites remain Infinity and have no source. */
export function geographicDistances(cells,sources,allowed=()=>true){
 const distance=new Float64Array(cells.length).fill(Infinity);
 const source=new Int32Array(cells.length).fill(-1),heap=new MinHeap();
 for(const i of sources)if(allowed(i)&&distance[i]!==0){distance[i]=0;source[i]=i;heap.push(0,i);}
 while(heap.length){
  const [d,i]=heap.pop();if(d!==distance[i])continue;
  const c=cells[i];for(const j of c.neighbors){
   if(!allowed(j))continue;
   const next=d+Math.hypot(c.x-cells[j].x,c.y-cells[j].y);
   if(next<distance[j]){distance[j]=next;source[j]=source[i];heap.push(next,j);}
  }
 }
 return {distance,source};
}
export function generateHydrology(mesh,coasts,erosion,climate,settings,onProgress=null){
 const cells=mesh?.cells,n=cells?.length||0;
 if(!n||coasts?.water?.length!==n||erosion?.elevations?.length!==n||climate?.precipitation?.length!==n||climate?.meanTemp?.length!==n||climate?.moisture?.length!==n)throw Error('Hydrology requires matching coast, erosion and climate layers');
 const sea=coasts.seaLevel,water=coasts.water,heights=erosion.elevations,areas=cells.map(cellArea);
 const scale=clamp(Number(settings.runoffScale),0.1,2.5),infiltration=clamp(Number(settings.infiltration),0,0.95),evaporation=clamp(Number(settings.evaporation),0,1.5);
 const riverThreshold=clamp(Number(settings.riverThreshold),2,120),lakeMinDepth=elevationToKm(clamp(Number(settings.lakeDepth),.002,.3)),minLakeCells=clamp(Math.round(Number(settings.minLakeCells)),1,15);
 const seed=Number(settings.seed)|0;
 const spill=new Float64Array(n),flowTo=new Array(n).fill(-1),seen=new Uint8Array(n),order=[],heap=new MinHeap();
 let coastalOutlets=0;
 for(let i=0;i<n;i++)if(water[i]){seen[i]=1;spill[i]=sea;heap.push(sea,i);coastalOutlets++;}
 // Unusual imported or explicitly all-land test graphs still get an outlet.
 if(!heap.length){let low=0;for(let i=1;i<n;i++)if(heights[i]<heights[low])low=i;seen[low]=1;spill[low]=heights[low];heap.push(spill[low],low);}
 let visited=0;
 while(true){
  while(heap.length){
   const [h,i]=heap.pop();order.push(i);visited++;
   for(const j of cells[i].neighbors){
    if(seen[j])continue;seen[j]=1;flowTo[j]=i;
    spill[j]=Math.max(heights[j],h);heap.push(spill[j],j);
   }
  }
  if(visited===n)break;
  // Defensively handle disconnected graphs; do not strand portions of a world.
  let low=-1;for(let i=0;i<n;i++)if(!seen[i]&&(low<0||heights[i]<heights[low]))low=i;
  if(low<0)break;seen[low]=1;spill[low]=heights[low];heap.push(spill[low],low);
 }
 onProgress?.(.30);
 const localRunoff=new Array(n),discharge=new Float64Array(n),catchmentArea=new Float64Array(n);
 for(let i=0;i<n;i++){
  catchmentArea[i]=water[i]?0:areas[i];
  if(water[i]){localRunoff[i]=0;continue;}
  const temp=Math.max(0,climate.meanTemp[i]);
  // A deliberately simple annual water balance: rainfall minus infiltration
  // and temperature-dependent evapotranspiration. Units are km³/year.
  const evapMm=evaporation*(85+temp*13);
  const retention=clamp(.94+.12*noise(cells[i].x/350,cells[i].y/350,seed+53),.82,1.06);
  const availableMm=Math.max(0,climate.precipitation[i]*scale*retention*(1-infiltration)-evapMm);
  const volume=availableMm*areas[i]*1e-6;
  localRunoff[i]=+volume.toFixed(6);discharge[i]=volume;
 }
 // Reverse flood order: children before parents, so accumulation is exact
 // even when the terrain contains a flat depression or multiple spill paths.
 for(let k=order.length-1;k>=0;k--){const i=order[k],j=flowTo[i];if(j<0)continue;
  discharge[j]+=discharge[i];catchmentArea[j]+=catchmentArea[i];
 }
 onProgress?.(.60);
 const thresholdArea=riverThreshold*REFERENCE_AREA_KM2;
 const channels=[];let totalRunoff=0,riverCount=0,maxDischarge=0;
 for(let i=0;i<n;i++){
  if(!water[i]){totalRunoff+=localRunoff[i];maxDischarge=Math.max(maxDischarge,discharge[i]);
   if(flowTo[i]>=0&&catchmentArea[i]>=thresholdArea&&discharge[i]>=thresholdArea*.00012){channels.push(i);riverCount++;}
  }
 }
 const candidate=new Uint8Array(n),lakeId=new Array(n).fill(-1),lakeDepth=new Array(n).fill(0),lakeLevel=new Array(n).fill(null);
 for(let i=0;i<n;i++)if(!water[i]){
  const depth=Math.max(0,elevationToKm(spill[i],heights[i]));
  // The moisture gate suppresses permanent lakes in the most arid basins.
  if(depth>=lakeMinDepth&&climate.moisture[i]>=.12&&localRunoff[i]>0)candidate[i]=1;
 }
 // Persist spill elevations, lake levels and depths in legacy elevation units.
 const lakes=[];
 for(let i=0;i<n;i++){
  if(!candidate[i]||lakeId[i]!==-1)continue;
  const group=[i];lakeId[i]=-2;
  for(let k=0;k<group.length;k++)for(const j of cells[group[k]].neighbors){
   if(!candidate[j]||lakeId[j]!==-1||Math.abs(elevationToKm(spill[group[k]],spill[j]))>elevationToKm(.0002))continue;
   lakeId[j]=-2;group.push(j);
  }
  if(group.length<minLakeCells){for(const j of group)lakeId[j]=-1;continue;}
  const id=lakes.length,areaKm2=group.reduce((a,j)=>a+areas[j],0),maxDepth=Math.max(...group.map(j=>spill[j]-heights[j]));
  // The surface of a flood-filled depression is a common local spill level.
  const level=spill[group[0]];
  for(const j of group){lakeId[j]=id;lakeDepth[j]=+(spill[j]-heights[j]).toFixed(4);lakeLevel[j]=+level.toFixed(4);}
  lakes.push({id,cells:group,areaKm2:+areaKm2.toFixed(2),level:+level.toFixed(4),maxDepth:+maxDepth.toFixed(4)});
 }
 onProgress?.(.84);
 // Identify drainage outlet for every non-ocean cell. Ocean cells are their own
 // terminal outlets. The connected forest enables efficient downstream tracing.
 const outlet=new Array(n).fill(-1);
 for(const i of order){const j=flowTo[i];outlet[i]=j<0?i:outlet[j];}
 const result={
  flowTo,catchmentArea:Array.from(catchmentArea,x=>+x.toFixed(2)),
  localRunoff,discharge:Array.from(discharge,x=>+x.toFixed(6)),
  spillElevation:Array.from(spill,x=>+x.toFixed(4)),
  lakeId,lakeDepth,lakeLevel,lakes,channels,outlet,
  summary:{rivers:riverCount,lakes:lakes.length,lakeAreaKm2:+lakes.reduce((a,l)=>a+l.areaKm2,0).toFixed(2),coastalOutlets,
   maxDischarge:+maxDischarge.toFixed(3),annualRunoffKm3:+totalRunoff.toFixed(3)}
 };
 onProgress?.(1);return result;
}

/** First-order soils derived from locked geology, topography, climate and water.
 * Each cell stores an interpretable surface/regolith estimate rather than a
 * geological timescale simulator. A lake or ocean cell cannot accumulate soil.
 * Calculations are deterministic, bounded, and never mutate earlier layers.
 */
export function generateSoils(mesh,plates,landforms,coasts,erosion,climate,hydrology,settings,onProgress=null){
 const cells=mesh?.cells,n=cells?.length||0;
 if(!n||plates?.owners?.length!==n||landforms?.classes?.length!==n||landforms?.ruggedness?.length!==n||coasts?.water?.length!==n||erosion?.elevations?.length!==n||erosion?.erosionDepth?.length!==n||erosion?.deposition?.length!==n||climate?.meanTemp?.length!==n||climate?.precipitation?.length!==n||climate?.moisture?.length!==n||hydrology?.flowTo?.length!==n||hydrology?.catchmentArea?.length!==n||hydrology?.lakeId?.length!==n)throw Error('Soils require matching geology, terrain, climate and hydrology layers');
 const weathering=clamp(Number(settings.weathering),0,2),organicInput=clamp(Number(settings.organicInput),0,2),alluvialInput=clamp(Number(settings.alluvialInput),0,2),permeabilityBias=clamp(Number(settings.permeabilityBias),.25,2),groundwaterRecharge=clamp(Number(settings.groundwaterRecharge),0,2),seed=(Number(settings.seed)|0);
 const soilType=new Array(n),depthM=new Array(n),organicMatter=new Array(n),permeability=new Array(n),fertility=new Array(n),groundwater=new Array(n),erosionRisk=new Array(n);
 const areas=cells.map(cellArea),maxCatchment=Math.max(1,...hydrology.catchmentArea);
 const areaCount=new Array(SOIL_NAMES.length).fill(0),landCounts={land:0,deep:0,veryFertile:0},total={depth:0,fertility:0,groundwater:0,area:0,fertileArea:0};
 for(let i=0;i<n;i++){
  const noSoil=!!coasts.water[i]||hydrology.lakeId[i]>=0;
  if(noSoil){soilType[i]=0;depthM[i]=0;organicMatter[i]=0;permeability[i]=0;fertility[i]=0;groundwater[i]=0;erosionRisk[i]=0;areaCount[0]++;continue;}
  const c=cells[i],temp=climate.meanTemp[i],precip=climate.precipitation[i],moist=clamp(climate.moisture[i],0,1),rough=clamp(landforms.ruggedness[i],0,1);
  const continental=!!plates.plates[plates.owners[i]]?.continental;
  const volcanic=landforms.classes[i]===7;
  const polar=clamp((-temp+4)/20,0,1),dry=clamp((350-precip)/350,0,1),temperature=clamp((temp+8)/35,0,1);
  // Slope normalized to a fixed reference distance, rather than raw
  // height difference (which shrinks as polygons become smaller).
  const slope=clamp(c.neighbors.reduce((sum,j)=>sum+physicalSlope(Math.abs(erosion.elevations[i]-erosion.elevations[j]),Math.max(.001,Math.hypot(c.x-cells[j].x,c.y-cells[j].y))),0)/Math.max(1,c.neighbors.length)*(.95*REFERENCE_DISTANCE_KM/ELEVATION_KM_PER_UNIT),0,1);
  const proximity=clamp(Math.log1p(hydrology.catchmentArea[i])/Math.log1p(maxCatchment),0,1);
  const floodplain=clamp((1-slope)*(1-rough*.7)*(.33+proximity*.67),0,1);
  const deposited=clamp(elevationToKm(erosion.deposition[i])*(9/ELEVATION_KM_PER_UNIT),0,1),stripped=clamp(elevationToKm(erosion.erosionDepth[i])*(5/ELEVATION_KM_PER_UNIT),0,1);
  const mineral=clamp(.42+.22*(continental?1:0)+.2*(volcanic?1:0)+noise(c.x/300,c.y/300,seed+31)*.12,0,1);
  const wetWeathering=clamp(.2+.8*moist,0,1)*(.38+.62*temperature)*(1-polar*.75);
  const buildup=weathering*wetWeathering*(.45+.55*mineral)*(1-slope*.6);
  const accumulation=alluvialInput*(floodplain*.5+deposited*.9);
  const depth=clamp(.32+4.0*buildup+3.0*accumulation-.65*stripped-.65*slope-.35*polar,0,7);
  const variable=clamp((noise(c.x/170,c.y/170,seed+79)+1)*.5,0,1);
  const clay=clamp(.18+wetWeathering*.6+(1-variable)*.22-.3*(slope+.5*dry),0,1);
  const coarse=clamp(variable*.6+dry*.3+slope*.45-clay*.45,0,1);
  const organic=clamp(organicInput*(.05+moist*.35+floodplain*.12)*(1-.55*dry)*(1-.55*polar)+.1*deposited,0,1);
  const drainage=clamp(permeabilityBias*(.2+coarse*.68-clay*.36+.12*slope)-.35*floodplain*moist,0,1);
  const groundwaterPotential=clamp(groundwaterRecharge*(.13+.46*moist+.21*floodplain+.15*proximity)*(.85+.15*drainage)*(1-.55*slope),0,1);
  const richness=clamp(1.35*(.17+.44*mineral+.27*organic+.12*deposited)*Math.min(1,.25+depth/1.65)*(.5+.5*moist)*(1-.7*polar)*(1-.3*dry),0,1);
  const risk=clamp((.38*slope+.22*rough+.22*stripped+.2*precip/3000)*(1-.45*organic)*(1-.32*Math.min(depth/3,1)),0,1);
  let kind=4;
  if(depth<.22)kind=1;
  else if(depth<.65&&(slope>.35||rough>.65))kind=2;
  else if(polar>.58)kind=9;
  else if(dry>.55)kind=8;
  else if(volcanic&&depth>.55)kind=7;
  else if(groundwaterPotential>.66&&moist>.6&&floodplain>.4)kind=6;
  else if(clay>.59&&drainage<.45)kind=5;
  else if(coarse>.62)kind=3;
  soilType[i]=kind;areaCount[kind]++;
  depthM[i]=+depth.toFixed(3);organicMatter[i]=+organic.toFixed(4);permeability[i]=+drainage.toFixed(4);fertility[i]=+richness.toFixed(4);groundwater[i]=+groundwaterPotential.toFixed(4);erosionRisk[i]=+risk.toFixed(4);
  const a=areas[i];landCounts.land++;if(depth>1.5)landCounts.deep++;if(richness>.5)landCounts.veryFertile++;
  total.depth+=depth*a;total.fertility+=richness*a;total.groundwater+=groundwaterPotential*a;total.area+=a;if(richness>.5)total.fertileArea+=a;
  if(i%128===0)onProgress?.(.9*i/n);
 }
 onProgress?.(1);
 return {soilType,depthM,organicMatter,permeability,fertility,groundwater,erosionRisk,counts:areaCount,
  summary:{landCells:landCounts.land,deepSoilCells:landCounts.deep,highFertilityCells:landCounts.veryFertile,
   meanDepthM:+(total.depth/Math.max(1,total.area)).toFixed(3),meanFertility:+(total.fertility/Math.max(1,total.area)).toFixed(4),
   meanGroundwater:+(total.groundwater/Math.max(1,total.area)).toFixed(4),highFertilityAreaKm2:+total.fertileArea.toFixed(1)}};
}

/** Environmental biome classification at Voronoi resolution. These are
 * potential natural ecosystems inferred from the *locked* terrain, climate,
 * soils and surface water, not a time-evolving vegetation simulation. The
 * temperature/rainfall modifiers are local to this stage and never rewrite
 * the climate layer. Neighborhood boundaries are inspected only after every
 * cell has its class, keeping the classification independent of iteration.
 */
export function generateBiomes(mesh,coasts,landforms,erosion,climate,hydrology,soils,settings,onProgress=null){
 const cells=mesh?.cells,n=cells?.length||0;
 if(!n||coasts?.water?.length!==n||landforms?.classes?.length!==n||landforms?.ruggedness?.length!==n
   ||erosion?.elevations?.length!==n||climate?.meanTemp?.length!==n||climate?.janTemp?.length!==n
   ||climate?.julTemp?.length!==n||climate?.precipitation?.length!==n||climate?.moisture?.length!==n
   ||hydrology?.lakeId?.length!==n||hydrology?.channels===undefined||soils?.soilType?.length!==n
   ||soils?.fertility?.length!==n||soils?.depthM?.length!==n||soils?.groundwater?.length!==n)
  throw Error('Biomes require completed matching coast, landform, erosion, climate, hydrology and soil layers');
 const shift=clamp(Number(settings.temperatureShift),-12,12),rainFactor=clamp(Number(settings.rainfallResponse),.4,1.8);
 const forestGate=clamp(Number(settings.forestThreshold),.45,1.8),wetlandGate=clamp(Number(settings.wetlandThreshold),.4,.95);
 const alpineLimit=clamp(Number(settings.alpineLimit),0,16),variation=clamp(Number(settings.patchVariation),0,.4),seed=Number(settings.seed)|0;
 const biome=new Array(n),treePotential=new Array(n),productivity=new Array(n),waterStress=new Array(n),growingMonths=new Array(n),ecotone=new Array(n).fill(0);
 const counts=new Array(BIOME_NAMES.length).fill(0),areaKm2ByBiome=new Array(BIOME_NAMES.length).fill(0);
 const canopyBase=[0,0,0,.01,.64,.91,.77,.08,.03,0,.23,.98,.80,.16,.01,.12,.55];
 let landArea=0,productSum=0,canopySum=0,monthsSum=0,landCells=0;
 for(let i=0;i<n;i++){
  const c=cells[i],area=cellArea(c);
  let kind=0,canopy=0,output=0,months=0,stress=0;
  if(coasts.water[i])kind=0;
  else if(hydrology.lakeId[i]>=0)kind=1;
  else{
   const t=climate.meanTemp[i]+shift,warm=Math.max(climate.janTemp[i],climate.julTemp[i])+shift;
   const cold=Math.min(climate.janTemp[i],climate.julTemp[i])+shift;
   const rainfall=climate.precipitation[i]*rainFactor;
   // Low-frequency variation shifts regional moisture, avoiding unrelated
   // checkerboard-style biome noise between neighboring Voronoi cells.
   const patch=1+variation*fbm(c.x/(REFERENCE_DISTANCE_KM*7),c.y/(REFERENCE_DISTANCE_KM*7),seed+191,3);
   const pet=Math.max(150,180+Math.max(0,t+5)*44+climate.seasonalRange[i]*9);
   const ratio=rainfall*patch/pet;
   const drought=clamp(1-ratio/forestGate,0,1);
   stress=+drought.toFixed(4);
   // The annual sinusoidal approximation uses actual January/July extrema.
   const amplitude=Math.abs(warm-cold)/2,center=(warm+cold)/2;
   months=0;for(let month=0;month<12;month++)if(center+amplitude*Math.cos((month+.5)/12*Math.PI*2)>5)months++;
   const mountain=(landforms.classes[i]===6||landforms.classes[i]===5||landforms.ruggedness[i]>.35)
      &&elevationToKm(erosion.elevations[i],coasts.seaLevel)>elevationToKm(.30);
   const permanentlyCold=warm<2||t< -17;
   const isAlpine=mountain&&warm<alpineLimit;
   const bog=soils.groundwater[i]>=wetlandGate&&landforms.ruggedness[i]<.30
      &&rainfall>400&&ratio>forestGate*.72;
   if(permanentlyCold)kind=2;
   else if(isAlpine)kind=14;
   else if(warm<10||t< -8)kind=3;
   else if(ratio<.24)kind=9;
   else if(bog)kind=15;
   else if(t<4)kind=ratio>=forestGate*.72?4:ratio<.5?8:3;
   else if(t>=18){
    kind=ratio>=forestGate*1.8&&rainfall>1400?11:ratio>=forestGate?12:ratio<.52?8:13;
   }else if(ratio<.52)kind=8;
   else if(ratio<forestGate){
    kind=t>8&&climate.seasonalRange[i]>=8&&ratio>=.62?10:7;
   }else if(mountain)kind=16;
   else if(ratio>=forestGate*1.65&&rainfall>1200)kind=5;
   else kind=6;
   // Water/soil/thermal constraints give a potential vegetation envelope.
   const warmth=clamp((warm-2)/22,0,1),water=clamp((ratio-.18)/1.35,0,1);
   const substrate=clamp(.26+soils.fertility[i]*.52+Math.min(2,soils.depthM[i])*.11,0,1);
   output=clamp(warmth*water*substrate*(.35+.65*months/12),0,1);
   canopy=clamp(canopyBase[kind]*(.42+.58*water)*(.45+.55*substrate),0,1);
   if(kind===2||kind===3||kind===9||kind===14){canopy=0;output*=kind===2?.02:.20;}
   landArea+=area;landCells++;productSum+=output*area;canopySum+=canopy*area;monthsSum+=months*area;
  }
  biome[i]=kind;counts[kind]++;areaKm2ByBiome[kind]+=area;
  treePotential[i]=+canopy.toFixed(4);productivity[i]=+output.toFixed(4);waterStress[i]=stress;growingMonths[i]=months;
  if(i%128===0)onProgress?.(.8*i/n);
 }
 // Ecotone score measures unlike neighboring LAND classes. This reflects
 // geographic transitions, not random dithering or a new habitat simulation.
 for(let i=0;i<n;i++){
  if(biome[i]<2)continue;
  const adjacent=cells[i].neighbors.filter(j=>biome[j]>=2);
  if(adjacent.length)ecotone[i]=+(adjacent.filter(j=>biome[j]!==biome[i]).length/adjacent.length).toFixed(4);
 }
 onProgress?.(1);
 return {biome,treePotential,productivity,waterStress,growingMonths,ecotone,counts,
  areaKm2ByBiome:areaKm2ByBiome.map(x=>+x.toFixed(2)),
  summary:{landCells,forestAreaKm2:+[4,5,6,11,12,16].reduce((a,k)=>a+areaKm2ByBiome[k],0).toFixed(2),
   drylandAreaKm2:+[8,9,10,13].reduce((a,k)=>a+areaKm2ByBiome[k],0).toFixed(2),
   wetlandAreaKm2:+areaKm2ByBiome[15].toFixed(2),
   meanProductivity:+(productSum/Math.max(1,landArea)).toFixed(4),
   meanTreePotential:+(canopySum/Math.max(1,landArea)).toFixed(4),
   meanGrowingMonths:+(monthsSum/Math.max(1,landArea)).toFixed(2)}};
}


/** Voronoi-scale potential vegetation: a static landscape snapshot, not a
 * time-stepped growth model. Earlier environmental suitability is immutable.
 * Climate, soils, waterways, and biome data are read but never mutated.
 * Neighbor-propagated riparian influence has a fixed geographic reach,
 * and low-frequency patch noise avoids cell-by-cell random speckling.
 */
export function generateVegetation(mesh,coasts,climate,hydrology,soils,biomes,settings,onProgress=null){
 const cells=mesh?.cells,n=cells?.length||0;
 if(!n||coasts?.water?.length!==n||climate?.precipitation?.length!==n||climate?.meanTemp?.length!==n
  ||hydrology?.lakeId?.length!==n||!Array.isArray(hydrology?.channels)
  ||soils?.fertility?.length!==n||soils?.groundwater?.length!==n
  ||biomes?.biome?.length!==n||biomes?.treePotential?.length!==n
  ||biomes?.productivity?.length!==n||biomes?.ecotone?.length!==n)
  throw Error('Vegetation requires completed matching coast, climate, hydrology, soil and biome layers');
 const density=clamp(Number(settings.vegetationDensity),.2,1.8);
 const maturity=clamp(Number(settings.maturity),0,1);
 const disturbance=clamp(Number(settings.disturbance),0,1);
 const riparianStrength=clamp(Number(settings.riparianStrength),0,1.5);
 const patchiness=clamp(Number(settings.patchiness),0,.45);
 const seed=Number(settings.seed)|0;
 const isLand=i=>!coasts.water[i]&&hydrology.lakeId[i]<0;
 const sources=new Set(hydrology.channels.filter(i=>i>=0&&i<n&&isLand(i)));
 for(let i=0;i<n;i++)if(isLand(i)&&cells[i].neighbors.some(j=>hydrology.lakeId[j]>=0))sources.add(i);
 const {distance}=geographicDistances(cells,sources,isLand);
 const influence=Array.from(distance,d=>d<=3*REFERENCE_DISTANCE_KM?Math.pow(.53,d/REFERENCE_DISTANCE_KM):0);
 onProgress?.(.12);
 const coverClass=new Array(n),canopyCover=new Array(n),groundCover=new Array(n);
 const biomass=new Array(n),heightM=new Array(n),habitatComplexity=new Array(n),riparian=new Array(n);
 const counts=new Array(VEGETATION_NAMES.length).fill(0);
 const areaKm2ByClass=new Array(VEGETATION_NAMES.length).fill(0);
 let landCells=0,landArea=0,canopySum=0,groundSum=0,biomassSum=0,heightSum=0;
 for(let i=0;i<n;i++){
  const c=cells[i],biome=biomes.biome[i],area=cellArea(c);
  let kind=0,canopy=0,ground=0,mass=0,height=0,rip=0,complexity=0;
  if(coasts.water[i])kind=0;
  else if(hydrology.lakeId[i]>=0)kind=1;
  else{
   const patch=1+patchiness*fbm(c.x/(REFERENCE_DISTANCE_KM*5),c.y/(REFERENCE_DISTANCE_KM*5),seed+219,4);
   const vigor=clamp(density*patch,0,2);
   rip=clamp(influence[i],0,1);
   const fertile=clamp(.6+.4*soils.fertility[i],0,1);
   const ripGain=1+rip*riparianStrength*(.18+.24*soils.groundwater[i]);
   canopy=clamp(biomes.treePotential[i]*vigor*(.45+.55*maturity)*(1-disturbance*.62)*ripGain,0,1);
   ground=clamp(biomes.productivity[i]*vigor*(.75+.25*maturity)*(1-disturbance*.28)
      *fertile*(1+.35*rip*riparianStrength)*(1-.22*canopy),0,1);
   // Ground vegetation and woody material are distinct contributions;
   // this index is not tonnes of carbon or an ecological population count.
   mass=clamp((.76*canopy+.24*ground)*(.42+.58*maturity)*(1-.38*disturbance),0,1);
   height=clamp(canopy*(11+25*maturity)*(1-disturbance*.35)+ground*(.15+1.1*maturity),0,40);
   if(biome===2){canopy=0;ground=0;mass=0;height=0;} // Permanent ice is unvegetated.
   if(biome===2)kind=2; // Snow or ice remains unvegetated.
   else if(biome===15&&ground>.06)kind=9;
   else if(canopy>.64)kind=([5,11,12].includes(biome)||biomes.productivity[i]>.72)?8:7;
   else if(canopy>.23)kind=6;
   else if(rip>.52&&ground>.18)kind=10;
   else if(biome===14&&ground>.06)kind=11;
   else if(biome===3&&ground>.03)kind=3;
   else if(biome===9&&ground>.015)kind=12;
   else if(ground>.35)kind=4;
   else if(ground>.065||canopy>.035)kind=5;
   else kind=2;
   // Structural complexity can be high at ecotones, among mixed growth,
   // and in vegetated river corridors; it is potential habitat only.
   const mixture=1-Math.abs(canopy-ground);
   complexity=clamp(.28*ground+.28*canopy+.18*mixture*Math.max(canopy,ground)
      +.14*biomes.ecotone[i]+.12*rip*Math.max(canopy,ground),0,1);
   landCells++;landArea+=area;
   canopySum+=canopy*area;groundSum+=ground*area;biomassSum+=mass*area;heightSum+=height*area;
  }
  coverClass[i]=kind;counts[kind]++;areaKm2ByClass[kind]+=area;
  canopyCover[i]=+canopy.toFixed(4);groundCover[i]=+ground.toFixed(4);
  biomass[i]=+mass.toFixed(4);heightM[i]=+height.toFixed(2);
  habitatComplexity[i]=+complexity.toFixed(4);riparian[i]=+rip.toFixed(4);
  if(i%128===0)onProgress?.(.12+.88*i/n);
 }
 onProgress?.(1);
 const forestArea=[7,8].reduce((sum,k)=>sum+areaKm2ByClass[k],0);
 const vegetatedArea=areaKm2ByClass.reduce((sum,area,k)=>sum+(k>2?area:0),0);
 return {coverClass,canopyCover,groundCover,biomass,heightM,habitatComplexity,riparian,counts,
  areaKm2ByClass:areaKm2ByClass.map(x=>+x.toFixed(2)),
  summary:{landCells,forestAreaKm2:+forestArea.toFixed(2),vegetatedAreaKm2:+vegetatedArea.toFixed(2),
   meanCanopy:+(canopySum/Math.max(landArea,1)).toFixed(4),
   meanGroundCover:+(groundSum/Math.max(landArea,1)).toFixed(4),
   meanBiomass:+(biomassSum/Math.max(landArea,1)).toFixed(4),
   meanHeightM:+(heightSum/Math.max(landArea,1)).toFixed(2)}};
}

export function generateStage(stage,locked,settings,onProgress=null){
 const geometry=locked[0]?.data,mesh=locked[1]?.data;
 if(stage===1)return generateGeometry(settings);
 if(stage===2){if(!geometry)throw Error('World geometry required');return generateMesh(settings,onProgress,geometry);}
 if(stage===3){if(!mesh)throw Error('Voronoi mesh required');return generatePlates(mesh,settings);}
 if(stage===4){if(!locked[2]?.data)throw Error('Tectonic layer required');return generateElevation(mesh,locked[2].data,settings);}
 if(stage===5){if(!locked[3]?.data)throw Error('Elevation layer required');return generateCoasts(locked[3].data,settings,mesh);}
 if(stage===6){if(!locked[4]?.data)throw Error('Ocean layer required');return generateLandforms(mesh,locked[2].data,locked[3].data,locked[4].data,settings);}
 if(stage===7){if(!locked[5]?.data)throw Error('Landform layer required');return generateErosion(mesh,locked[4].data,locked[5].data,settings,onProgress);}
 if(stage===8){if(!locked[6]?.data)throw Error('Erosion layer required');return generateClimate(mesh,locked[4].data,locked[6].data,settings,onProgress);}
 if(stage===9){if(!locked[7]?.data)throw Error('Climate layer required');return generateHydrology(mesh,locked[4].data,locked[6].data,locked[7].data,settings,onProgress);}
 if(stage===10){if(!locked[8]?.data)throw Error('Hydrology layer required');return generateSoils(mesh,locked[2].data,locked[5].data,locked[4].data,locked[6].data,locked[7].data,locked[8].data,settings,onProgress);}
 if(stage===11){if(!locked[9]?.data)throw Error('Soil layer required');return generateBiomes(mesh,locked[4].data,locked[5].data,locked[6].data,locked[7].data,locked[8].data,locked[9].data,settings,onProgress);}
 if(stage===12){if(!locked[10]?.data)throw Error('Biome layer required');return generateVegetation(mesh,locked[4].data,locked[7].data,locked[8].data,locked[9].data,locked[10].data,settings,onProgress);}
 throw Error('Stage not yet implemented');
}
export function newWorld(name='Untitled world'){
 return {schema:SCHEMA_VERSION,id:`world-${Date.now()}`,name,created:new Date().toISOString(),updated:new Date().toISOString(),locked:[],working:{stage:1,settings:{...DEFAULTS[1]},data:null,dataSettings:null},viewStage:1,viewMode:'auto',showEdges:true,showPlateBorders:false,showCoastBorders:false,showFlow:false,exploreMode:false,consoleHeightRatio:.36,selected:null};
}
export function validateWorld(world){
 if(!world||world.schema!==SCHEMA_VERSION||!Array.isArray(world.locked)||world.locked.length>IMPLEMENTED)throw Error('Unsupported or invalid world save');
 if(typeof world.name!=='string'||world.name.length>200)throw Error('Save has an invalid world name');
 for(let i=0;i<world.locked.length;i++)if(world.locked[i]?.stage!==i+1||!world.locked[i]?.data)throw Error('Save has missing or unordered layers');
 if(!world.working||!Number.isInteger(world.working.stage)||world.working.stage<1||world.working.stage>IMPLEMENTED+1)throw Error('Save has invalid working layer');
 if(world.working.stage!==world.locked.length+1)throw Error('Save has inconsistent layer progression');
 if(world.working.data!=null&&(typeof world.working.data!=='object'||Array.isArray(world.working.data)||world.working.stage>IMPLEMENTED))throw Error('Invalid working layer data');
 const records=[...world.locked];if(world.working.data)records.push(world.working);
 if(records.some(r=>!r.data||typeof r.data!=='object'||Array.isArray(r.data)))throw Error('Invalid generated layer data');
 const geom=records.find(r=>r.stage===1)?.data;
 if(geom){
  if(!['rectangle','circle','ellipse'].includes(geom.shape)||![geom.width,geom.height,geom.areaKm2].every(v=>Number.isFinite(v)&&v>0))throw Error('Invalid world geometry');
  if(geom.shape!=='rectangle'&&(!Number.isFinite(geom.radiusX)||!Number.isFinite(geom.radiusY)||(geom.shape==='circle'&&geom.radiusX!==geom.radiusY)))throw Error('Invalid world geometry radii');
  let check;
  try{check=generateGeometry(geom.shape==='circle'?{shape:'circle',radius:geom.radiusX}:geom.shape==='ellipse'?{shape:'ellipse',radiusX:geom.radiusX,radiusY:geom.radiusY}:{shape:'rectangle',width:geom.width,height:geom.height});}
  catch{throw Error('Invalid world geometry');}
  if(Math.abs(check.width-geom.width)>1e-6||Math.abs(check.height-geom.height)>1e-6||Math.abs(check.areaKm2-geom.areaKm2)>Math.max(1,check.areaKm2)*1e-7)throw Error('Inconsistent world geometry');
 }
 const mesh=records.find(r=>r.stage===2)?.data;
 if(mesh){
  if(!geom||!Array.isArray(mesh.cells)||mesh.cells.length<1||mesh.cells.length>MAX_CELLS||mesh.width!==geom.width||mesh.height!==geom.height)throw Error('Invalid world mesh size');
  if(mesh.shape!==geom.shape||!Number.isFinite(mesh.areaKm2)||Math.abs(mesh.areaKm2-geom.areaKm2)>Math.max(1,geom.areaKm2)*1e-7)throw Error('Mesh geometry mismatch');
  for(const c of mesh.cells){
   if(!Number.isFinite(c.x)||!Number.isFinite(c.y)||!insideGeometry(c.x,c.y,geom))throw Error('Invalid mesh site');
   if(!Array.isArray(c.poly)||c.poly.length<6||c.poly.length>512||c.poly.length%2)throw Error('Invalid polygon');
   if(!Array.isArray(c.neighbors)||c.neighbors.length>80||c.neighbors.some(j=>!Number.isInteger(j)||j<0||j>=mesh.cells.length))throw Error('Invalid mesh neighbors');
   if(c.poly.some((v,i)=>!Number.isFinite(v)||v<-.01||v>(i%2?geom.height:geom.width)+.01))throw Error('Invalid polygon coordinates');
   for(let k=0;k<c.poly.length;k+=2)if(!insideGeometry(c.poly[k],c.poly[k+1],geom))throw Error('Polygon extends outside world shape');
  }
 }
 const n=mesh?.cells.length;
 for(const record of records){
  if(record.stage<=2)continue;
  if(!n)throw Error('Missing base mesh for a generated layer');
  const d=record.data;
  if(record.stage===3&&(!Array.isArray(d.plates)||d.plates.length<3||d.plates.length>50||!Array.isArray(d.owners)||d.owners.length!==n||d.owners.some(x=>!Number.isInteger(x)||x<0||x>=d.plates.length)||d.plates.some((p,i)=>p.id!==i||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.vx)||!Number.isFinite(p.vy)||typeof p.continental!=='boolean')))throw Error('Invalid plate data');
  if((record.stage===4||record.stage===6||record.stage===7)&&(!Array.isArray(d.elevations)||d.elevations.length!==n||d.elevations.some(x=>!Number.isFinite(x)||Math.abs(x)>2)))throw Error('Invalid elevation data');
  if(record.stage===5&&(!Array.isArray(d.water)||d.water.length!==n||!Number.isFinite(d.seaLevel)||d.water.some(x=>x!==0&&x!==1)||d.elevations!==undefined&&(!Array.isArray(d.elevations)||d.elevations.length!==n||d.elevations.some(x=>!Number.isFinite(x)||Math.abs(x)>2))))throw Error('Invalid coast data');
  if(record.stage===6&&(!Array.isArray(d.classes)||d.classes.length!==n||d.classes.some(x=>!Number.isInteger(x)||x<0||x>=LANDFORM_NAMES.length)||!Array.isArray(d.ruggedness)||d.ruggedness.length!==n||d.ruggedness.some(x=>!Number.isFinite(x)||x<0||x>1)||!Array.isArray(d.counts)||d.counts.length!==LANDFORM_NAMES.length||d.counts.some(x=>!Number.isInteger(x)||x<0)||d.counts.reduce((a,b)=>a+b,0)!==n||!Array.isArray(d.volcanoes)||d.volcanoes.some(x=>!Number.isInteger(x)||x<0||x>=n)))throw Error('Invalid landform data');
  if(record.stage===7){
   if(!Array.isArray(d.erosionDepth)||!Array.isArray(d.deposition)||!Array.isArray(d.flowTo)||!Array.isArray(d.discharge)||!Array.isArray(d.channels)
    ||[d.erosionDepth,d.deposition,d.flowTo,d.discharge].some(a=>a.length!==n)
    ||d.erosionDepth.some(x=>!Number.isFinite(x)||x<0||x>3)
    ||d.deposition.some(x=>!Number.isFinite(x)||x<0||x>3)
    ||d.discharge.some(x=>!Number.isFinite(x)||x<0)
    ||d.flowTo.some((x,i)=>!Number.isInteger(x)||x< -1||x>=n||x===i||(x>=0&&!mesh.cells[i].neighbors.includes(x)))
    ||d.channels.some(x=>!Number.isInteger(x)||x<0||x>=n)
    ||!d.summary||!Number.isFinite(d.summary.meanErosion)||!Number.isFinite(d.summary.maxDischarge))throw Error('Invalid erosion data');
  }
  if(record.stage===8){
   const bounded={meanTemp:[-65,55],seasonalRange:[0,39],latitudes:[-90,90],precipitation:[8,12000],humidity:[0,1],moisture:[0,1],janTemp:[-90,75],julTemp:[-90,75],janRain:[0,12000],julRain:[0,12000]};
   for(const [key,[min,max]] of Object.entries(bounded))if(!Array.isArray(d[key])||d[key].length!==n||d[key].some(x=>!Number.isFinite(x)||x<min||x>max))throw Error(`Invalid climate data: ${key}`);
   if(!d.summary||!Number.isFinite(d.summary.avgTemp)||!Number.isFinite(d.summary.avgRain)||!Number.isFinite(d.summary.minTemp)||!Number.isFinite(d.summary.maxTemp))throw Error('Invalid climate summary');
  }

  if(record.stage===9){
   const lengths=['flowTo','catchmentArea','localRunoff','discharge','spillElevation','lakeId','lakeDepth','lakeLevel','outlet'];
   if(lengths.some(k=>!Array.isArray(d[k])||d[k].length!==n)||!Array.isArray(d.channels)||!Array.isArray(d.lakes)||!d.summary)throw Error('Invalid hydrology arrays');
   if(d.flowTo.some((j,i)=>!Number.isInteger(j)||j< -1||j>=n||j===i||(j>=0&&!mesh.cells[i].neighbors.includes(j))))throw Error('Invalid hydrology routes');
   for(const key of ['catchmentArea','localRunoff','discharge','lakeDepth'])if(d[key].some(x=>!Number.isFinite(x)||x<0))throw Error(`Invalid hydrology ${key}`);
   if(d.spillElevation.some(x=>!Number.isFinite(x)||Math.abs(x)>2)||d.lakeLevel.some(x=>x!==null&&(!Number.isFinite(x)||Math.abs(x)>2)))throw Error('Invalid hydrology levels');
   if(d.outlet.some(x=>!Number.isInteger(x)||x<0||x>=n)||d.lakeId.some(x=>!Number.isInteger(x)||x< -1||x>=d.lakes.length))throw Error('Invalid hydrology ids');
   if(d.channels.some(x=>!Number.isInteger(x)||x<0||x>=n||records.find(r=>r.stage===5)?.data?.water?.[x]))throw Error('Invalid hydrology channels');
   const seenLakes=new Set();
   for(let id=0;id<d.lakes.length;id++){const lake=d.lakes[id];
    if(lake.id!==id||!Array.isArray(lake.cells)||!lake.cells.length||!Number.isFinite(lake.areaKm2)||lake.areaKm2<=0||!Number.isFinite(lake.level)||!Number.isFinite(lake.maxDepth)||lake.cells.some(j=>!Number.isInteger(j)||j<0||j>=n||d.lakeId[j]!==id||seenLakes.has(j)))throw Error('Invalid hydrology lakes');
    for(const j of lake.cells)seenLakes.add(j);
   }
   if(d.lakeId.some((id,j)=>(id>=0)!==seenLakes.has(j)))throw Error('Invalid hydrology lake membership');
   for(const key of ['rivers','lakes','lakeAreaKm2','coastalOutlets','maxDischarge','annualRunoffKm3'])if(!Number.isFinite(d.summary[key])||d.summary[key]<0)throw Error('Invalid hydrology summary');
   // Route validation also detects nonlocal cycles in untrusted imports.
   const state=new Uint8Array(n);for(let i=0;i<n;i++){let j=i,path=[];while(j>=0&&state[j]===0){state[j]=1;path.push(j);j=d.flowTo[j];}
    if(j>=0&&state[j]===1)throw Error('Invalid hydrology drainage cycle');
    for(const k of path)state[k]=2;
   }
  }
  if(record.stage===10){
   const fields={depthM:[0,7],organicMatter:[0,1],permeability:[0,1],fertility:[0,1],groundwater:[0,1],erosionRisk:[0,1]};
   if(!Array.isArray(d.soilType)||d.soilType.length!==n||d.soilType.some(v=>!Number.isInteger(v)||v<0||v>=SOIL_NAMES.length)||!Array.isArray(d.counts)||d.counts.length!==SOIL_NAMES.length||d.counts.some(v=>!Number.isInteger(v)||v<0)||d.counts.reduce((a,b)=>a+b,0)!==n)throw Error('Invalid soil classification');
   for(const [key,[lo,hi]] of Object.entries(fields))if(!Array.isArray(d[key])||d[key].length!==n||d[key].some(x=>!Number.isFinite(x)||x<lo||x>hi))throw Error(`Invalid soil field: ${key}`);
   const hyd=records.find(r=>r.stage===9)?.data,coast=records.find(r=>r.stage===5)?.data;
   if(!hyd||!coast||d.soilType.some((v,i)=>(!!coast.water[i]||hyd.lakeId[i]>=0)!==(v===0)))throw Error('Invalid soil water mask');
   for(let i=0;i<n;i++)if(d.soilType[i]===0&&Object.keys(fields).some(key=>d[key][i]!==0))throw Error('Invalid soil on water');
   const expected=Array.from({length:SOIL_NAMES.length},(_,kind)=>d.soilType.filter(v=>v===kind).length);
   if(d.counts.some((v,i)=>v!==expected[i]))throw Error('Invalid soil counts');
   if(!d.summary||d.summary.landCells!==n-expected[0]||d.summary.deepSoilCells<0||d.summary.deepSoilCells>d.summary.landCells||d.summary.highFertilityCells<0||d.summary.highFertilityCells>d.summary.landCells)throw Error('Invalid soil summary');
   for(const [key,max] of [['meanDepthM',7],['meanFertility',1],['meanGroundwater',1],['highFertilityAreaKm2',mesh.areaKm2*1.001]])if(!Number.isFinite(d.summary[key])||d.summary[key]<0||d.summary[key]>max)throw Error(`Invalid soil summary ${key}`);
  }
  if(record.stage===12){
   if(!Array.isArray(d.coverClass)||d.coverClass.length!==n||d.coverClass.some(v=>!Number.isInteger(v)||v<0||v>=VEGETATION_NAMES.length))throw Error('Invalid vegetation classes');
   for(const key of ['canopyCover','groundCover','biomass','habitatComplexity','riparian'])
    if(!Array.isArray(d[key])||d[key].length!==n||d[key].some(v=>!Number.isFinite(v)||v<0||v>1))throw Error(`Invalid vegetation field: ${key}`);
   if(!Array.isArray(d.heightM)||d.heightM.length!==n||d.heightM.some(v=>!Number.isFinite(v)||v<0||v>40))throw Error('Invalid vegetation height');
   const actual=Array.from({length:VEGETATION_NAMES.length},(_,k)=>d.coverClass.filter(v=>v===k).length);
   if(!Array.isArray(d.counts)||d.counts.length!==actual.length||d.counts.some((v,k)=>v!==actual[k]))throw Error('Invalid vegetation totals');
   if(!Array.isArray(d.areaKm2ByClass)||d.areaKm2ByClass.length!==actual.length||d.areaKm2ByClass.some(v=>!Number.isFinite(v)||v<0||v>mesh.areaKm2*1.001))throw Error('Invalid vegetation areas');
   const coast=records.find(r=>r.stage===5)?.data,hyd=records.find(r=>r.stage===9)?.data;
   if(!coast||!hyd||d.coverClass.some((v,i)=>coast.water[i]?v!==0:hyd.lakeId[i]>=0?v!==1:v<2))throw Error('Vegetation water mask mismatch');
   for(let i=0;i<n;i++)if(d.coverClass[i]<2&&['canopyCover','groundCover','biomass','heightM','habitatComplexity','riparian'].some(key=>d[key][i]!==0))throw Error('Vegetation assigned to water');
   const areaError=Math.abs(d.areaKm2ByClass.reduce((a,b)=>a+b,0)-(mesh.areaKm2||mesh.width*mesh.height));
   if(areaError>Math.max(1,mesh.areaKm2)*.015)throw Error('Invalid vegetation area total');
   const summary=d.summary;
   if(!summary||summary.landCells!==n-actual[0]-actual[1])throw Error('Invalid vegetation land counts');
   for(const [key,maximum] of [['forestAreaKm2',mesh.areaKm2*1.001],['vegetatedAreaKm2',mesh.areaKm2*1.001],['meanCanopy',1],['meanGroundCover',1],['meanBiomass',1],['meanHeightM',40]])
    if(!Number.isFinite(summary[key])||summary[key]<0||summary[key]>maximum)throw Error(`Invalid vegetation summary ${key}`);
   if(Math.abs(summary.forestAreaKm2-(d.areaKm2ByClass[7]+d.areaKm2ByClass[8]))>.05||
    Math.abs(summary.vegetatedAreaKm2-d.areaKm2ByClass.slice(3).reduce((a,b)=>a+b,0))>.1)throw Error('Vegetation area summary mismatch');
  }
  if(record.stage===11){
   if(!Array.isArray(d.biome)||d.biome.length!==n||d.biome.some(k=>!Number.isInteger(k)||k<0||k>=BIOME_NAMES.length))throw Error('Invalid biome classes');
   const fields=['treePotential','productivity','waterStress','ecotone'];
   for(const key of fields)if(!Array.isArray(d[key])||d[key].length!==n||d[key].some(v=>!Number.isFinite(v)||v<0||v>1))throw Error(`Invalid biome field: ${key}`);
   if(!Array.isArray(d.growingMonths)||d.growingMonths.length!==n||d.growingMonths.some(v=>!Number.isInteger(v)||v<0||v>12))throw Error('Invalid biome growing season');
   const actual=Array.from({length:BIOME_NAMES.length},(_,k)=>d.biome.filter(v=>v===k).length);
   if(!Array.isArray(d.counts)||d.counts.length!==actual.length||d.counts.some((v,k)=>v!==actual[k]))throw Error('Invalid biome totals');
   if(!Array.isArray(d.areaKm2ByBiome)||d.areaKm2ByBiome.length!==actual.length||d.areaKm2ByBiome.some(v=>!Number.isFinite(v)||v<0||v>mesh.areaKm2*1.001))throw Error('Invalid biome areas');
   const ocean=records.find(r=>r.stage===5)?.data?.water,hydro=records.find(r=>r.stage===9)?.data?.lakeId;
   if(!ocean||!hydro||d.biome.some((k,i)=>ocean[i]?k!==0:hydro[i]>=0?k!==1:k<2))throw Error('Biome water mask disagrees with upstream layers');
   for(let i=0;i<n;i++)if(d.biome[i]<2&&(d.treePotential[i]!==0||d.productivity[i]!==0||d.growingMonths[i]!==0||d.waterStress[i]!==0||d.ecotone[i]!==0))throw Error('Invalid aquatic biome fields');
   // Circular and elliptical geometry uses a 128-sided boundary for mesh
   // clipping. That polygon approximates the analytic ellipse area (~0.04%
   // smaller), so compare against the *actual* Voronoi cell areas.
   const sum=d.areaKm2ByBiome.reduce((a,b)=>a+b,0);
   const tessellatedArea=mesh.cells.reduce((a,c)=>a+cellArea(c),0);
   if(Math.abs(sum-tessellatedArea)>Math.max(.15,tessellatedArea*.000001))throw Error('Invalid biome area total');
   if(!d.summary||d.summary.landCells!==n-actual[0]-actual[1])throw Error('Invalid biome summary');
   for(const key of ['forestAreaKm2','drylandAreaKm2','wetlandAreaKm2'])if(!Number.isFinite(d.summary[key])||d.summary[key]<0||d.summary[key]>mesh.areaKm2*1.001)throw Error(`Invalid biome summary: ${key}`);
   for(const key of ['meanProductivity','meanTreePotential'])if(!Number.isFinite(d.summary[key])||d.summary[key]<0||d.summary[key]>1)throw Error(`Invalid biome summary: ${key}`);
   if(!Number.isFinite(d.summary.meanGrowingMonths)||d.summary.meanGrowingMonths<0||d.summary.meanGrowingMonths>12)throw Error('Invalid biome growing season summary');
  }
 }
 return world;
}
const INPUT_RANGES={
 1:{width:[50,20000],height:[50,20000],radius:[50,20000],radiusX:[50,20000],radiusY:[50,20000]},
 2:{jitter:[0,1.7],relaxation:[0,3]},
 3:{plates:[3,50],continental:[0.1,0.9],motion:[0,2]},
 4:{uplift:[0,1.6],roughness:[0,1.4],continentalHeight:[0.05,0.8]},
 5:{land:[0.1,0.85],edgeOcean:[0,1.5],edgeFade:[0.5,5],setbackStrength:[0,1.8],setbackWidth:[2,18]},
 6:{ridge:[0,1.6],detail:[0,1.6],valleys:[0,1.6],volcanism:[0,1]},
 7:{rainfall:[0,1.6],hydraulic:[0,1.6],thermal:[0,1.6],hardness:[0,1],iterations:[1,40]},
 8:{equatorTemp:[10,40],latitudeCenter:[-70,70],latitudeSpan:[20,180],axialTilt:[0,45],rainfall:[100,4000],windDirection:[-180,180],rainShadow:[0,2],maritime:[0,1.5]},
 9:{runoffScale:[0.1,2.5],infiltration:[0,0.95],evaporation:[0,1.5],riverThreshold:[2,120],lakeDepth:[0.002,0.3],minLakeCells:[1,15]},
 10:{weathering:[0,2],organicInput:[0,2],alluvialInput:[0,2],permeabilityBias:[0.25,2],groundwaterRecharge:[0,2]},
 11:{temperatureShift:[-12,12],rainfallResponse:[.4,1.8],forestThreshold:[.45,1.8],wetlandThreshold:[.4,.95],alpineLimit:[0,16],patchVariation:[0,.4]},
 12:{vegetationDensity:[.2,1.8],maturity:[0,1],disturbance:[0,1],riparianStrength:[0,1.5],patchiness:[0,.45]}
};
/** Convert 0.1.0–0.1.3 saves into complete layer-1 geometry + shifted layers.
 * Do not regenerate any locked content; existing 2048 × 1024 data is still km-space. */
function migrateLegacyWorld(world){
 if(world.schema!==1)throw Error('Unsupported or invalid world save');
 // Validate the old stage ordering before migration.
 if(!Array.isArray(world.locked)||world.locked.length>6||!world.working||world.working.stage!==world.locked.length+1||typeof world.name!=='string')throw Error('Invalid legacy world save');
 for(let i=0;i<world.locked.length;i++)if(world.locked[i]?.stage!==i+1||!world.locked[i].data)throw Error('Invalid legacy layer order');
 const rectangle=generateGeometry(DEFAULTS[1]);
 const first={stage:1,settings:{...DEFAULTS[1]},data:rectangle,lockedAt:world.created||new Date().toISOString()};
 const previous=[...world.locked];
 for(const record of previous){
  if(record.stage===1){
   const count=record.data.cells?.length||record.settings?.count||900;
   record.settings={...record.settings,averageArea:rectangle.areaKm2/count};
   delete record.settings.count;
   record.data={...record.data,width:rectangle.width,height:rectangle.height,shape:rectangle.shape,areaKm2:rectangle.areaKm2};
  }
  record.stage++;
 }
 world.locked=[first,...previous];
 const oldWorking=world.working;
 if(oldWorking.stage===1){
  const count=Number(oldWorking.settings?.count)||oldWorking.data?.cells?.length||900;
  const generatedCount=Number(oldWorking.dataSettings?.count)||oldWorking.data?.cells?.length||count;
  oldWorking.settings={...DEFAULTS[2],...oldWorking.settings,averageArea:rectangle.areaKm2/count};
  delete oldWorking.settings.count;
  if(oldWorking.data)oldWorking.data={...oldWorking.data,width:rectangle.width,height:rectangle.height,shape:rectangle.shape,areaKm2:rectangle.areaKm2};
  if(oldWorking.dataSettings){oldWorking.dataSettings={...oldWorking.dataSettings,averageArea:rectangle.areaKm2/generatedCount};delete oldWorking.dataSettings.count;}
 }
 oldWorking.stage++;
 world.viewStage=Math.max(1,Math.min(8,(Number(world.viewStage)||1)+1));
 // An empty legacy world starts at new layer 1 instead of inventing a locked shape.
 if(previous.length===0&&!oldWorking.data){world.locked=[];world.working={stage:1,settings:{...DEFAULTS[1]},data:rectangle,dataSettings:{...DEFAULTS[1]}};world.viewStage=1;}
 world.schema=SCHEMA_VERSION;
 return world;
}
export function upgradeWorld(world){
 if(world?.schema===1)migrateLegacyWorld(world);
 validateWorld(world);
 const stage=world.working.stage;
 // Interface metadata is recoverable: invalid selections must never strand
 // an imported or restored world outside its available generation history.
 world.viewStage=clamp(Number.isFinite(Number(world.viewStage))?Math.round(Number(world.viewStage)):Math.min(stage,IMPLEMENTED),1,Math.min(stage,IMPLEMENTED));
 if(world.viewport&&(!Number.isFinite(world.viewport.scale)||world.viewport.scale<=0||!Number.isFinite(world.viewport.centerX)||!Number.isFinite(world.viewport.centerY)))delete world.viewport;
 if(stage<=IMPLEMENTED){
  const defaults=stage===2?{...DEFAULTS[2],averageArea:(world.locked[0]?.data?.areaKm2||generateGeometry(DEFAULTS[1]).areaKm2)/1200}:DEFAULTS[stage],current=world.working.settings||{},next={...defaults,...current};
  for(const [key,baseline] of Object.entries(defaults)){
   if(typeof baseline==='number'&&(!Number.isFinite(Number(next[key]))||next[key]===''))next[key]=baseline;
   if(key==='shape'&&!['rectangle','circle','ellipse'].includes(next[key]))next[key]=baseline;
   if(key==='distribution'&&!['jittered','random','clustered'].includes(next[key]))next[key]=baseline;
  }
  for(const [key,[min,max]] of Object.entries(INPUT_RANGES[stage])){
   next[key]=clamp(Number(next[key]),min,max);
   if(['relaxation','plates','iterations','minLakeCells'].includes(key))next[key]=Math.round(next[key]);
  }
  if(stage===2){
   const geometry=world.locked[0]?.data||generateGeometry(DEFAULTS[1]);
   next.averageArea=clamp(Number(next.averageArea),geometry.areaKm2/MAX_CELLS,geometry.areaKm2/100);
  }
  if(stage!==1){const seed=Number(next.seed);next.seed=Number.isFinite(seed)?Math.floor(clamp(seed,0,0xffffffff)):defaults.seed;}
  world.working.settings=next;
 }
 if(!['auto','natural','geometry','plates','height','coast','landforms','erosion','flow','temperature','rain','moisture','seasonality','january','july','hydrology','catchment','watersheds','soils','soilDepth','soilFertility','soilPermeability','soilGroundwater','soilErosion','biomes','productivity','treePotential','waterStress','growingSeason','ecotones','vegetation','canopyCover','groundCover','biomass','habitatComplexity','habitats','riparian'].includes(world.viewMode))world.viewMode='auto';
 world.exploreMode=!!world.exploreMode;
 world.consoleHeightRatio=Number.isFinite(world.consoleHeightRatio)?clamp(world.consoleHeightRatio,.1,.95):.36;
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
  const nextStage=stage+1,base=nextStage===2?{...DEFAULTS[2],averageArea:result.locked[0].data.areaKm2/1200}:{...DEFAULTS[nextStage]};
  result.working={stage:nextStage,settings:nextStage<=IMPLEMENTED?base:{},data:null,dataSettings:null};
 }
 result.viewStage=stage;
 return result;
}
