import {DEFAULTS,STAGES,IMPLEMENTED,SCHEMA_VERSION,newWorld,validateWorld,upgradeWorld,snapshotThroughStage,WORLD_WIDTH,WORLD_HEIGHT,LANDFORM_NAMES,cellArea,landAreaFraction,generateGeometry,insideGeometry,meshTargetCount,MAX_CELLS} from './engine.js';

const APP_VERSION='0.1.5',DB_NAME='worldgen-v1',KEY='workspace';
const host=globalThis.__APP_LAUNCHER__;
const root=document.querySelector('#app');
if(!root)throw Error('WorldGen requires an #app element');
document.body.classList.add('worldgen-active');
root.classList.add('worldgen-host');
document.title=`WorldGen v${APP_VERSION}`;

const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const shortNumber=x=>Number(x).toLocaleString('en-US');
// Each descriptor drives the slider, direct number entry, stepper and help sheet.
// Changing a percentage-mode control changes its current value by ±5%; linear
// controls move by the declared step. All bounds are applied in the engine too.
const OPTIONS={
 1:[
  ['shape','World shape','select',[['rectangle','Rectangle'],['circle','Circle'],['ellipse','Ellipse']]],
  ['width','Width (km)','range',50,20000,1,'percent'],['height','Height (km)','range',50,20000,1,'percent'],
  ['radius','Radius (km)','range',50,20000,1,'percent'],
  ['radiusX','Horizontal radius (km)','range',50,20000,1,'percent'],['radiusY','Vertical radius (km)','range',50,20000,1,'percent']
 ],
 2:[
  ['averageArea','Average cell area (km²)','area',0,0,1,'percent'],
  ['distribution','Placement','select',[['jittered','Even / jittered'],['random','Blue-noise random'],['clustered','Clustered']]],
  ['jitter','Position jitter','range',0,1.7,0.05,'linear'],
  ['relaxation','Lloyd relaxation','range',0,3,1,'linear']
 ],
 3:[['plates','Plates','range',3,50,1,'linear'],['continental','Continental ratio','range',0.1,0.9,0.05,'linear'],['motion','Plate motion','range',0,2,0.05,'linear']],
 4:[['uplift','Uplift strength','range',0,1.6,0.05,'linear'],['roughness','Surface roughness','range',0,1.4,0.05,'linear'],['continentalHeight','Crust elevation','range',0.05,0.8,0.025,'linear']],
 5:[['land','Land coverage target','range',0.1,0.85,0.01,'linear'],['edgeOcean','Edge ocean bias','range',0,1.5,0.05,'linear'],['edgeFade','Edge falloff (cell widths)','range',0.5,5,0.25,'linear']],
 6:[['ridge','Ridge strength','range',0,1.6,0.05,'linear'],['detail','Terrain variation','range',0,1.6,0.05,'linear'],['valleys','Valley incision','range',0,1.6,0.05,'linear'],['volcanism','Volcanic activity','range',0,1,0.025,'linear']],
 7:[['rainfall','Approx. rainfall','range',0,1.6,0.05,'linear'],['hydraulic','Water erosion','range',0,1.6,0.05,'linear'],['thermal','Slope weathering','range',0,1.6,0.05,'linear'],['hardness','Rock resistance','range',0,1,0.05,'linear'],['iterations','Erosion passes','range',1,40,1,'linear']]
};
const PARAM_HELP={
 shape:['World outline','Rectangle creates a four-sided map. Circle creates a map with equal horizontal and vertical radii. Ellipse lets you control each radius independently. All three are flat 2D worlds with no depth.'],
 width:['Width','The left-to-right extent of a rectangular world, measured in kilometers. Increasing it expands the world and its area; decreasing it contracts the world.'],
 height:['Height','The top-to-bottom extent of a rectangular world, in kilometers. Increasing it expands the world vertically and raises its area.'],
 radius:['Circle radius','Distance in kilometers from the world center to its edge. Increasing radius increases both width and height; doubling it quadruples area.'],
 radiusX:['Horizontal radius','The east-to-west center-to-edge radius of an ellipse in kilometers. Increasing it widens the world and increases area proportionally.'],
 radiusY:['Vertical radius','The north-to-south center-to-edge radius of an ellipse in kilometers. Increasing it makes the world taller and increases area proportionally.'],
 averageArea:['Average Voronoi cell area','The target mean geographic area of a polygon, in square kilometers (km²). Lower values create MORE polygons and finer simulation resolution; higher values create FEWER, larger cells and render faster. The slider is logarithmic for precision across small and large worlds. Count is limited to 100–5,000 cells for mobile performance.'],
 distribution:['Site distribution','Even / jittered places sites in a loose grid; random spreads them out with a minimum separation; clustered creates uneven concentrations. Select a pattern to change cell uniformity.'],
 jitter:['Position jitter','How far Voronoi sites shift away from the evenly spaced starting grid. Higher values make cell shapes and sizes less regular; lower values give a more uniform tessellation.'],
 relaxation:['Lloyd relaxation','Number of times sites move toward their polygon centers. Higher values make cells rounder and more even, but take longer to generate. Zero keeps the initial irregular shapes.'],
 plates:['Plate count','Number of independently moving tectonic regions. More plates create more boundaries and potential geological variation; fewer create broader regions.'],
 continental:['Continental crust ratio','Chance each tectonic plate consists of higher continental crust. Increasing it generally raises continental land potential; lowering it favors oceanic crust. Actual land area is defined later by sea level.'],
 motion:['Plate motion','Magnitude of horizontal plate motion used to estimate convergence and rifts. More motion intensifies plate-boundary differences; zero removes relative motion effects.'],
 uplift:['Uplift strength','How strongly converging tectonic boundaries raise terrain. Higher values create more prominent mountain systems; lower values soften those effects.'],
 roughness:['Surface roughness','Strength of small-scale height noise before landform refinement. Increasing it makes elevation less smooth; decreasing it produces gentler terrain.'],
 continentalHeight:['Crust elevation','Relative starting height difference between continental and oceanic plates. Higher values lift continents and deepen relative crust contrast; lower values flatten that contrast.'],
 land:['Land coverage target','Desired share of the world surface ABOVE sea level by geographic area. Higher values expose more land; lower values flood more land. It is approximate at the resolution of individual cells. An enabled edge-ocean buffer takes priority if the outermost cells already exceed the water target.'],
 edgeOcean:['Edge ocean bias','Strength of the ocean-promoting effect at the outer world boundary. Higher values lower near-edge terrain relative to sea level, making a broader water margin without changing distant inland heights. When greater than zero, polygons touching the world boundary are guaranteed to be water. Zero disables this feature.'],
 edgeFade:['Edge falloff width','How far the edge-ocean influence extends inland, measured in typical Voronoi cell widths. Smaller values concentrate the effect close to the map border; larger values make the transition gentler. The reach is capped to protect the center of narrow worlds.'],
 ridge:['Ridge strength','Strength of coherent mountainous ridges during landform refinement. Higher produces stronger belts and peaks; lower makes ridges subtler. Locked coastlines remain fixed.'],
 detail:['Terrain variation','Fine-scale variation added to existing elevations. Higher gives rougher and more diverse local terrain; lower keeps smoother landscapes.'],
 valleys:['Valley incision','How strongly valley-like features cut into the terrain. More produces deeper local valleys; less preserves uplands.'],
 volcanism:['Volcanic activity','Likelihood of volcanic landforms near suitable plate boundaries. Increasing it produces more volcanic cells; decreasing it reduces them.'],
 rainfall:['Approximate rainfall','Preliminary runoff input to the erosion model. More creates stronger erosion and greater discharge; less reduces water-driven change. Full climate is a future layer.'],
 hydraulic:['Water erosion','How strongly downhill flowing water cuts into the terrain. More carves deeper flow routes and increases sediment transport; less leaves landforms closer to their input.'],
 thermal:['Slope weathering','Movement of material from steep slopes to nearby lower cells. More smooths and redistributes slopes; less preserves sharp terrain changes.'],
 hardness:['Rock resistance','How resistant material is to erosion and weathering. Higher values reduce removal rates; lower values allow stronger erosion.'],
 iterations:['Erosion passes','Number of approximate erosion simulation updates. More passes generally accumulate greater change and require more processing time.'],
 seed:['Random seed','An integer that controls repeatable randomness in this layer. The same seed with the same inputs creates the same result. Reroll chooses a different seed.']
};
function geometryData(){return latestData(1)||(currentStage()===1?workspace.working.data:null)||generateGeometry(DEFAULTS[1]);}
function mapDimensions(){const g=geometryData();return {width:g.width,height:g.height};}
function controlBounds(stage,key){if(key==='averageArea'){
 const a=geometryData().areaKm2;return [a/MAX_CELLS,a/100];
 }
 const item=OPTIONS[stage]?.find(o=>o[0]===key);return item?[item[3],item[4]]:[0,1];}
function formatParam(key,value){
 if(key==='continental'||key==='land')return `${Math.round(value*100)}%`;
 return Number(value).toLocaleString('en-US',{maximumFractionDigits:key==='averageArea'?2:4});
}
function areaToSlider(value,min,max){return Math.round(1000*Math.log(clamp(value,min,max)/min)/Math.log(max/min));}
function sliderToArea(position,min,max){return min*Math.pow(max/min,Number(position)/1000);}
function formatNumber(n){return Number(Number(n).toFixed(6));}
const palettes={
  natural:'Natural',geometry:'Cell geometry',plates:'Tectonic plates',height:'Elevation',coast:'Land / sea',landforms:'Landforms',erosion:'Erosion / deposition',flow:'Drainage flow'
};
let dbPromise=null,workspace=newWorld(),snapshots=[],view={scale:1,x:0,y:0},canvas,ctx,renderPending=false;
let generating=false,dirty=false,storageHealthy=true,storageWarned=false,requestId=0,worker=null,rebuildTimer=null,writeQueue=Promise.resolve(),selectedId=null,activeModal=null;
let persistTimer=null,viewportTimer=null,progressPercent=0,cancelPending=null,borderCache={mesh:null,plates:null,coasts:null,plateLines:null,coastLines:null};
let firstFit=true,movePointers=new Map(),gesture=null,panMoved=false;
// Path2D objects and polygon extents are cached across map pans and zooms.
let geometryCache={mesh:null,paths:null,bounds:null},colorCache={mesh:null,record:null,stage:0,mode:null,colors:null};
let measureMode=false,measurePoints=[];
function db(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  if(!('indexedDB' in globalThis)){reject(Error('IndexedDB unavailable'));return;}
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>{const database=req.result;if(!database.objectStoreNames.contains('data'))database.createObjectStore('data');};
  req.onerror=()=>reject(req.error||Error('Storage unavailable'));req.onsuccess=()=>resolve(req.result);
 });
 return dbPromise;
}
async function storeGet(key){const database=await db();return new Promise((resolve,reject)=>{const req=database.transaction('data').objectStore('data').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function storePut(key,value){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('data','readwrite');tx.objectStore('data').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function persist(){
 clearTimeout(persistTimer);
 persistTimer=setTimeout(()=>{persistTimer=null;void flushPersist();},260);
}
function flushPersist(){
 clearTimeout(persistTimer);persistTimer=null;
 workspace.updated=new Date().toISOString();
 const copy=structuredClone(workspace);
 writeQueue=writeQueue.catch(()=>{}).then(()=>storePut(KEY,copy)).then(()=>{
  storageHealthy=true;storageWarned=false;
 }).catch(e=>{
  storageHealthy=false;showBusy(generating);
  if(!storageWarned){storageWarned=true;notice(`Automatic saving unavailable: ${e.message}. Export your world as a backup.`,true);}
 });
 return writeQueue;
}
async function storeDelete(key){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('data','readwrite');tx.objectStore('data').delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function saveSnapshotsIndex(){const copy=structuredClone(snapshots);writeQueue=writeQueue.catch(()=>{}).then(()=>storePut('checkpoint-index',copy));return writeQueue;}
function rememberViewport(){
 clearTimeout(viewportTimer);viewportTimer=setTimeout(()=>{
  if(!canvas?.clientWidth||!canvas.clientHeight)return;
  workspace.viewport={scale:view.scale,centerX:(canvas.clientWidth/2-view.x)/view.scale,centerY:(canvas.clientHeight/2-view.y)/view.scale};
  persist();
 },650);
}
function minimumZoom(){const g=mapDimensions();return Math.min(.07,Math.min((canvas?.clientWidth||375)/g.width,(canvas?.clientHeight||600)/g.height)*.2);}
function restoreViewport(){
 if(!workspace.viewport||!canvas)return fitMap();
 const v=workspace.viewport;view.scale=clamp(v.scale,minimumZoom(),8);
 view.x=canvas.clientWidth/2-v.centerX*view.scale;
 view.y=canvas.clientHeight/2-v.centerY*view.scale;
 firstFit=false;schedulePaint();
}
function flushViewport(){if(viewportTimer){clearTimeout(viewportTimer);viewportTimer=null;if(canvas?.clientWidth&&canvas.clientHeight)workspace.viewport={scale:view.scale,centerX:(canvas.clientWidth/2-view.x)/view.scale,centerY:(canvas.clientHeight/2-view.y)/view.scale};}}
function notice(message,error=false){let el=root.querySelector('#wg-toast');if(!el)return;el.textContent=message;el.classList.toggle('error',error);el.classList.add('visible');clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.classList.remove('visible'),4000);}
function stageText(stage){return STAGES[stage]?.[0]||'Unknown stage';}
function currentStage(){return workspace.working.stage;}
function stageRecord(stage){return workspace.locked[stage-1]||(stage===currentStage()?workspace.working:null);}
function latestData(stage){return stageRecord(stage)?.data||null;}
function viewStage(){return workspace.viewStage||1;}
function effectiveStage(){const chosen=viewStage();return latestData(chosen)?chosen:Math.min(currentStage()-1,IMPLEMENTED);}
function activeSettings(){return workspace.working.settings;}
function showBusy(busy){generating=busy;const el=root.querySelector('#wg-status');if(el)el.innerHTML=busy?`<span class="wg-busy-dot"></span> Generating${progressPercent?' '+progressPercent+'%':'…'}`:dirty?'<span class="wg-busy-dot"></span> Preview pending':storageHealthy?'<span class="wg-saved-dot"></span> Cached locally':'<span class="wg-busy-dot"></span> Export backup';const lock=root.querySelector('[data-action="lock"]');if(lock)lock.disabled=busy||dirty||!workspace.working.data;}

function buildShell(){
 root.innerHTML=`<div id="worldgen-root" class="wg-shell">
   <header class="wg-header">
    <button class="wg-icon-button wg-home" data-action="home" aria-label="Return to launcher" title="Return to launcher">${host?'⌂':'≡'}</button>
    <div class="wg-headline"><div class="wg-eyebrow">WORLDGEN <span>v${APP_VERSION}</span></div><button class="wg-world-name" data-action="rename" title="Rename world">${escapeHTML(workspace.name)} <span>⌄</span></button></div>
    <button class="wg-icon-button" data-action="save" aria-label="Save checkpoint" title="Save checkpoint">▣</button>
    <button class="wg-icon-button" data-action="library" aria-label="Open world library" title="World library">☰</button>
   </header>
   <main class="wg-map-area">
    <canvas id="wg-map" aria-label="Interactive world map: drag to pan, pinch or scroll to zoom, tap a polygon to inspect" role="img"></canvas>
    <div class="wg-map-buttons"><button data-action="fit" aria-label="Fit world to view" title="Fit entire world">⤢</button><button data-action="zoom-in" aria-label="Zoom in">+</button><button data-action="zoom-out" aria-label="Zoom out">−</button><button data-action="locate-cell" aria-label="Go to cell number" title="Go to cell number">⌖</button><button data-action="measure" aria-label="Measure distance" aria-pressed="false" title="Measure two-point distance">↔</button></div>
    <div class="wg-display-bar"><label for="wg-palette" class="wg-screen-reader-only">Map display</label><select id="wg-palette" aria-label="Map display mode">${Object.entries(palettes).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select><button class="wg-overlay-trigger" data-action="toggle-overlays" aria-expanded="false">Overlays</button></div>
    <div class="wg-overlays" id="wg-overlays" hidden><label><input id="wg-edges" type="checkbox"> Voronoi mesh</label><label><input id="wg-plate-borders" type="checkbox"> Plate boundaries</label><label><input id="wg-coast-borders" type="checkbox"> Coastlines</label><label><input id="wg-flow" type="checkbox"> Drainage channels (layer 7)</label><details class="wg-legend-details"><summary>Map legend</summary><div id="wg-legend" class="wg-legend"></div></details></div>
    <div class="wg-map-scale" id="wg-map-scale">World width: 2,048 km</div>
    <div class="wg-measure-readout" id="wg-measure-readout" aria-live="polite" hidden></div>
    <div class="wg-map-nav"><button data-action="prev-stage" aria-label="Previous completed stage">‹</button><span id="wg-map-layer">Layer 01</span><button data-action="next-stage" aria-label="Next completed stage">›</button></div>
    <button class="wg-explore-toggle" data-action="toggle-explore" aria-label="Toggle generation controls">Expand map</button>
    <div class="wg-inspector" id="wg-inspector" hidden></div>
   </main>
   <section class="wg-console" aria-label="World generation stages">
    <button class="wg-console-handle" data-action="toggle-explore" aria-label="Expand map or show settings"><span></span></button>
    <div class="wg-progress-row"><div class="wg-stage-heading"><span class="wg-section-caption">GENERATION PIPELINE</span><span id="wg-status"><span class="wg-saved-dot"></span> Cached locally</span></div><div class="wg-stage-scroll" id="wg-stage-scroll"></div></div>
    <div class="wg-stage-main" id="wg-stage-main"></div>
   </section>
   <div class="wg-modal-host" id="wg-modal-host"></div><div id="wg-toast" class="wg-toast" role="status" aria-live="polite"></div>
   <input id="wg-import" type="file" accept=".json,application/json" hidden />
  </div>`;
 canvas=root.querySelector('#wg-map');ctx=canvas.getContext('2d',{alpha:false});
 bindEvents();rebuildUI();requestAnimationFrame(()=>{resizeCanvas();if(firstFit)fitMap();else restoreViewport();});
}
function rebuildUI(){
 root.querySelector('.wg-world-name').innerHTML=`${escapeHTML(workspace.name)} <span>⌄</span>`;
 const active=currentStage(),stage=viewStage(),rail=root.querySelector('#wg-stage-scroll');
 rail.innerHTML=STAGES.slice(1).map(([name],i)=>{
  const n=i+1,locked=n<=workspace.locked.length,working=n===active,upcoming=n>IMPLEMENTED,available=locked||(working&&!!workspace.working.data);
  const klass=stage===n?'current':locked?'done':working?'editable':'later';
  return `<button class="wg-stage-chip ${klass}" data-stage="${n}" ${upcoming||(!available&&n!==active)?'disabled':''} title="${escapeHTML(name)}"><span>${locked?'✓':String(n).padStart(2,'0')}</span><small>${escapeHTML(name)}</small></button>`;
 }).join('');
 rail.querySelector('.current')?.scrollIntoView?.({block:'nearest',inline:'nearest'});
 const row=stageRecord(stage),available=stage<=IMPLEMENTED,editable=stage===active&&active<=IMPLEMENTED;
 const settings=editable?activeSettings():row?.settings;
 let html=`<div class="wg-stage-title"><div><span class="wg-layer-label">LAYER ${String(stage).padStart(2,'0')} ${editable?'· WORKING':stage<=workspace.locked.length?'· LOCKED':'· NOT AVAILABLE'}</span><h2>${escapeHTML(stageText(stage))}</h2><p>${escapeHTML(STAGES[stage]?.[1]||'')}</p></div></div>`;
 if(!available){html+='<p class="wg-hint">This generation layer is planned for a future release.</p>';}
 else if(editable){
  html+=`<div class="wg-controls">${OPTIONS[stage].filter(option=>stage!==1||((settings.shape==='rectangle'&&!['radius','radiusX','radiusY'].includes(option[0]))||(settings.shape==='circle'&&!['width','height','radiusX','radiusY'].includes(option[0]))||(settings.shape==='ellipse'&&!['width','height','radius'].includes(option[0])))).map(settingRow).join('')}${stage===1?'':`<div class="wg-seed-row"><label for="wg-seed">Random seed</label><button class="wg-info" data-info="seed" aria-label="About random seed">i</button><input id="wg-seed" type="number" inputmode="numeric" value="${settings.seed}" min="0" max="4294967295"><button data-action="reroll" title="New seed">↻ Reroll</button></div>`}</div>`;
  if(stage===7)html+='<p class="wg-hint">Approximate Voronoi-scale erosion. Rainfall is preliminary; full climate and rivers are separate future layers. Locked coastlines remain fixed.</p>';
  html+=`<div class="wg-actions"><button class="wg-secondary" data-action="reset-settings" title="Restore the default parameters for this layer">Reset settings</button><button class="wg-secondary" data-action="regenerate">Regenerate</button><button class="wg-primary" data-action="lock" ${generating||dirty||!workspace.working.data?'disabled':''}>Lock layer ${stage} →</button></div>`;
 }else if(row){
  html+=`<p class="wg-summary">${describeStage(stage,row.data)} This layer is preserved as part of your world history.</p><div class="wg-actions"><button class="wg-secondary" data-action="edit-earlier">Revise this layer</button><button class="wg-primary" data-action="save">Save checkpoint</button></div>`;
 }else{html+='<p class="wg-hint">Generate and lock the preceding layer to continue.</p>';}
 root.querySelector('#wg-stage-main').innerHTML=html;
 root.querySelector('#wg-palette').value=workspace.viewMode==='auto'?'natural':workspace.viewMode;
 root.querySelector('#wg-edges').checked=workspace.showEdges;
 root.querySelector('#wg-plate-borders').checked=!!workspace.showPlateBorders;
 root.querySelector('#wg-coast-borders').checked=!!workspace.showCoastBorders;
 root.querySelector('#wg-flow').checked=!!workspace.showFlow;
 root.querySelector('#worldgen-root').classList.toggle('wg-explore',!!workspace.exploreMode);
 root.querySelector('.wg-explore-toggle').textContent=workspace.exploreMode?'Show settings':'Expand map';
 const shown=effectiveStage();
 root.querySelector('#wg-map-layer').textContent=shown===stage?`${String(stage).padStart(2,'0')} · ${stageText(stage)}`:shown>0?`${String(shown).padStart(2,'0')} · ${stageText(shown)} (last ready)`:'Generating first map…';
 root.querySelector('[data-action="prev-stage"]').disabled=stage<=1;
 root.querySelector('[data-action="next-stage"]').disabled=stage>=Math.min(IMPLEMENTED,currentStage())||!latestData(stage+1);
 updateLegend();updateMeasurement();showBusy(generating);updateInspector();schedulePaint();
}
function applyParameter(key,raw,rebuild=false){
 if(currentStage()>IMPLEMENTED)return;
 const options=OPTIONS[currentStage()]||[],row=options.find(o=>o[0]===key);if(!row)return;
 let value;
 if(row[2]==='select')value=raw;
 else{
  const [min,max]=controlBounds(currentStage(),key);
  if(raw===''||!Number.isFinite(Number(raw))){notice('Enter a valid number',true);rebuildUI();return;}
  value=clamp(Number(raw),min,max);
  if(['plates','iterations','relaxation'].includes(key))value=Math.round(value);
  value=formatNumber(value);
 }
 if(workspace.working.settings[key]===value)return;
 workspace.working.settings[key]=value;
 dirty=true;void persist();showBusy(generating);
 if(currentStage()===1){
  // Shape/dimensions can invalidate the viewport and every dependent map.
  if(rebuild){rebuildUI();fitMap();}else syncControl(key);
 }else if(rebuild)rebuildUI();else syncControl(key);
 scheduleGeneration(row[2]==='select'?50:row[2]==='area'?650:380);
}
function syncControl(key){
 const value=workspace.working.settings[key],row=OPTIONS[currentStage()]?.find(r=>r[0]===key);
 if(!row||row[2]==='select')return;
 const [min,max]=controlBounds(currentStage(),key),slider=root.querySelector(`[data-slider="${key}"]`),number=root.querySelector(`[data-number="${key}"]`);
 if(slider)slider.value=String(row[2]==='area'?areaToSlider(value,min,max):value);
 if(number&&document.activeElement!==number)number.value=String(formatNumber(value));
 const estimate=root.querySelector('[data-cell-estimate]');if(key==='averageArea'&&estimate)estimate.textContent=`≈ ${shortNumber(meshTargetCount(geometryData(),value))} polygons · 100–${shortNumber(MAX_CELLS)} supported`;
}
function adjustParameter(key,direction){
 const row=OPTIONS[currentStage()]?.find(o=>o[0]===key);if(!row||row[2]==='select')return;
 const value=Number(activeSettings()[key]),step=row[6]==='percent'?Math.max(row[5]||1,Math.abs(value)*.05):row[5];
 applyParameter(key,value+direction*step,true);
}
function showParameterHelp(key){
 const [title,description]=PARAM_HELP[key]||['Parameter','No description available.'];
 const current=OPTIONS[currentStage()]?.find(row=>row[0]===key);
 const mode=current?.[2]==='area'||current?.[6]==='percent'?'Percentage adjustment: ±5% of the current value.':current?.[2]==='range'?`Linear adjustment: ±${current[5]} each tap.`:'';
 root.querySelector('#wg-modal-host').innerHTML=`<div class="wg-modal-backdrop"><section class="wg-modal wg-help-dialog" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}"><div class="wg-modal-heading"><h2>${escapeHTML(title)}</h2><button class="wg-icon-button" data-action="close-modal" aria-label="Close information">×</button></div><p>${escapeHTML(description)}</p><p class="wg-modal-caption">${escapeHTML(mode)}</p></section></div>`;
 activeModal=true;
}
function settingRow([key,label,type,a,b,step,mode]){
 const stage=currentStage(),value=activeSettings()[key],info=`<button type="button" class="wg-info" data-info="${key}" aria-label="About ${escapeHTML(label)}" title="Explain this parameter">i</button>`;
 if(type==='select')return `<div class="wg-form-field wg-choice-field"><div class="wg-field-title"><span>${escapeHTML(label)}</span>${info}</div><select data-setting="${key}" aria-label="${escapeHTML(label)}">${a.map(([v,n])=>`<option value="${v}" ${v===value?'selected':''}>${n}</option>`).join('')}</select></div>`;
 const [min,max]=controlBounds(stage,key),area=type==='area';
 const sliderValue=area?areaToSlider(value,min,max):value;
 const rawValue=formatNumber(value);
 return `<div class="wg-form-field" data-param="${key}"><div class="wg-field-title"><span>${escapeHTML(label)}</span>${info}</div>
  <input data-slider="${key}" type="range" min="${area?0:min}" max="${area?1000:max}" step="${area?1:step}" value="${sliderValue}" aria-label="${escapeHTML(label)} slider" />
  <div class="wg-value-controls"><button type="button" data-adjust="${key}" data-direction="-1" aria-label="Decrease ${escapeHTML(label)}">−</button>
  <input data-number="${key}" type="number" inputmode="decimal" min="${min}" max="${max}" step="any" value="${rawValue}" aria-label="${escapeHTML(label)} value" />
  <button type="button" data-adjust="${key}" data-direction="1" aria-label="Increase ${escapeHTML(label)}">+</button></div>
  ${area?`<small data-cell-estimate>≈ ${shortNumber(meshTargetCount(geometryData(),value))} polygons · 100–${shortNumber(MAX_CELLS)} supported</small>`:`<small class="wg-increment-mode">${mode==='percent'?'±5% per tap':`±${step} per tap`}</small>`}
 </div>`;
}
function describeStage(stage,data){if(!data)return 'No preview generated yet.';switch(stage){
 case 1:return `${data.shape==='rectangle'?'Rectangular':data.shape==='circle'?'Circular':'Elliptical'} world · ${shortNumber(data.width)} × ${shortNumber(data.height)} km · ${shortNumber(Math.round(data.areaKm2))} km² · no depth.`;
 case 2:return `${shortNumber(data.cells.length)} Voronoi cells across ${shortNumber(Math.round(data.areaKm2))} km².`;
 case 3:return `${data.plates.length} tectonic plates with distinct crust properties and motion.`;
 case 4:return `${data.elevations.length} elevation samples with plate-boundary uplift.`;
 case 5:{const area=data.landAreaFraction??landAreaFraction(latestData(2),data.water);return `${Math.round((area??data.landFraction)*100)}% land area · ${data.edgeWaterCells||0} protected outer-edge water cells${data.edgeWaterCells?` · fade ${data.edgeWidthKm} km`:''}.`;}
 case 6:return `${shortNumber(data.classes.length)} terrain samples · ${data.volcanoes.length} volcanic cells · ${data.counts[6]} mountain cells.`;
 case 7:return `${shortNumber(data.elevations.length)} eroded cells · ${data.channels.length} drainage-channel cells · maximum runoff ${data.summary.maxDischarge.toFixed(1)}.`;
 default:return '';
}}
function nextSeed(){return Math.floor(Math.random()*0xffffffff);}
function stopWorker(){if(worker){worker.terminate();worker=null;}if(cancelPending){const cancel=cancelPending;cancelPending=null;cancel();}}
function scheduleGeneration(ms=230){clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>void generateCurrent(),ms);}
async function generateCurrent(){
 const stage=currentStage();if(stage>IMPLEMENTED)return;
 stopWorker();
 const id=++requestId;progressPercent=0;const settings=structuredClone(workspace.working.settings);const settingsStamp=JSON.stringify(settings);const locked=workspace.locked.map(({stage,data})=>({stage,data}));
 showBusy(true);
 try{
  worker=new Worker(new URL('./compute-worker.js',import.meta.url),{type:'module'});
  const result=await new Promise((resolve,reject)=>{
   const job=worker;
   cancelPending=()=>resolve({cancelled:true});
   job.onmessage=event=>{if(typeof event.data.progress==='number'){if(id===requestId){progressPercent=Math.floor(event.data.progress*100);showBusy(true);}return;}cancelPending=null;resolve(event.data);};
   job.onerror=error=>{cancelPending=null;reject(Error(error.message||'Generation worker failed'));};
   job.postMessage({id,stage,settings,locked});
  });
  if(result.cancelled||id!==requestId||stage!==currentStage()||settingsStamp!==JSON.stringify(workspace.working.settings))return;
  if(!result.ok)throw Error(result.error);
  workspace.working.data=result.data;workspace.working.dataSettings=structuredClone(settings);dirty=false;
  if(workspace.viewStage===stage||!latestData(workspace.viewStage))workspace.viewStage=stage;
  selectedId=null;resetBorderCache();
  if(stage===1)requestAnimationFrame(fitMap);
  await flushPersist();
  showBusy(false);rebuildUI();notice(`${stageText(stage)} generated`);
 }catch(error){if(id!==requestId)return;showBusy(false);rebuildUI();notice(`Generation failed: ${error.message}`,true);}
 finally{if(id===requestId)stopWorker();}
}
function defaultsForStage(stage){
 if(stage===2){const g=geometryData();return {...DEFAULTS[2],averageArea:formatNumber(g.areaKm2/1200)};}
 return {...(DEFAULTS[stage]||{})};
}
function commitLayer(){
 const stage=currentStage(),working=workspace.working;
 if(generating||dirty||!working.data||stage>IMPLEMENTED)return;
 workspace.locked.push({stage,settings:structuredClone(working.settings),data:working.data,lockedAt:new Date().toISOString()});
 const next=stage+1;
 workspace.working={stage:next,settings:next<=IMPLEMENTED?defaultsForStage(next):{},data:null,dataSettings:null};dirty=false;
 workspace.viewStage=stage;selectedId=null;resetBorderCache();
 void persist();rebuildUI();notice(`Layer ${stage} locked. Your world history is preserved.`);
 // Advance the interface to a working layer, while preserving the last map.
 if(next<=IMPLEMENTED){workspace.viewStage=next;rebuildUI();scheduleGeneration(50);}
}
function reviseStage(stage){
 const earlier=workspace.locked[stage-1];if(!earlier)return;
 const later=workspace.locked.length-stage;
 if(!confirm(`Revise layer ${stage}? This creates a new branch from that layer. ${later?`${later} later locked layer(s) will be removed from the working branch.`:'Later layers will be regenerated from this revision.'} Save a checkpoint first if you want to preserve the current branch.`))return;
 requestId++;stopWorker();clearTimeout(rebuildTimer);generating=false;
 workspace.locked=workspace.locked.slice(0,stage-1);
 workspace.working={stage,settings:structuredClone(earlier.settings),data:structuredClone(earlier.data),dataSettings:structuredClone(earlier.settings)};dirty=false;
 workspace.viewStage=stage;selectedId=null;resetBorderCache();
 void persist();rebuildUI();notice(`Layer ${stage} is editable again`);
}
function rgb(r,g,b){return `rgb(${r|0},${g|0},${b|0})`;}
function gradient(value,stops){const t=clamp(value,0,1);for(let i=1;i<stops.length;i++)if(t<=stops[i][0]){const [at,a]=stops[i-1],[bt,b]=stops[i],v=(t-at)/(bt-at);return rgb(...a.map((x,k)=>x+(b[k]-x)*v));}return rgb(...stops[stops.length-1][1]);}
const heightColors=[[0,[24,54,83]],[.30,[43,104,130]],[.43,[138,157,153]],[.52,[110,145,116]],[.64,[172,168,124]],[.78,[137,115,95]],[1,[232,236,231]]];
const landColors=[[0,[54,99,83]],[.38,[76,121,81]],[.57,[119,140,92]],[.72,[166,146,105]],[.88,[157,145,130]],[1,[234,235,223]]];
const landformColors=['#1d4965','#4c8295','#b5a986','#6e9d6d','#779273','#9a977a','#d3cdbb','#746a65','#839778'];
function resetBorderCache(){borderCache={mesh:null,plates:null,coasts:null,plateLines:null,coastLines:null};colorCache.record=null;}
function prepareGeometry(mesh){
 if(geometryCache.mesh===mesh)return geometryCache;
 const paths=[],bounds=[];
 for(const c of mesh.cells){
  const p=c.poly,shape=new Path2D();shape.moveTo(p[0],p[1]);
  let left=p[0],right=p[0],top=p[1],bottom=p[1];
  for(let k=2;k<p.length;k+=2){shape.lineTo(p[k],p[k+1]);left=Math.min(left,p[k]);right=Math.max(right,p[k]);top=Math.min(top,p[k+1]);bottom=Math.max(bottom,p[k+1]);}
  shape.closePath();paths.push(shape);bounds.push([left,top,right,bottom]);
 }
 geometryCache={mesh,paths,bounds};return geometryCache;
}
function borderSegments(mesh,labels){
 const out=[],cells=mesh.cells;
 for(let i=0;i<cells.length;i++){
  const c=cells[i],p=c.poly;
  for(let k=0;k<p.length;k+=2){
   const x1=p[k],y1=p[k+1],x2=p[(k+2)%p.length],y2=p[(k+3)%p.length],mx=(x1+x2)/2,my=(y1+y2)/2;
   if((Math.abs(x1-x2)<.001&&(mx<.001||mx>mesh.width-.001))||(Math.abs(y1-y2)<.001&&(my<.001||my>mesh.height-.001)))continue;
   const own=(mx-c.x)**2+(my-c.y)**2;
   for(const j of c.neighbors){
    if(j<=i||labels[i]===labels[j])continue;
    const other=cells[j],distance=(mx-other.x)**2+(my-other.y)**2;
    if(Math.abs(own-distance)/Math.max(1,own)<.012){out.push([x1,y1,x2,y2]);break;}
   }
  }
 }
 return out;
}
function drawSegments(segments,color,width){ctx.beginPath();for(const [x1,y1,x2,y2] of segments){ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);}ctx.strokeStyle=color;ctx.lineWidth=width/view.scale;ctx.stroke();}

function colorForCell(i,stage,display){
 const mesh=latestData(2)||(currentStage()===2?workspace.working.data:null),plates=latestData(3),heights=latestData(4),coasts=latestData(5),landforms=latestData(6),erosion=latestData(7);
 const elev=(stage>=7?erosion?.elevations[i]:undefined)??(stage>=6?landforms?.elevations[i]:undefined)??(stage>=5?coasts?.elevations?.[i]:undefined)??heights?.elevations[i]??0;
 if(display==='geometry'||stage===1){const h=((i*137.508)%360);return `hsl(${150+(h%55)},${18+(i%4)*2}%,${36+(i%7)*3}%)`;}
 if((display==='plates'||stage===3)&&plates){const owner=plates.owners[i],plate=plates.plates[owner],h=(owner*137.508+22)%360;return `hsl(${h},${plate.continental?32:42}%,${plate.continental?49:34}%)`;}
 if(display==='landforms'&&stage>=6&&landforms)return landformColors[landforms.classes[i]]||'#6e9d6d';
 if(display==='erosion'&&stage>=7&&erosion){const delta=elev-landforms.elevations[i];return delta<-.004?gradient(Math.min(1,-delta/.15),[[0,[105,111,105]],[1,[190,98,65]]]):delta>.004?gradient(Math.min(1,delta/.15),[[0,[105,111,105]],[1,[67,163,151]]]):'#78827b';}
 if(display==='flow'&&stage>=7&&erosion){if(coasts.water[i])return '#245773';const volume=erosion.discharge[i]/Math.max(1,erosion.summary.maxDischarge);return gradient(Math.pow(volume,.28),[[0,[104,115,100]],[.3,[115,145,132]],[1,[74,175,216]]]);}
 if((display==='height'||stage===4)&&heights)return gradient((elev+1.5)/3,heightColors);
 if((display==='coast'||stage>=5)&&coasts&&heights){const sea=coasts.seaLevel;return coasts.water[i]?gradient(clamp(.36+(elev-sea)*.7,0,1),[[0,[24,54,74]],[1,[61,116,146]]]):gradient(clamp((elev-sea)*1.6,0,1),landColors);}
 return 'rgb(54,99,83)';
}
function displayMode(stage){const mode=workspace.viewMode;return mode==='auto'||mode==='natural'?'auto':mode;}
function updateLegend(){
 const stage=effectiveStage(),mode=displayMode(stage),selected=mode==='auto'?stage<=2?'geometry':stage===3?'plates':stage===4?'height':stage===5?'coast':stage===6?'landforms':'coast':mode;
 const actual=(selected==='plates'&&stage<3)||(selected==='height'&&stage<4)||(selected==='coast'&&stage<5)||(selected==='landforms'&&stage<6)||((selected==='erosion'||selected==='flow')&&stage<7)?stage<=2?'geometry':stage===3?'plates':stage===4?'height':stage===5?'coast':'landforms':selected;
 const el=root.querySelector('#wg-legend');if(!el)return;
 if(actual==='erosion')el.innerHTML='<strong>Terrain height change</strong><span><i style="background:#be6241"></i>Material removed</span><span><i style="background:#43a397"></i>Net deposition</span><span><i style="background:#78827b"></i>Little change</span>';
 else if(actual==='flow')el.innerHTML='<strong>Runoff accumulation</strong><p>Blue indicates greater estimated downhill water flow. Optional channel lines trace the strongest drainage routes.</p>';
 else if(actual==='landforms')el.innerHTML='<strong>Landform types</strong>'+LANDFORM_NAMES.map((name,i)=>`<span><i style="background:${landformColors[i]}"></i>${name}</span>`).join('');
 else if(actual==='coast')el.innerHTML='<strong>Land / sea</strong><span><i style="background:#4487a2"></i>Water</span><span><i style="background:#799570"></i>Land</span>';
 else if(actual==='plates')el.innerHTML='<strong>Tectonic plates</strong><p>Colors distinguish neighboring plate territories; use plate boundaries to trace edges.</p>';
 else if(actual==='height')el.innerHTML='<strong>Relative elevation</strong><div class="wg-height-ramp"></div><p>Ocean depths → lowlands → mountain elevations</p>';
 else el.innerHTML='<strong>Voronoi cells</strong><p>Every colored region is one independent spatial cell.</p>';
}
function paint(){renderPending=false;if(!canvas||!ctx)return;
 const rect=canvas.getBoundingClientRect(),width=rect.width,height=rect.height,dpr=canvas.width/Math.max(1,width);
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#11232b';ctx.fillRect(0,0,width,height);
 const stage=effectiveStage(),mesh=latestData(2)||(currentStage()===2?workspace.working.data:null);
 if(stage===1||!mesh?.cells){
  if(stage===1&&latestData(1)){
   const geometry=latestData(1);
   ctx.save();ctx.setTransform(dpr*view.scale,0,0,dpr*view.scale,dpr*view.x,dpr*view.y);
   ctx.beginPath();
   if(geometry.shape==='rectangle')ctx.rect(0,0,geometry.width,geometry.height);
   else ctx.ellipse(geometry.width/2,geometry.height/2,geometry.width/2,geometry.height/2,0,0,Math.PI*2);
   ctx.fillStyle='#477768';ctx.strokeStyle='#c0e1bd';ctx.lineWidth=2.5/view.scale;
   ctx.fill();ctx.stroke();ctx.restore();
  }
  const scaleDisplay=root.querySelector('#wg-map-scale');
  if(scaleDisplay)scaleDisplay.textContent=`World width: ${shortNumber(Math.round(mapDimensions().width))} km`;
  return;
 }
 ctx.save();ctx.setTransform(dpr*view.scale,0,0,dpr*view.scale,dpr*view.x,dpr*view.y);
 const explicit=displayMode(stage);
 const mode=explicit==='auto'?(stage<=2?'geometry':stage===3?'plates':stage===4?'height':stage===5?'coast':stage===6?'landforms':'coast'):explicit;
 // Hide overlays that require layers which do not exist at the selected stage.
 const fallback=stage<=2?'geometry':stage===3?'plates':stage===4?'height':stage===5?'coast':'landforms';
 const allowed=(mode==='plates'&&stage<3)||(mode==='height'&&stage<4)||(mode==='coast'&&stage<5)||(mode==='landforms'&&stage<6)||((mode==='erosion'||mode==='flow')&&stage<7)?fallback:mode;
 const stroke=workspace.showEdges,points=mesh.cells,geometry=prepareGeometry(mesh),record=stageRecord(stage)?.data;
 if(colorCache.mesh!==mesh||colorCache.record!==record||colorCache.stage!==stage||colorCache.mode!==allowed){
  colorCache={mesh,record,stage,mode:allowed,colors:points.map((_,i)=>colorForCell(i,stage,allowed))};
 }
 const bounds={x0:-view.x/view.scale,y0:-view.y/view.scale,x1:(width-view.x)/view.scale,y1:(height-view.y)/view.scale};
 if(stroke){ctx.strokeStyle='rgba(5,20,28,.31)';ctx.lineWidth=.55/view.scale;}
 for(let i=0;i<points.length;i++){
  const [x0,y0,x1,y1]=geometry.bounds[i];if(x1<bounds.x0||x0>bounds.x1||y1<bounds.y0||y0>bounds.y1)continue;
  const path=geometry.paths[i];ctx.fillStyle=colorCache.colors[i];ctx.fill(path);
  if(stroke)ctx.stroke(path);
 }
  if(stage>=3&&workspace.showPlateBorders&&latestData(3)){
   const plates=latestData(3);
   if(borderCache.mesh!==mesh||borderCache.plates!==plates){borderCache.mesh=mesh;borderCache.plates=plates;borderCache.plateLines=borderSegments(mesh,plates.owners);}
   drawSegments(borderCache.plateLines,'rgba(254,204,124,.96)',2.3);
  }
  if(stage>=5&&workspace.showCoastBorders&&latestData(5)){
   const coasts=latestData(5);
   if(borderCache.mesh!==mesh||borderCache.coasts!==coasts){borderCache.mesh=mesh;borderCache.coasts=coasts;borderCache.coastLines=borderSegments(mesh,coasts.water);}
   drawSegments(borderCache.coastLines,'rgba(229,244,239,.93)',2.2);
  }
  // Use the same cell graph as the erosion solver; these are approximate
  // center-to-center drainage paths, not finalized river geometry.
  if(stage>=7&&(workspace.showFlow||allowed==='flow')&&latestData(7)){
   const flow=latestData(7);ctx.strokeStyle='rgba(130,226,247,.9)';ctx.lineCap='round';ctx.lineWidth=2.0/view.scale;ctx.beginPath();
   for(const i of flow.channels){const j=flow.flowTo[i];if(j<0)continue;ctx.moveTo(points[i].x,points[i].y);ctx.lineTo(points[j].x,points[j].y);}
   ctx.stroke();
  }
  if(selectedId!==null&&points[selectedId]){
  ctx.strokeStyle='#f8d47e';ctx.lineWidth=3/view.scale;ctx.stroke(geometry.paths[selectedId]);
 }
 if(measurePoints.length){
  const r=5/view.scale;
  if(measurePoints.length===2){ctx.beginPath();ctx.moveTo(measurePoints[0].x,measurePoints[0].y);ctx.lineTo(measurePoints[1].x,measurePoints[1].y);ctx.strokeStyle='#f9dc8c';ctx.lineWidth=2.4/view.scale;ctx.stroke();}
  for(const point of measurePoints){ctx.beginPath();ctx.arc(point.x,point.y,r,0,Math.PI*2);ctx.fillStyle='#f9dc8c';ctx.fill();ctx.strokeStyle='#17352c';ctx.lineWidth=1.5/view.scale;ctx.stroke();}
 }
 ctx.restore();
 const worldDisplay=worldToScreen(mesh.width,0).x-worldToScreen(0,0).x;
 const scaleText=root.querySelector('#wg-map-scale');if(scaleText)scaleText.textContent=`${Math.round(mesh.width/Math.max(worldDisplay,1)*100)} km / 100 px · ${shortNumber(points.length)} cells`;
}
function schedulePaint(){if(!renderPending){renderPending=true;requestAnimationFrame(paint);}}
function resizeCanvas(){if(!canvas)return;const rect=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.floor(rect.width*dpr)),h=Math.max(1,Math.floor(rect.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}schedulePaint();}
function fitMap(){if(!canvas)return;const {width,height}=canvas.getBoundingClientRect();if(!width||!height)return;const dims=mapDimensions();view.scale=Math.min(width/dims.width,height/dims.height)*.965;view.x=(width-dims.width*view.scale)/2;view.y=(height-dims.height*view.scale)/2;firstFit=false;rememberViewport();schedulePaint();}
function worldToScreen(x,y){return{x:x*view.scale+view.x,y:y*view.scale+view.y};}
function screenToWorld(x,y){return{x:(x-view.x)/view.scale,y:(y-view.y)/view.scale};}
function zoomBy(factor,x,y){const p=screenToWorld(x,y);view.scale=clamp(view.scale*factor,minimumZoom(),8);view.x=x-p.x*view.scale;view.y=y-p.y*view.scale;rememberViewport();schedulePaint();}
function pickCell(x,y){const mesh=latestData(2)||(currentStage()===2?workspace.working.data:null);if(!mesh?.cells||effectiveStage()<2)return null;const p=screenToWorld(x,y);if(!insideGeometry(p.x,p.y,geometryData()))return null;
 // Closest Voronoi site owns this point; stable even at exact shared edges.
 let closest=-1,d2=Infinity;for(let i=0;i<mesh.cells.length;i++){const c=mesh.cells[i],score=(p.x-c.x)**2+(p.y-c.y)**2;if(score<d2){d2=score;closest=i;}}
 return closest;
}
function updateInspector(){const panel=root.querySelector('#wg-inspector');if(!panel)return;
 if(selectedId===null){panel.hidden=true;return;}
 const c=(latestData(2)||(currentStage()===2?workspace.working.data:null))?.cells?.[selectedId];if(!c){panel.hidden=true;return;}
 const stage=effectiveStage(),plate=latestData(3),elevation=latestData(4),sea=latestData(5),details=[`Position ${Math.round(c.x)}, ${Math.round(c.y)}`,`${c.neighbors.length} neighboring cells`];
 if(stage>=3&&plate){const p=plate.plates[plate.owners[selectedId]];details.push(`Plate ${p.id+1} · ${p.continental?'continental':'oceanic'} crust`);}
 if(stage>=4&&elevation)details.push(`Relative elevation: ${(stage>=7&&latestData(7)?latestData(7).elevations[selectedId]:stage>=6&&latestData(6)?latestData(6).elevations[selectedId]:stage>=5&&sea?.elevations?sea.elevations[selectedId]:elevation.elevations[selectedId]).toFixed(3)}`);
 if(stage>=5&&sea)details.push(sea.water[selectedId]?'Ocean cell':'Land cell');
 if(stage>=6&&latestData(6)){const l=latestData(6);details.push(`Landform: ${LANDFORM_NAMES[l.classes[selectedId]]}`);details.push(`Ruggedness: ${Math.round(l.ruggedness[selectedId]*100)}%`);}
 if(stage>=7&&latestData(7)){const e=latestData(7);details.push(`Eroded depth: ${e.erosionDepth[selectedId].toFixed(4)}`);details.push(`Deposited depth: ${e.deposition[selectedId].toFixed(4)}`);details.push(`Estimated runoff: ${e.discharge[selectedId].toFixed(2)}`);if(e.flowTo[selectedId]>=0)details.push(`Downhill neighbor: cell ${e.flowTo[selectedId]+1}`);}
 details.push(`Cell area: ${shortNumber(Math.round(cellArea(c)))} km²`);
 panel.hidden=false;panel.innerHTML=`<button class="wg-inspector-close" data-action="close-inspector" aria-label="Close inspection">×</button><strong>Cell ${selectedId+1}</strong>${details.map(s=>`<span>${escapeHTML(s)}</span>`).join('')}`;
}
function updateMeasurement(){
 const button=root.querySelector('[data-action="measure"]'),readout=root.querySelector('#wg-measure-readout');
 if(button){button.classList.toggle('wg-active-tool',measureMode);button.setAttribute('aria-pressed',String(measureMode));}
 if(!readout)return;
 readout.hidden=!measureMode;
 if(!measureMode)return;
 if(!measurePoints.length)readout.textContent='Measure: tap your first point';
 else if(measurePoints.length===1)readout.textContent=`Start (${Math.round(measurePoints[0].x)}, ${Math.round(measurePoints[0].y)}) · tap second point`;
 else{
  const [a,b]=measurePoints,dx=b.x-a.x,dy=b.y-a.y;
  readout.textContent=`Distance: ${Math.hypot(dx,dy).toFixed(1)} km · Δx ${Math.round(dx)} · Δy ${Math.round(dy)} · tap to restart`;
 }
}
function measureAt(x,y){
 const point=screenToWorld(x,y);
 if(!insideGeometry(point.x,point.y,geometryData())){notice('Tap inside the world to measure',true);return;}
 measurePoints=measurePoints.length>=2?[point]:[...measurePoints,point];
 updateMeasurement();schedulePaint();
}
function locateCell(){
 const mesh=latestData(2)||((currentStage()===2)?workspace.working.data:null);
 if(!mesh?.cells){notice('Generate a Voronoi mesh first',true);return;}
 const entered=prompt(`Go to cell number (1–${mesh.cells.length})`,selectedId===null?'':String(selectedId+1));
 if(entered===null)return;
 const id=Number(entered.trim());
 if(!Number.isInteger(id)||id<1||id>mesh.cells.length){notice(`Enter a cell number from 1 to ${mesh.cells.length}`,true);return;}
 selectedId=id-1;
 const cell=mesh.cells[selectedId];view.scale=Math.max(view.scale,.55);
 view.x=canvas.clientWidth/2-cell.x*view.scale;
 view.y=canvas.clientHeight/2-cell.y*view.scale;
 rememberViewport();updateInspector();schedulePaint();
}
function canvasPoint(event){const r=canvas.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top};}
function pointerStart(event){if(event.button!==0&&event.pointerType==='mouse')return;const p=canvasPoint(event);canvas.setPointerCapture(event.pointerId);movePointers.set(event.pointerId,p);panMoved=false;if(movePointers.size===1){gesture={kind:'pan',origin:p};}else if(movePointers.size>=2){const [a,b]=[...movePointers.values()];gesture={kind:'pinch',dist:Math.hypot(a.x-b.x,a.y-b.y),mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};}}
function pointerMove(event){if(!movePointers.has(event.pointerId))return;const next=canvasPoint(event),before=movePointers.get(event.pointerId);movePointers.set(event.pointerId,next);
 if(movePointers.size===1&&gesture?.kind==='pan'){const dx=next.x-before.x,dy=next.y-before.y;view.x+=dx;view.y+=dy;if(Math.abs(next.x-gesture.origin.x)+Math.abs(next.y-gesture.origin.y)>5)panMoved=true;rememberViewport();schedulePaint();}
 else if(movePointers.size>=2){const [a,b]=[...movePointers.values()],distance=Math.max(.1,Math.hypot(a.x-b.x,a.y-b.y)),middle={x:(a.x+b.x)/2,y:(a.y+b.y)/2};if(gesture?.kind==='pinch'){const ratio=clamp(distance/Math.max(gesture.dist,.1),.5,2);zoomBy(ratio,gesture.mid.x,gesture.mid.y);view.x+=middle.x-gesture.mid.x;view.y+=middle.y-gesture.mid.y;rememberViewport();gesture={kind:'pinch',dist:distance,mid:middle};}panMoved=true;schedulePaint();}
}
function pointerEnd(event){if(!movePointers.has(event.pointerId))return;const position=canvasPoint(event);movePointers.delete(event.pointerId);if(!movePointers.size){if(event.type!=='pointercancel'&&!panMoved&&gesture?.kind==='pan'){if(measureMode)measureAt(position.x,position.y);else{selectedId=pickCell(position.x,position.y);updateInspector();schedulePaint();}}gesture=null;}else{gesture={kind:'pan',origin:[...movePointers.values()][0]};panMoved=true;}}
function downloadText(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);}
function screenshot(){canvas.toBlob(blob=>{if(!blob){notice('Unable to capture map',true);return;}const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${workspace.name.replace(/[^a-z0-9_-]+/gi,'-').toLowerCase()||'world'}-layer${effectiveStage()}-map.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);notice('Current map view exported');},'image/png');}
function worldThroughStage(stage){
 const target=stageRecord(stage);if(!target?.data)throw Error('This layer has not been generated');
 if(stage===currentStage()&&(generating||dirty))throw Error('Wait until the current layer finishes generating before saving');
 return snapshotThroughStage(workspace,stage);
}
function exportWorld(world,labelStage){const full=structuredClone(world);full.exportedAt=new Date().toISOString();downloadText(JSON.stringify(full),`${full.name.replace(/[^a-z0-9_-]+/gi,'-').toLowerCase()||'world'}-stage${labelStage}-worldgen.json`);notice('Complete world file exported');}
async function doExport(){
 const stage=viewStage();
 try{const selected=worldThroughStage(stage);exportWorld(selected,stage);}
 catch(error){notice(`Export unavailable: ${error.message}`,true);}
}
async function exportAll(){
 if(generating||dirty){notice('Wait for the current working layer to finish before exporting everything',true);return;}
 exportWorld(workspace,availableThrough());
}
function availableThrough(){return workspace.locked.length+(workspace.working.data?1:0);}
async function saveCheckpoint(){
 const stage=viewStage();
 if(!latestData(stage)){notice('This layer has no preview yet. Finish generating it or select an earlier completed layer.',true);return;}
 let world;
 try{world=worldThroughStage(stage);}catch(error){notice(error.message,true);return;}
 const proposed=prompt('Checkpoint name',`${workspace.name} — through layer ${stage}`);if(proposed===null)return;
 const name=proposed.trim().slice(0,100)||`${workspace.name} — through layer ${stage}`;
 const snap={id:`save-${Date.now()}-${Math.round(Math.random()*10000)}`,name,created:new Date().toISOString(),stage};
 try{
  // Write the full world first; the small index is committed only after it exists.
  await storePut(`checkpoint:${snap.id}`,world);
  snapshots.unshift(snap);
  await saveSnapshotsIndex();
  notice(`Layer ${stage} checkpoint saved: ${name}`);
 }catch(error){snapshots=snapshots.filter(s=>s.id!==snap.id);notice(`Checkpoint could not be saved: ${error.message}`,true);}
}
function modal(html){root.querySelector('#wg-modal-host').innerHTML=`<div class="wg-modal-backdrop"><section class="wg-modal" role="dialog" aria-modal="true" aria-label="World library"><div class="wg-modal-heading"><h2>World library</h2><button class="wg-icon-button" data-action="close-modal" aria-label="Close">×</button></div>${html}</section></div>`;activeModal=true;}
function showLibrary(){
 modal(`<p class="wg-modal-caption">Automatic caching keeps your current work. Named checkpoints preserve full, independent world states.</p><div class="wg-library-actions"><button data-action="new-world">+ New world</button><button data-action="import">Import JSON</button><button data-action="export">Export selected layer</button><button data-action="export-all">Export entire world</button><button data-action="screenshot">Map PNG</button></div><h3>Saved checkpoints <span>${snapshots.length}</span></h3><div class="wg-snapshot-list">${snapshots.length?snapshots.map(s=>`<div class="wg-snapshot"><div><strong>${escapeHTML(s.name)}</strong><small>${escapeHTML(new Date(s.created).toLocaleString())} · Layer ${s.stage}</small></div><div><button data-action="restore" data-id="${escapeHTML(s.id)}">Open</button><button data-action="export-checkpoint" data-id="${escapeHTML(s.id)}">Export</button><button class="wg-delete" data-action="delete" data-id="${escapeHTML(s.id)}" aria-label="Delete checkpoint">×</button></div></div>`).join(''):'<p class="wg-hint">No checkpoints yet. Lock a layer, then tap Save.</p>'}</div><p class="wg-modal-caption">Exports include all locked layers, working data, settings, seeds, and generated geometry. Your world stays on this device unless you export it.</p>`);
}
function closeModal(){root.querySelector('#wg-modal-host').innerHTML='';activeModal=false;}
function changeWorld(world){requestId++;stopWorker();clearTimeout(rebuildTimer);generating=false;measurePoints=[];measureMode=false;workspace=upgradeWorld(world);resetBorderCache();dirty=!!(workspace.working.data&&workspace.working.dataSettings&&JSON.stringify(workspace.working.settings)!==JSON.stringify(workspace.working.dataSettings));selectedId=null;firstFit=!workspace.viewport;void persist();closeModal();rebuildUI();requestAnimationFrame(()=>{resizeCanvas();if(firstFit)fitMap();else restoreViewport();});if(currentStage()<=IMPLEMENTED&&(!workspace.working.data||dirty))scheduleGeneration(150);}
async function handleImport(file){if(!file)return;try{if(file.size>60*1024*1024)throw Error('Files over 60 MB are not supported');const parsed=JSON.parse(await file.text());upgradeWorld(parsed);if(!confirm(`Load '${parsed.name}'? Your current working state will be replaced. Export or save a checkpoint first to preserve it.`))return;changeWorld(parsed);notice('Complete world imported');}catch(error){notice(`Import failed: ${error.message}`,true);}finally{root.querySelector('#wg-import').value='';}}
async function handleAction(action,button){
 switch(action){
  case 'home':{flushViewport();await flushPersist();if(host?.returnToLauncher)host.returnToLauncher();else showLibrary();break;}
  case 'save':await saveCheckpoint();break;
  case 'library':showLibrary();break;
  case 'close-modal':closeModal();break;
  case 'close-inspector':selectedId=null;updateInspector();schedulePaint();break;
  case 'fit':fitMap();break;
  case 'locate-cell':locateCell();break;
  case 'measure':measureMode=!measureMode;measurePoints=[];selectedId=null;updateInspector();updateMeasurement();schedulePaint();break;
  case 'toggle-explore':{const center=canvas?screenToWorld(canvas.clientWidth/2,canvas.clientHeight/2):null;workspace.exploreMode=!workspace.exploreMode;rebuildUI();requestAnimationFrame(()=>{resizeCanvas();if(center){view.x=canvas.clientWidth/2-center.x*view.scale;view.y=canvas.clientHeight/2-center.y*view.scale;}rememberViewport();schedulePaint();});persist();break;}
  case 'toggle-overlays':{const panel=root.querySelector('#wg-overlays'),open=panel.hidden;panel.hidden=!open;root.querySelector('[data-action="toggle-overlays"]').setAttribute('aria-expanded',String(open));break;}
  case 'prev-stage':case 'next-stage':{const shift=action==='prev-stage'?-1:1,target=workspace.viewStage+shift;if(target>=1&&target<=IMPLEMENTED&&latestData(target)){workspace.viewStage=target;selectedId=null;persist();rebuildUI();}break;}
  case 'screenshot':screenshot();break;
  case 'zoom-in':zoomBy(1.45,canvas.clientWidth/2,canvas.clientHeight/2);break;
  case 'zoom-out':zoomBy(1/1.45,canvas.clientWidth/2,canvas.clientHeight/2);break;
  case 'reroll':workspace.working.settings.seed=nextSeed();dirty=true;void persist();rebuildUI();scheduleGeneration(20);break;
  case 'regenerate':scheduleGeneration(10);break;
  case 'reset-settings':workspace.working.settings=defaultsForStage(currentStage());dirty=true;void persist();rebuildUI();scheduleGeneration(50);break;
  case 'lock':commitLayer();break;
  case 'edit-earlier':reviseStage(viewStage());break;
  case 'rename':{const name=prompt('World name',workspace.name);if(name!==null&&name.trim()){workspace.name=name.trim().slice(0,80);void persist();rebuildUI();}break;}
  case 'export':await doExport();break;
  case 'export-all':await exportAll();break;
  case 'export-checkpoint':{const saved=snapshots.find(s=>s.id===button.dataset.id);if(saved){const savedWorld=await storeGet(`checkpoint:${saved.id}`);if(savedWorld){const upgraded=upgradeWorld(savedWorld);exportWorld(upgraded,saved.stage);}else notice('Checkpoint data unavailable',true);}break;}
  case 'import':root.querySelector('#wg-import').click();break;
  case 'new-world':if(confirm('Create a new world? Your current working world will be replaced. Save a checkpoint or export it first if needed.'))changeWorld(newWorld());break;
  case 'restore':{const saved=snapshots.find(s=>s.id===button.dataset.id);if(saved&&confirm(`Open checkpoint '${saved.name}'? This replaces your current working world.`)){const savedWorld=await storeGet(`checkpoint:${saved.id}`);if(!savedWorld){notice('Checkpoint data unavailable',true);break;}changeWorld(savedWorld);notice('Checkpoint restored');}break;}
  case 'delete':{const saved=snapshots.find(s=>s.id===button.dataset.id);if(saved&&confirm(`Delete checkpoint '${saved.name}'?`)){snapshots=snapshots.filter(s=>s.id!==saved.id);await saveSnapshotsIndex();await storeDelete(`checkpoint:${saved.id}`);showLibrary();}break;}
 }
}
function bindEvents(){
 root.addEventListener('click',event=>{
  const stageBtn=event.target.closest('[data-stage]');if(stageBtn&&!stageBtn.disabled){workspace.viewStage=Number(stageBtn.dataset.stage);selectedId=null;void persist();rebuildUI();return;}
  const info=event.target.closest('[data-info]');if(info){event.preventDefault();showParameterHelp(info.dataset.info);return;}
  const adjust=event.target.closest('[data-adjust]');if(adjust){event.preventDefault();adjustParameter(adjust.dataset.adjust,Number(adjust.dataset.direction));return;}
  const actionBtn=event.target.closest('[data-action]');if(actionBtn){event.preventDefault();void handleAction(actionBtn.dataset.action,actionBtn).catch(e=>notice(e.message,true));}
 });
 // Sliders update immediately; typed values commit only on change so a user can
 // clear and retype a number without generating an invalid intermediate world.
 root.addEventListener('input',event=>{
  const el=event.target,key=el.dataset?.slider;
  if(!key)return;
  const [min,max]=controlBounds(currentStage(),key);
  const value=key==='averageArea'?sliderToArea(el.value,min,max):Number(el.value);
  applyParameter(key,value,false);
 });
 root.addEventListener('change',event=>{
  const el=event.target;
  if(el.dataset?.number){const key=el.dataset.number;applyParameter(key,Number(el.value),true);return;}
  if(el.dataset?.setting){applyParameter(el.dataset.setting,el.value,true);return;}
  if(el.id==='wg-edges'){workspace.showEdges=el.checked;void persist();schedulePaint();}
  if(el.id==='wg-plate-borders'){workspace.showPlateBorders=el.checked;void persist();schedulePaint();}
  if(el.id==='wg-coast-borders'){workspace.showCoastBorders=el.checked;void persist();schedulePaint();}
  if(el.id==='wg-flow'){workspace.showFlow=el.checked;void persist();schedulePaint();}
  if(el.id==='wg-palette'){workspace.viewMode=el.value==='natural'?'auto':el.value;void persist();updateLegend();schedulePaint();}
  if(el.id==='wg-seed'){workspace.working.settings.seed=clamp(Number(el.value)||0,0,0xffffffff);dirty=true;void persist();showBusy(generating);scheduleGeneration(40);}
  if(el.id==='wg-import')void handleImport(el.files?.[0]);
 });
 canvas.addEventListener('pointerdown',pointerStart);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerEnd);canvas.addEventListener('pointercancel',pointerEnd);
 canvas.addEventListener('wheel',event=>{event.preventDefault();const p=canvasPoint(event);zoomBy(event.deltaY<0?1.14:1/1.14,p.x,p.y);},{passive:false});
 canvas.addEventListener('dblclick',event=>{const p=canvasPoint(event);zoomBy(1.5,p.x,p.y);});
 addEventListener('resize',resizeCanvas);
 if('ResizeObserver' in globalThis)new ResizeObserver(resizeCanvas).observe(canvas);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){flushViewport();void flushPersist();}});
}
async function initialize(){
 // Keep the loaded value available after the storage try/catch. Previously,
 // `stored` was block-scoped inside try but referenced below it, causing a
 // ReferenceError in Safari before WorldGen could open inside AppLauncher.
 let stored=null;
 try{
  const [saved,index,legacy,indexMigrated]=await Promise.all([storeGet(KEY),storeGet('checkpoint-index'),storeGet('snapshots'),storeGet('checkpoint-index-v2')]);
  if(saved){workspace=upgradeWorld(saved);stored=saved;}
  if(Array.isArray(index)){
   snapshots=index.filter(s=>s?.id&&s?.stage&&s?.name);
   if(!indexMigrated){
    // Index entries only contain metadata, so migrate their stage labels
    // cheaply. Each actual checkpoint is upgraded when opened/exported.
    snapshots=snapshots.map(s=>({...s,stage:Math.min(IMPLEMENTED,s.stage+1)}));
    await storePut('checkpoint-index',snapshots);
    await storePut('checkpoint-index-v2',true);
   }
  }
  else if(Array.isArray(legacy)){
   // One-time, non-destructive migration from v0.1.0's giant snapshots array.
   const valid=legacy.filter(s=>s?.id&&[1,SCHEMA_VERSION].includes(s?.world?.schema));
   for(const s of valid)await storePut(`checkpoint:${s.id}`,upgradeWorld(s.world));
   snapshots=valid.map(({id,name,created,stage})=>({id,name,created,stage:stage+1}));
   await storePut('checkpoint-index',snapshots);
   await storePut('checkpoint-index-v2',true);
   await storeDelete('snapshots');
  }
 }catch(error){console.warn('WorldGen startup storage:',error);storageHealthy=false;}
 dirty=!!(workspace.working.data&&workspace.working.dataSettings&&JSON.stringify(workspace.working.settings)!==JSON.stringify(workspace.working.dataSettings));
 if(workspace.viewport&&Number.isFinite(workspace.viewport.scale)&&Number.isFinite(workspace.viewport.centerX)&&Number.isFinite(workspace.viewport.centerY))firstFit=false;
 workspace.viewStage=clamp(Math.round(Number(workspace.viewStage)||1),1,Math.min(IMPLEMENTED,workspace.working.stage));
 buildShell();if(stored?.schema===1)void flushPersist();if(currentStage()<=IMPLEMENTED&&(!workspace.working.data||dirty))scheduleGeneration(100);
}
await initialize();
