import {runUpdateButton as localUpdateButton} from './pwa-update.js';
import {hasLauncherHost,returnToLauncher} from './browser-host.js';
import {shareBlob,shareText} from './share-files.js';
import {geometryConstraintReport,meshConstraintReport} from './generation-constraints.js';
import {stagePresets,matchingPreset,applyStagePreset} from './presets.js';
import {readReliefPreference,writeReliefPreference,formatRelief,clampRelief} from './relief-setting.js';
import {REFERENCE_AREA_KM2} from './geographic-units.js';
import {DEFAULTS,STAGES,IMPLEMENTED,stageUsesSeed,newWorld,prepareWorld,snapshotThroughStage,LANDFORM_NAMES,SOIL_NAMES,BIOME_NAMES,VEGETATION_NAMES,cellArea,landAreaFraction,generateGeometry,insideGeometry,meshTargetCount,MAX_CELLS} from './engine.js';
import {buildCellIndex,cellsInBounds,cellAtPoint} from './spatial.js';
import {Terrain3DViewer} from './terrain-3d.js';
import {ELEVATION_RENDER_STAGE,selectTerrainSource} from './terrain-3d-model.js';
import {selectTerrainAppearance,terrainAppearanceName} from './terrain-3d-material.js';
import {createStartupStorage,readRecoveryCheckpoint} from './startup-storage.js';
import {createAutosave} from './persistence.js';
import {commitCheckpoint} from './checkpoint-storage.js';
import {elevationToMetres,displayParameter,storedParameter,sedimentToKm3,terrainVerticalScales} from './elevation-units.js';

const APP_VERSION='0.2.14',DB_NAME='worldgen-dev-023';
let startupReady=false;
let terrainViewer=null;
let reliefMultiplier=readReliefPreference();
const headerIcon={home:'<svg class="wg-header-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-8h6v8"/></svg>',refresh:'<svg class="wg-header-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-5L3 9V3m0 6h6M4 13a8 8 0 0 0 14 5l3-3v6m0-6h-6"/></svg>'};
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
  ['relaxation','Lloyd relaxation','range',0,8,1,'linear']
 ],
 3:[['plates','Plates','range',3,50,1,'linear']],
 4:[['motion','Boundary stress','range',0,2,0.05,'linear'],['uplift','Line uplift strength','range',0,1.6,0.05,'linear'],['upliftWidth','Uplift reach (km)','range',30,500,10,'linear'],['roughness','Background altitude variation','range',0,1.4,0.05,'linear']],
 5:[['oceanOffset','Ocean elevation offset (m)','range',-1.8,1.8,0.01,'linear']],
 6:[['edgeOcean','Edge lowering','range',0,1.5,0.05,'linear'],['edgeFade','Edge falloff (km)','range',0.5,5,0.25,'linear'],['setbackStrength','Coastal setback strength','range',0,1.8,0.05,'linear'],['setbackWidth','Coastal setback width (km)','range',2,18,0.5,'linear']],
 7:[['ridge','Ridge strength','range',0,1.6,0.05,'linear'],['detail','Terrain variation','range',0,1.6,0.05,'linear'],['valleys','Valley incision','range',0,1.6,0.05,'linear'],['volcanism','Volcanic activity','range',0,1,0.025,'linear']],
 8:[['rainfall','Erosion water input','range',0,1.6,0.05,'linear'],['hydraulic','Water erosion','range',0,1.6,0.05,'linear'],['thermal','Slope weathering','range',0,1.6,0.05,'linear'],['hardness','Rock resistance','range',0,1,0.05,'linear'],['iterations','Erosion passes','range',1,40,1,'linear']],
 9:[['equatorTemp','Equatorial temperature (°C)','range',10,40,0.5,'linear'],['latitudeCenter','Central latitude (°)','range',-70,70,2,'linear'],['latitudeSpan','Latitude span (°)','range',20,180,5,'linear'],['axialTilt','Axial tilt (°)','range',0,45,0.5,'linear'],['rainfall','Annual rainfall baseline (mm)','range',100,4000,50,'linear'],['windDirection','Wind direction (°)','range',-180,180,5,'linear'],['rainShadow','Mountain rain shadow','range',0,2,0.05,'linear'],['maritime','Ocean moderation','range',0,1.5,0.05,'linear']],
 10:[['runoffScale','Runoff multiplier','range',0.1,2.5,0.1,'linear'],['infiltration','Ground infiltration','range',0,0.95,0.05,'linear'],['evaporation','Evaporation','range',0,1.5,0.05,'linear'],['riverThreshold','River threshold (km²)','range',2,120,1,'linear'],['lakeDepth','Minimum lake depth (m)','range',0.002,0.3,0.002,'linear'],['minLakeCells','Minimum lake size (cells)','range',1,15,1,'linear']],
 11:[['weathering','Mineral weathering','range',0,2,0.1,'linear'],['organicInput','Organic accumulation','range',0,2,0.1,'linear'],['alluvialInput','Alluvial deposition','range',0,2,0.1,'linear'],['permeabilityBias','Permeability factor','range',0.25,2,0.05,'linear'],['groundwaterRecharge','Groundwater recharge potential','range',0,2,0.1,'linear']],
 12:[['temperatureShift','Biome temperature shift (°C)','range',-12,12,0.5,'linear'],['rainfallResponse','Effective precipitation','range',0.4,1.8,0.05,'linear'],['forestThreshold','Forest moisture threshold','range',0.45,1.8,0.05,'linear'],['wetlandThreshold','Wetland groundwater threshold','range',0.4,0.95,0.025,'linear'],['alpineLimit','Alpine summer threshold (°C)','range',0,16,0.5,'linear'],['patchVariation','Regional biome variation','range',0,0.4,0.025,'linear']],
 13:[['vegetationDensity','Vegetation density','range',0.2,1.8,0.05,'linear'],['maturity','Landscape maturity','range',0,1,0.05,'linear'],['disturbance','Disturbance pressure','range',0,1,0.05,'linear'],['riparianStrength','Riparian boost','range',0,1.5,0.05,'linear'],['patchiness','Vegetation patchiness','range',0,0.45,0.025,'linear']]
};
const PARAM_HELP={
 shape:['World outline','Rectangle creates a four-sided map. Circle creates a map with equal horizontal and vertical radii. Ellipse lets you control each radius independently. All three are flat 2D worlds with no depth.'],
 width:['Width','The left-to-right extent of a rectangular world, measured in kilometers. Increasing it expands the world and its area; decreasing it contracts the world.'],
 height:['Height','The top-to-bottom extent of a rectangular world, in kilometers. Increasing it expands the world vertically and raises its area.'],
 radius:['Circle radius','Distance in kilometers from the world center to its edge. Increasing radius increases both width and height; doubling it quadruples area.'],
 radiusX:['Horizontal radius','The east-to-west center-to-edge radius of an ellipse in kilometers. Increasing it widens the world and increases area proportionally.'],
 radiusY:['Vertical radius','The north-to-south center-to-edge radius of an ellipse in kilometers. Increasing it makes the world taller and increases area proportionally.'],
 averageArea:['Average Voronoi cell area','The target mean geographic area of a polygon, in square kilometers (km²). Lower values create MORE polygons and finer simulation resolution; higher values create FEWER, larger cells and render faster. The slider is logarithmic for precision across small and large worlds. Count is limited to 100–20,000 cells. Larger worlds take more memory and longer to regenerate and render on phones.'],
 distribution:['Site distribution','Even / jittered places sites in a loose grid; random spreads them out with a minimum separation; clustered creates uneven concentrations. Select a pattern to change cell uniformity.'],
 jitter:['Position jitter','How far Voronoi sites shift away from the evenly spaced starting grid. Higher values make cell shapes and sizes less regular; lower values give a more uniform tessellation.'],
 relaxation:['Lloyd relaxation','Number of times sites move toward their polygon centers. Higher values make cells rounder and more even, but take longer to generate. Zero keeps the initial irregular shapes.'],
 plates:['Plate count','Number of tectonic territories and their shared boundaries. More plates create more boundaries; fewer create broader regions. Plate boundary stress and uplift are defined in the next layer.'],
 motion:['Boundary stress','Magnitude of the relative motion used only to generate positive and negative altitude along the fixed plate boundaries. No plates move, and no ocean or crust types are assigned.'],
 uplift:['Line uplift strength','Amplitude of the mountain and rift fields extending away from the plate boundaries. Larger values increase both positive and negative relief.'],
 upliftWidth:['Uplift reach','Distance scale for the altitude field to taper away from tectonic boundaries, measured in kilometers. Larger values create wider ranges.'],
 roughness:['Background altitude variation','Amount of correlated altitude variation across the world, centered around the zero-altitude reference plane. This does not designate land or water.'],
 oceanOffset:['Ocean elevation offset','Raise or lower every altitude before the zero-level flooding test. A positive offset exposes more land; a negative offset submerges more land. Zero and below is flooded. The upstream elevation layer is never modified.'],
 edgeOcean:['Edge lowering','Lower coast elevation near the outside boundary after initial flooding. When positive, an outermost water rim is enforced in the coastline layer only.'],
 edgeFade:['Edge falloff width','Width of the narrow ocean bias in kilometres, independent of mesh density. The reach is capped at 12% of the shorter world dimension. The outermost polygon stays underwater if Edge ocean bias is enabled. This narrow rim does not by itself move whole continents inward; use Continental setback for that.'],
 setbackStrength:['Coastal setback strength','Additional gradual reduction in elevation near the world boundary, modifying the water mask and coastline after Layer 5.'],
 setbackWidth:['Continental setback width','How many kilometres the broad continental bias reaches inward. Increasing it creates a more natural expanse of ocean between the continents and the artificial boundary. The reach is limited to 16% of the shorter world dimension so the interior stays unaffected.'],
 ridge:['Ridge strength','Strength of coherent mountainous ridges during landform refinement. Higher produces stronger belts and peaks; lower makes ridges subtler. Locked coastlines remain fixed.'],
 detail:['Terrain variation','Fine-scale variation added to existing elevations. Higher gives rougher and more diverse local terrain; lower keeps smoother landscapes.'],
 valleys:['Valley incision','How strongly valley-like features cut into the terrain. More produces deeper local valleys; less preserves uplands.'],
 volcanism:['Volcanic activity','Likelihood of volcanic landforms near suitable plate boundaries. Increasing it produces more volcanic cells; decreasing it reduces them.'],
 rainfall:['Rainfall or erosion water input','In the erosion stage this controls preliminary water-driven erosion and sediment transport, not the eventual climate. In the climate stage it sets annual rainfall in millimetres; it does not retroactively change locked erosion.'],
 hydraulic:['Water erosion','How strongly downhill flowing water cuts into the terrain. More carves deeper flow routes and increases sediment transport; less leaves landforms closer to their input.'],
 thermal:['Slope weathering','Movement of material from steep slopes to nearby lower cells. More smooths and redistributes slopes; less preserves sharp terrain changes.'],
 hardness:['Rock resistance','How resistant material is to erosion and weathering. Higher values reduce removal rates; lower values allow stronger erosion.'],
 iterations:['Erosion passes','Number of approximate erosion simulation updates. More passes generally accumulate greater change and require more processing time.'],
 equatorTemp:['Equatorial temperature','Reference mean temperature near 0° latitude in Celsius. Increasing it makes all regions warmer; cooler settings increase snow and cold-climate potential. Elevation reduces temperature.'],
 latitudeCenter:['Central latitude','Notional latitude of the middle of this flat map. Increase it to move the world toward the northern hemisphere, or decrease for the southern hemisphere. It is an environmental coordinate, not spherical geometry.'],
 latitudeSpan:['Latitude span','How many degrees of latitude the map covers from north to south. Larger spans create greater temperature differences across the world; smaller spans give more uniform climates. Values are capped at the poles.'],
 axialTilt:['Axial tilt','Approximate seasonal contrast. Higher tilt produces hotter summers and colder winters away from the equator; zero tilt removes seasonal temperature differences. Climate is a stylized model, not a full astronomy simulation.'],
 windDirection:['Prevailing wind direction','Direction the prevailing wind blows TOWARD, in degrees: 0 east, 90 north, 180 west, and −90 south. Changing it relocates windward rainfall and leeward rain shadows.'],
 rainShadow:['Mountain rain shadow','Strength of moisture loss as air rises over terrain. Increasing it tends to make windward mountains wetter and leeward regions drier. Zero minimizes this orographic effect.'],
 maritime:['Ocean moderation','How strongly seas within approximately 252 km along the mesh moderate seasonal temperature changes. Increasing the value makes coastal climates less extreme. Lower values produce more continental climates.'],
 runoffScale:['Runoff multiplier','Scales climate rainfall before calculating available surface runoff. Higher values create fuller streams and more river segments; lower values reduce flow. The original climate precipitation layer stays unchanged.'],
 infiltration:['Ground infiltration','Fraction of incoming precipitation absorbed into the ground. Higher values leave less water for surface rivers; lower values create more overland runoff. Subsurface aquifers are not simulated yet.'],
 evaporation:['Evaporation','Temperature-dependent loss of surface water to the atmosphere and plants. Raising it dries warmer areas and suppresses rivers; lowering it leaves more runoff. This is an approximate annual water balance.'],
 riverThreshold:['River threshold','A river is drawn only after collecting runoff from a catchment at least this many square kilometres, with sufficient flow. Smaller values generate more tributaries, while larger values retain only major channels. This threshold is independent of mesh density.'],
 lakeDepth:['Minimum lake depth','Minimum local elevation difference between a topographic basin and its spill point for a cell to qualify as a lake. Lower values include shallow depressions; higher values retain only deeper basins. The control is in physical metres; saved values retain their original encoding.'],
 minLakeCells:['Minimum lake size','Minimum number of adjoining qualifying polygons required to create a visible lake. One allows small cell-sized lakes; higher values omit small or fragmented water bodies.'],
 weathering:['Mineral weathering','Scales the rate of modeled regolith formation. Increasing it produces deeper soils in warm and moist regions; exposed high slopes remain thinner. This is an indicative soil formation model, not a simulation of geological time.'],
 organicInput:['Organic accumulation','Adjusts the potential organic content supported by climate and local wetness. Higher values encourage richer surface horizons and some wetland soils; lower values produce mineral-dominated soils.'],
 alluvialInput:['Alluvial deposition','Scales soil accumulation in valleys, floodplains, and areas with deposited sediment. Increasing it tends to deepen lowland soil without modifying rivers, erosion, or elevation.'],
 permeabilityBias:['Permeability factor','Scales the drainage potential of coarse and fine soils. Higher values allow more infiltration within the derived soil layer; lower values retain more water near the surface. Hydrology from the previous layer is not recalculated.'],
 groundwaterRecharge:['Groundwater recharge potential','Scales relative shallow-groundwater availability from rain, soil drainage and valley location. This is a suitability index, not a simulated underground aquifer or absolute groundwater depth.'],
 temperatureShift:['Biome temperature shift','Adds or subtracts degrees Celsius only when classifying biomes. Higher settings favor warmer ecosystems; lower ones expand cold-climate ecosystems. Climate temperatures saved in layer 8 remain unchanged.'],
 rainfallResponse:['Effective precipitation','Multiplies the rainfall considered for biome and ecological potential. Higher settings favor forests and wetlands; lower settings expand grasslands, steppes, and deserts. Actual climate rainfall and river flow are unchanged.'],
 forestThreshold:['Forest moisture threshold','The minimum modeled precipitation-to-evaporation ratio normally needed for forest. Higher values make forests less common; lower values allow woodland in drier locations.'],
 wetlandThreshold:['Wetland groundwater threshold','Minimum relative groundwater availability for wetland classification in suitable low-relief and moist regions. Increasing reduces wetlands; decreasing allows more wetlands. Lakes and oceans remain water.'],
 alpineLimit:['Alpine summer threshold','Warmest-season temperature below which suitable high mountain terrain becomes alpine, unless permanently icy. Increasing it expands alpine areas down into milder mountains; decreasing it restricts alpine terrain to colder heights.'],
 patchVariation:['Regional biome variation','Adds gentle, spatially correlated moisture variation to ecosystem boundaries. Higher values create more local patchiness; zero uses only the supplied climate, soils, and terrain. This does not alter climate data.'],
 vegetationDensity:['Vegetation density','Multiplies realized plant cover within the envelope allowed by the locked biome and soil layers. Higher values give more foliage and canopy; lower values keep the same biome but make vegetation sparser.'],
 maturity:['Landscape maturity','Represents how developed the potential vegetation is in this static snapshot. Higher values support taller, denser vegetation and more woody biomass. This does not simulate years of growth.'],
 disturbance:['Disturbance pressure','Approximate ecological disturbance such as fire, storms, and grazing. Increasing it reduces canopy and biomass, without modifying climate, soils, or simulated history.'],
 riparianStrength:['Riparian boost','Additional vegetation supported near existing river channels and lake shores. Increasing it enhances riverside greenery within 126 km of connected land in newly generated layers; decreasing it removes the additional boost. It never changes the water network.'],
 patchiness:['Vegetation patchiness','Amount of broad, spatially correlated variation in vegetation density. Higher values create landscape-scale mosaics of cover; zero removes this extra variation. Individual cells are not randomized independently.'],
 seed:['Random seed','An integer that controls repeatable randomness in this layer. The same seed with the same inputs creates the same result. Reroll chooses a different seed.']
};
function geometryData(){return latestData(1)||(currentStage()===1?workspace.working.data:null)||generateGeometry(DEFAULTS[1]);}
function mapDimensions(){const g=geometryData();return {width:g.width,height:g.height};}
function controlBounds(stage,key){if(key==='averageArea'){
 const a=geometryData().areaKm2;return [a/MAX_CELLS,a/100];
 }
 const item=OPTIONS[stage]?.find(o=>o[0]===key);return item?[item[3],item[4]]:[0,1];}
function areaToSlider(value,min,max){return Math.round(1000*Math.log(clamp(value,min,max)/min)/Math.log(max/min));}
function sliderToArea(position,min,max){return min*Math.pow(max/min,Number(position)/1000);}
function formatNumber(n){return Number(Number(n).toFixed(6));}
const palettes={
  natural:'Natural',vegetation:'Vegetation cover',habitats:'Habitat types',canopyCover:'Canopy cover',groundCover:'Ground vegetation',biomass:'Biomass index',habitatComplexity:'Habitat complexity',riparian:'Riparian influence',biomes:'Biomes',productivity:'Ecological productivity',treePotential:'Tree-cover potential',waterStress:'Drought stress',growingSeason:'Thermal growing season',ecotones:'Biome transitions',soils:'Soil types',soilDepth:'Soil depth',soilFertility:'Fertility potential',soilPermeability:'Permeability',soilGroundwater:'Groundwater potential',soilErosion:'Soil erosion risk',hydrology:'Rivers and lakes',catchment:'Upstream area',watersheds:'Drainage basins',geometry:'Cell geometry',plates:'Tectonic plates',height:'Elevation',coast:'Land / sea',landforms:'Landforms',erosion:'Erosion / deposition',flow:'Drainage flow',temperature:'Mean temperature',rain:'Annual precipitation',moisture:'Moisture index',seasonality:'Seasonal contrast',january:'January temperature',july:'July temperature'
};
let dbPromise=null,workspace=newWorld(),snapshots=[],view={scale:1,x:0,y:0},canvas,ctx,renderPending=false;
let generating=false,dirty=false,storageWarned=false,requestId=0,worker=null,rebuildTimer=null,selectedId=null,activeModal=null;
let progressPercent=0,cancelPending=null,borderCache={mesh:null,plates:null,coasts:null,plateLines:null,coastLines:null};
let firstFit=true,movePointers=new Map(),gesture=null,panMoved=false;
// Path2D objects and polygon extents are cached across map pans and zooms.
let geometryCache={mesh:null,paths:null,bounds:null,spatial:null},colorCache={mesh:null,record:null,stage:0,mode:null,colors:null};
let measureMode=false,measurePoints=[];
let drawerDrag=null,suppressHandleClick=false,unlocking=false;
const expandedFineTuneStages=new Set();
const PRESET_PREVIEWS={7:'Landforms and 3D terrain',8:'Erosion / deposition and drainage flow',9:'Temperature, precipitation and seasonal maps',10:'Rivers, lakes, catchments and watersheds',11:'Soil types, depth, fertility and groundwater',12:'Biomes, ecological productivity and tree potential',13:'Vegetation cover, canopy, ground cover and biomass'};
function db(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  if(!('indexedDB' in globalThis)){reject(Error('IndexedDB unavailable'));return;}
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>{const database=req.result;if(!database.objectStoreNames.contains('data'))database.createObjectStore('data');};
  let blocked=false;
  req.onerror=()=>reject(req.error||Error('Storage unavailable'));
  req.onsuccess=()=>{
   const database=req.result;
   if(blocked){database.close();return;}
   database.onversionchange=()=>{database.close();dbPromise=null;};
   database.onclose=()=>{dbPromise=null;};
   resolve(database);
  };
  req.onblocked=()=>{blocked=true;reject(Error('Local storage is blocked by another tab'));};
 }).catch(error=>{
  // A temporary open failure must not permanently poison future saves.
  dbPromise=null;throw error;
 });
 return dbPromise;
}
async function storeGet(key){
 const database=await db();return new Promise((resolve,reject)=>{
  const tx=database.transaction('data'),store=tx.objectStore('data'),req=store.get(key);let value,invalid=false;
  req.onsuccess=()=>{
   value=req.result;
   // IndexedDB returns undefined for both an absent key and a stored undefined.
   // Treat the latter as unreadable instead of permitting a fresh autosave.
   if(value===undefined){const exists=store.count(key);exists.onsuccess=()=>{invalid=exists.result!==0;};}
  };
  tx.oncomplete=()=>invalid?reject(Error(`Stored record ${key} is undefined`)):resolve(value);
  tx.onerror=tx.onabort=()=>reject(tx.error||Error(`Could not read ${key}`));
 });
}
async function commitStorageChanges(changes){
 const database=await db();return new Promise((resolve,reject)=>{
  const tx=database.transaction('data','readwrite'),store=tx.objectStore('data');
  tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||Error('Local storage transaction failed'));
  try{for(const change of changes){if(change.delete)store.delete(change.key);else store.put(change.value,change.key);}}
  catch(error){try{tx.abort();}catch{}reject(error);}
 });
}
const autosave=createAutosave({getWorld:()=>workspace,commit:commitStorageChanges,onStatus(status,error){
 if(!startupReady)return;
 showBusy(generating);
 if(status==='saved')storageWarned=false;
 if(status==='error'&&!storageWarned){storageWarned=true;notice(`Automatic saving unavailable: ${error?.message||error}. Export your world as a backup.`,true);}
}});
function persist(kind='world',delay=260){if(startupReady)autosave.mark(kind,delay);}
function flushPersist(){return startupReady?autosave.flush():Promise.resolve(false);}
function rememberViewport(){
 if(!canvas?.clientWidth||!canvas.clientHeight)return;
 const next={scale:view.scale,centerX:(canvas.clientWidth/2-view.x)/view.scale,centerY:(canvas.clientHeight/2-view.y)/view.scale};
 const previous=workspace.viewport;
 if(previous&&previous.scale===next.scale&&previous.centerX===next.centerX&&previous.centerY===next.centerY)return;
 workspace.viewport=next;persist('preferences',650);
}
function minimumZoom(){const g=mapDimensions();return Math.min(.07,Math.min((canvas?.clientWidth||375)/g.width,(canvas?.clientHeight||600)/g.height)*.2);}
function restoreViewport(){
 if(!workspace.viewport||!canvas)return fitMap();
 const v=workspace.viewport;view.scale=clamp(v.scale,minimumZoom(),8);
 view.x=canvas.clientWidth/2-v.centerX*view.scale;
 view.y=canvas.clientHeight/2-v.centerY*view.scale;
 firstFit=false;schedulePaint();
}
function notice(message,error=false){let el=root.querySelector('#wg-toast');if(!el)return;el.textContent=message;el.classList.toggle('error',error);el.classList.add('visible');clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.classList.remove('visible'),4000);}
function stageText(stage){return STAGES[stage]?.[0]||'Unknown stage';}
function currentStage(){return workspace.working.stage;}
function stageRecord(stage){return workspace.locked[stage-1]||(stage===currentStage()?workspace.working:null);}
function latestData(stage){return stageRecord(stage)?.data||null;}
function viewStage(){return workspace.viewStage||1;}
function effectiveStage(){const chosen=viewStage();return latestData(chosen)?chosen:Math.min(currentStage()-1,IMPLEMENTED);}
function activeSettings(){return workspace.working.settings;}
function showBusy(busy){
 generating=busy;
 const el=root.querySelector('#wg-status'),status=autosave.status;
 const label=status==='error'?'Save failed · Export backup':busy?`Generating${progressPercent?' '+progressPercent+'%':'…'}`:status==='saving'?'Saving…':status==='pending'?'Save pending':dirty?'Preview pending':'Cached locally';
 if(el)el.innerHTML=`<span class="${label==='Cached locally'?'wg-saved-dot':'wg-busy-dot'}"></span> ${label}`;
 for(const lock of root.querySelectorAll('[data-action="lock-or-unlock"]')){
  if(viewStage()===currentStage())lock.disabled=busy||dirty||!workspace.working.data;
 }
}

// The generation drawer and map share one resizable boundary. Store a ratio
// instead of device pixels so rotation and viewport changes remain usable.
function consoleBounds(){
 const viewport=root.clientHeight||innerHeight||700;
 const header=root.querySelector('.wg-header')?.getBoundingClientRect().height||70;
 const minimum=Math.min(210,Math.max(145,(viewport-header)*.26));
 const maximum=Math.max(minimum,viewport-header-210);
 return {viewport,header,minimum,maximum};
}
function applyConsoleHeight(){
 const shell=root.querySelector('#worldgen-root');if(!shell)return;
 const {viewport,header,minimum,maximum}=consoleBounds();
 const ratio=Number.isFinite(workspace.consoleHeightRatio)?workspace.consoleHeightRatio:.36;
 const height=clamp(viewport*ratio,minimum,maximum);
 shell.style.setProperty('--wg-console-height',`${Math.round(height)}px`);
 const mapHeight=(workspace.exploreMode?viewport-header:viewport-header-height);
 // Keep the five navigation buttons on the right when their 244px rail fits.
 shell.classList.toggle('wg-map-short',mapHeight<260);
 shell.classList.toggle('wg-map-compact',mapHeight<290);
}
function bindDrawerDrag(){
 const handle=root.querySelector('.wg-console-handle');
 handle.addEventListener('pointerdown',event=>{
  if(event.button!==0&&event.pointerType==='mouse')return;
  const height=root.querySelector('.wg-console').getBoundingClientRect().height;
  drawerDrag={id:event.pointerId,startY:event.clientY,startHeight:height,moved:false};
  handle.setPointerCapture(event.pointerId);
 });
 handle.addEventListener('pointermove',event=>{
  if(!drawerDrag||drawerDrag.id!==event.pointerId)return;
  const delta=drawerDrag.startY-event.clientY;
  if(Math.abs(delta)>5)drawerDrag.moved=true;
  if(!drawerDrag.moved)return;
  const {viewport,minimum,maximum}=consoleBounds();
  const rawHeight=drawerDrag.startHeight+delta;
  drawerDrag.closeOnRelease=rawHeight<minimum*.72;
  handle.classList.toggle('wg-dismiss-ready',drawerDrag.closeOnRelease);
  const height=clamp(rawHeight,minimum,maximum);
  const center=screenToWorld(canvas.clientWidth/2,canvas.clientHeight/2);
  workspace.consoleHeightRatio=height/viewport;
  applyConsoleHeight();
  view.x=canvas.clientWidth/2-center.x*view.scale;
  view.y=canvas.clientHeight/2-center.y*view.scale;
  resizeCanvas();
 });
 const finish=event=>{
  if(!drawerDrag||drawerDrag.id!==event.pointerId)return;
  const moved=drawerDrag.moved,close=drawerDrag.closeOnRelease;drawerDrag=null;
  handle.classList.remove('wg-dismiss-ready');
  if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
  if(moved){
   suppressHandleClick=true;setTimeout(()=>{suppressHandleClick=false;},0);
   if(close){workspace.exploreMode=true;applyConsoleHeight();resizeCanvas();rebuildUI();}
   persist('preferences');rememberViewport();
  }
 };
 handle.addEventListener('pointerup',finish);
 handle.addEventListener('pointercancel',finish);
 handle.addEventListener('lostpointercapture',finish);
}

function buildShell(){
 root.innerHTML=`<div id="worldgen-root" class="wg-shell">
   <header class="wg-header">
    <div class="wg-headline"><div class="wg-eyebrow">WORLDGEN <span>v${APP_VERSION}</span></div><button class="wg-world-name" data-action="rename" title="Rename world">${escapeHTML(workspace.name)} <span>⌄</span></button></div>
    <button class="wg-icon-button" data-action="save" aria-label="Save checkpoint" title="Save checkpoint">▣</button>
    <button class="wg-icon-button" data-action="render" aria-label="Explore terrain in 3D" title="Explore terrain in 3D">◫</button>
    <button class="wg-icon-button" data-action="library" aria-label="Open world library" title="World library">☰</button>
    <button class="wg-icon-button wg-home" data-action="${hasLauncherHost()?'home':'update'}" aria-label="${hasLauncherHost()?'Return to My Apps':'Check updates and reload WorldGen'}" title="${hasLauncherHost()?'My Apps':'Refresh WorldGen'}">${headerIcon[hasLauncherHost()?'home':'refresh']}</button>
   </header>
   <main class="wg-map-area">
    <canvas id="wg-map" aria-label="Interactive world map: drag to pan, pinch or scroll to zoom, tap a polygon to inspect" role="img"></canvas>
    <div class="wg-map-buttons"><button data-action="fit" aria-label="Fit world to view" title="Fit entire world">⤢</button><button data-action="zoom-in" aria-label="Zoom in">+</button><button data-action="zoom-out" aria-label="Zoom out">−</button><button data-action="locate-cell" aria-label="Go to cell number" title="Go to cell number">⌖</button><button data-action="measure" aria-label="Measure distance" aria-pressed="false" title="Measure two-point distance">↔</button></div>
    <div class="wg-display-bar"><label for="wg-palette" class="wg-screen-reader-only">Map display</label><select id="wg-palette" aria-label="Map display mode"></select><button class="wg-overlay-trigger" data-action="toggle-overlays" aria-expanded="false">Overlays</button></div>
    <div class="wg-overlays" id="wg-overlays" hidden><label data-overlay-stage="2"><input id="wg-edges" type="checkbox"> Voronoi mesh</label><label data-overlay-stage="3"><input id="wg-plate-borders" type="checkbox"> Plate boundaries</label><label data-overlay-stage="5"><input id="wg-coast-borders" type="checkbox"> Shoreline</label><label data-overlay-stage="8"><input id="wg-flow" type="checkbox"> Drainage / rivers</label></div>
    <div class="wg-map-scale" id="wg-map-scale">World width: 2,048 km</div>
    <div class="wg-measure-readout" id="wg-measure-readout" aria-live="polite" hidden></div>
    <div class="wg-map-bottom-tools" aria-label="Map layer controls"><label for="wg-map-layer-select" class="wg-screen-reader-only">Layer</label><select id="wg-map-layer-select" aria-label="Select generation layer"></select><button class="wg-layer-toggle" data-action="lock-or-unlock" aria-label="Lock current generation layer">Lock</button><button class="wg-explore-toggle" data-action="toggle-explore" aria-label="Open generation settings">Settings</button></div>
    <div class="wg-inspector" id="wg-inspector" hidden></div>
   </main>
   <section class="wg-console" aria-label="World generation stages">
    <button class="wg-console-handle" data-action="toggle-explore" aria-label="Drag to resize settings, or tap to expand map" title="Drag up or down to resize settings"><span></span></button>
    <div class="wg-progress-row"><div class="wg-stage-heading"><span class="wg-section-caption">GENERATION PIPELINE</span><span id="wg-status" role="status"><span class="wg-busy-dot"></span> Loading…</span></div><div class="wg-stage-scroll" id="wg-stage-scroll"></div></div>
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
 let html=`<div class="wg-stage-title"><div><span class="wg-layer-label">LAYER ${String(stage).padStart(2,'0')} ${editable?'· WORKING':stage<=workspace.locked.length?'· LOCKED':'· NOT AVAILABLE'}</span><h2>${escapeHTML(stageText(stage))}</h2><p>${escapeHTML(STAGES[stage]?.[1]||'')}</p></div><button class="wg-panel-lock wg-layer-toggle" data-action="lock-or-unlock" aria-label="Lock or unlock this layer" ${!available||(!editable&&stage>workspace.locked.length)?'hidden':''}>Lock</button></div>`;
 if(!available){html+='<p class="wg-hint">This generation layer is planned for a future release.</p>';}
 else if(editable){
  const presets=stagePresets(stage,geometryData()),selectedPreset=matchingPreset(stage,settings,geometryData());
  html+=`<div class="wg-preset-picker"><label for="wg-preset">Starting preset</label><select id="wg-preset" aria-label="Choose preset for ${escapeHTML(stageText(stage))}"><option value="" ${!selectedPreset?'selected':''}>Custom settings</option>${presets.map(p=>`<option value="${p.id}" ${selectedPreset?.id===p.id?'selected':''}>${escapeHTML(p.label)}</option>`).join('')}</select><p id="wg-preset-description" class="wg-preset-description">${escapeHTML(selectedPreset?.description||'Your current manually adjusted settings. Choose a preset to replace the layer parameters without changing its random seed.')}</p></div>`;
  if(stage>=7){html+=`<p class="wg-preset-view"><strong>Preview changes in:</strong> ${escapeHTML(PRESET_PREVIEWS[stage])}</p><details class="wg-fine-tune" data-fine-tune-stage="${stage}" ${expandedFineTuneStages.has(stage)?'open':''}><summary>Fine-tune parameters (${OPTIONS[stage].length}${stageUsesSeed(stage)?' + seed':''})</summary>`;}
  html+=`<div class="wg-controls">${OPTIONS[stage].filter(option=>(stage!==2||option[0]!=='jitter'||settings.distribution==='jittered')&&(stage!==1||((settings.shape==='rectangle'&&!['radius','radiusX','radiusY'].includes(option[0]))||(settings.shape==='circle'&&!['width','height','radiusX','radiusY'].includes(option[0]))||(settings.shape==='ellipse'&&!['width','height','radius'].includes(option[0]))))).map(settingRow).join('')}${!stageUsesSeed(stage)?'':`<div class="wg-seed-row"><label for="wg-seed">Random seed</label><button type="button" class="wg-info" data-info="seed" aria-label="About random seed">i</button><div class="wg-seed-input"><input id="wg-seed" type="number" inputmode="numeric" value="${settings.seed}" min="0" max="4294967295"><button type="button" data-action="reroll" aria-label="Reroll random seed" title="Reroll random seed">↻</button></div></div>`}</div>`;
  if(stage>=7)html+='</details>';
  if(stage===1||stage===2||stage===5||stage===6)html+='<div id="wg-constraints" hidden></div>';
  if(stage===4)html+='<p class="wg-hint">Elevation is entirely independent of ocean and continental ratios. White represents zero altitude, red positive altitude, and blue negative altitude.</p>';
  if(stage===5)html+='<p class="wg-hint">Ocean flooding uses an exact zero-level threshold after the elevation offset. No target land percentage is imposed.</p>';
  if(stage===6)html+='<p class="wg-hint">Coastal adjustments can change the Layer 5 flood boundary locally. No preset percentage of land or water is enforced.</p>';
  if(stage===8)html+='<p class="wg-hint">Approximate Voronoi-scale erosion. Its runoff input is preliminary; climate is calculated later and does not retroactively alter locked erosion or coastlines.</p>';
  if(stage===9)html+='<p class="wg-hint">Planar climate approximation using notional latitude, winds, elevation and ocean proximity. January/July are opposite seasons; this layer does not change existing terrain.</p>';
  if(stage===10)html+='<p class="wg-hint">Climate-aware runoff follows depression-resolved drainage paths to the ocean. Lakes require natural topographic basins. The resulting channels are Voronoi-scale approximations, not sub-cell rivers. Earlier layers remain locked.</p>';
  if(stage===12)html+='<p class="wg-hint">Biomes represent potential natural environments inferred from temperature, precipitation, topography, hydrology and soil. Tree cover and ecological productivity are suitability estimates, not an evolving vegetation or animal simulation. Climate and terrain stay locked.</p>';
  if(stage===13)html+='<p class="wg-hint">This is a deterministic, static vegetation and habitat snapshot. Canopy, ground cover, and biomass are modelled indices, not actual plant counts or a time-stepped ecosystem. Locked biomes, soils and rivers are preserved.</p>';
  html+=`<div class="wg-actions"><button class="wg-secondary" data-action="reset-settings" title="Restore the default parameters for this layer">Reset settings</button><button class="wg-secondary" data-action="regenerate">Regenerate</button></div>`;
 }else if(row){
  html+=`<p class="wg-summary">${describeStage(stage,row.data)} This layer is preserved as part of your world history. Use Unlock layer to edit it.</p>${[1,2,5,6].includes(stage)?'<div id="wg-constraints" hidden></div>':''}<div class="wg-actions"><button class="wg-secondary" data-action="save">Save checkpoint</button></div>`;
 }else{html+='<p class="wg-hint">Generate and lock the preceding layer to continue.</p>';}
 root.querySelector('#wg-stage-main').innerHTML=html;
 updateConstraintReport();
 const renderButton=root.querySelector('[data-action="render"]');
 if(renderButton){renderButton.disabled=effectiveStage()<ELEVATION_RENDER_STAGE;renderButton.title='Open selected layer in 3D (layer 4+)';}
 const shown=effectiveStage(),palette=root.querySelector('#wg-palette');
 // Build the actual available options. Disabled options remain visible in the
 // native iOS picker, making early generation layers needlessly confusing.
 const availablePalettes=shown>2?Object.entries(palettes).filter(([id])=>paletteStages[id]<=shown):[];
 palette.innerHTML=availablePalettes.map(([id,name])=>`<option value="${id}">${escapeHTML(name)}</option>`).join('');
 if(availablePalettes.length)palette.value=workspace.viewMode!=='auto'&&paletteStages[workspace.viewMode]<=shown?workspace.viewMode:'natural';
 palette.hidden=shown<=2;
 const displayBar=root.querySelector('.wg-display-bar'),overlayTrigger=root.querySelector('[data-action="toggle-overlays"]'),overlays=root.querySelector('#wg-overlays');
 displayBar.hidden=shown<2;
 root.querySelectorAll('[data-overlay-stage]').forEach(label=>{label.hidden=Number(label.dataset.overlayStage)>shown;});
 if(shown<2){overlays.hidden=true;overlayTrigger.setAttribute('aria-expanded','false');}
 root.querySelector('#wg-edges').checked=workspace.showEdges;
 root.querySelector('#wg-plate-borders').checked=!!workspace.showPlateBorders;
 root.querySelector('#wg-coast-borders').checked=!!workspace.showCoastBorders;
 root.querySelector('#wg-flow').checked=!!workspace.showFlow;
 root.querySelector('#worldgen-root').classList.toggle('wg-explore',!!workspace.exploreMode);
 const isLocked=stage<=workspace.locked.length;
 for(const layerToggle of root.querySelectorAll('[data-action="lock-or-unlock"]')){
  layerToggle.hidden=!available||(!editable&&!isLocked);
  const inPanel=layerToggle.classList.contains('wg-panel-lock');
  layerToggle.textContent=inPanel?(isLocked?'Unlock layer':'Lock layer →'):(isLocked?'Unlock':'Lock');
  layerToggle.setAttribute('aria-label',isLocked?`Unlock layer ${stage}`:`Lock layer ${stage}`);
  layerToggle.disabled=unlocking||(editable&&(generating||dirty||!workspace.working.data));
  layerToggle.classList.toggle('wg-unlock',isLocked);
 }
 const stageSelect=root.querySelector('#wg-map-layer-select');
 stageSelect.innerHTML=Array.from({length:Math.min(currentStage(),IMPLEMENTED)},(_,i)=>i+1).filter(n=>latestData(n)||n===currentStage()).map(n=>`<option value="${n}">${String(n).padStart(2,'0')} · ${escapeHTML(stageText(n))}</option>`).join('');
 stageSelect.value=String(stage);
 applyConsoleHeight();
 updateMeasurement();showBusy(generating);updateInspector();schedulePaint();
}
function updateConstraintReport(){
 const el=root.querySelector('#wg-constraints');if(!el)return;
 const stage=viewStage(),record=stageRecord(stage),editable=stage===currentStage();
 const pending=editable&&(dirty||!record?.data);
 let report=null;
 try{
  if(stage===1)report=geometryConstraintReport(editable?generateGeometry(activeSettings()):record?.data);
  else if(stage===2&&!pending)report=meshConstraintReport(record?.data);
  else if((stage===5||stage===6)&&!pending){const coast=record?.data; if(coast?.water){const fraction=coast.landAreaFraction??landAreaFraction(latestData(2),coast.water);report={warning:fraction===0||fraction===1,messages:[`Land area: ${+(fraction*100).toFixed(2)}%. Ocean and land are determined solely by altitude at or below zero${stage===6?' after coastline reshaping':''}.`]};}}
 }catch{report={warning:true,messages:['Geographic feasibility could not be calculated for this world.']};}
 el.hidden=!report;
 el.className=report?.warning?'wg-constraint-report wg-constraint-warning':'wg-constraint-report';
 el.innerHTML=report?report.messages.map(message=>`<p>${escapeHTML(message)}</p>`).join(''):'';
}
function applyParameter(key,raw,rebuild=false){
 if(currentStage()>IMPLEMENTED)return;
 const options=OPTIONS[currentStage()]||[],row=options.find(o=>o[0]===key);if(!row)return;
 let value;
 if(row[2]==='select')value=raw;
 else{
  const [min,max]=controlBounds(currentStage(),key);
  if(raw===''||raw===null||raw===undefined||!Number.isFinite(Number(raw))){notice('Enter a valid number',true);rebuildUI();return;}
  value=clamp(Number(raw),min,max);
  if(['plates','iterations','relaxation','minLakeCells'].includes(key))value=Math.round(value);
  value=formatNumber(value);
 }
 if(workspace.working.settings[key]===value)return;
 workspace.working.settings[key]=value;
 updatePresetSelection();
 dirty=true;void persist();showBusy(generating);
 if(currentStage()===1){
  // Shape/dimensions can invalidate the viewport and every dependent map.
  if(rebuild){rebuildUI();fitMap();}else syncControl(key);
 }else if(rebuild)rebuildUI();else syncControl(key);
 updateConstraintReport();
 scheduleGeneration(row[2]==='select'?50:row[2]==='area'?650:380);
}
function updatePresetSelection(){
 const select=root.querySelector('#wg-preset'),description=root.querySelector('#wg-preset-description');
 if(!select||!description)return;
 const current=matchingPreset(currentStage(),activeSettings(),geometryData());
 select.value=current?.id||'';
 description.textContent=current?.description||'Your current manually adjusted settings. Choose a preset to replace the layer parameters without changing its random seed.';
}
function syncControl(key){
 const value=workspace.working.settings[key],row=OPTIONS[currentStage()]?.find(r=>r[0]===key);
 if(!row||row[2]==='select')return;
 const [min,max]=controlBounds(currentStage(),key),slider=root.querySelector(`[data-slider="${key}"]`),number=root.querySelector(`[data-number="${key}"]`);
 if(slider)slider.value=String(row[2]==='area'?areaToSlider(value,min,max):formatNumber(displayParameter(key,value)));
 if(number&&document.activeElement!==number)number.value=String(formatNumber(displayParameter(key,value)));
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
 const mode=current?.[2]==='area'||current?.[6]==='percent'?'Percentage adjustment: ±5% of the current value.':current?.[2]==='range'?`Linear adjustment: ±${formatNumber(displayParameter(key,current[5]))} each tap.`:'';
 root.querySelector('#wg-modal-host').innerHTML=`<div class="wg-modal-backdrop"><section class="wg-modal wg-help-dialog" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}"><div class="wg-modal-heading"><h2>${escapeHTML(title)}</h2><button class="wg-icon-button" data-action="close-modal" aria-label="Close information">×</button></div><p>${escapeHTML(description)}</p><p class="wg-modal-caption">${escapeHTML(mode)}</p></section></div>`;
 activeModal=true;
}
function settingRow([key,label,type,a,b,step,mode]){
 const stage=currentStage(),value=activeSettings()[key],info=`<button type="button" class="wg-info" data-info="${key}" aria-label="About ${escapeHTML(label)}" title="Explain this parameter">i</button>`;
 if(type==='select')return `<div class="wg-form-field wg-choice-field"><div class="wg-field-title"><span>${escapeHTML(label)}</span>${info}</div><select data-setting="${key}" aria-label="${escapeHTML(label)}">${a.map(([v,n])=>`<option value="${v}" ${v===value?'selected':''}>${n}</option>`).join('')}</select></div>`;
 const [min,max]=controlBounds(stage,key),area=type==='area';
 const sliderValue=area?areaToSlider(value,min,max):formatNumber(displayParameter(key,value));
 const rawValue=formatNumber(displayParameter(key,value));
 const displayMin=displayParameter(key,min),displayMax=displayParameter(key,max),displayStep=displayParameter(key,step);
 return `<div class="wg-form-field" data-param="${key}"><div class="wg-field-title"><span>${escapeHTML(label)}</span>${info}</div>
  <input data-slider="${key}" type="range" min="${area?0:displayMin}" max="${area?1000:displayMax}" step="${area?1:displayStep}" value="${sliderValue}" aria-label="${escapeHTML(label)} slider" />
  <div class="wg-value-controls"><button type="button" data-adjust="${key}" data-direction="-1" aria-label="Decrease ${escapeHTML(label)}">−</button>
  <input data-number="${key}" type="number" inputmode="decimal" min="${displayMin}" max="${displayMax}" step="any" value="${rawValue}" aria-label="${escapeHTML(label)} value" />
  <button type="button" data-adjust="${key}" data-direction="1" aria-label="Increase ${escapeHTML(label)}">+</button></div>
  ${area?`<small data-cell-estimate>≈ ${shortNumber(meshTargetCount(geometryData(),value))} polygons · 100–${shortNumber(MAX_CELLS)} supported</small>`:`<small class="wg-increment-mode">${mode==='percent'?'±5% per tap':`±${displayStep} per tap`}</small>`}
 </div>`;
}
function describeStage(stage,data){if(!data)return 'No preview generated yet.';switch(stage){
 case 1:return `${data.shape==='rectangle'?'Rectangular':data.shape==='circle'?'Circular':'Elliptical'} world · ${shortNumber(data.width)} × ${shortNumber(data.height)} km · ${shortNumber(Math.round(data.areaKm2))} km² · no depth.`;
 case 2:return `${shortNumber(data.cells.length)} Voronoi cells across ${shortNumber(Math.round(data.areaKm2))} km².`;
 case 3:return `${data.plates.length} fixed tectonic territories and boundaries; crust and motion are defined in layer 4.`;
 case 4:return `${data.elevations.length} elevation samples with plate-boundary uplift · provisional height range ${shortNumber(Math.round(elevationToMetres(Math.min(...data.elevations))))} to ${shortNumber(Math.round(elevationToMetres(Math.max(...data.elevations))))} m.`;
 case 5:return `${+((data.landAreaFraction??data.landFraction)*100).toFixed(2)}% land area after the offset · ${shortNumber(data.water.filter(Boolean).length)} cells flooded at or below zero.`;
 case 6:{const area=data.landAreaFraction??landAreaFraction(latestData(2),data.water);return `${+((area??data.landFraction)*100).toFixed(2)}% land area after coastal adjustment · ${data.edgeWaterCells||0} boundary water cells.`;}
 case 7:return `${shortNumber(data.classes.length)} terrain samples · ${data.volcanoes.length} volcanic cells · ${data.counts[6]} mountain cells.`;
 case 8:return `${shortNumber(data.elevations.length)} eroded cells · ${data.channels.length} drainage-channel cells · maximum runoff ${data.summary.maxDischarge.toFixed(1)} · mean eroded depth ${elevationToMetres(data.summary.meanErosion).toFixed(1)} m${Number.isFinite(data.summary.exportedSediment)?` · exported sediment estimate ${sedimentToKm3(data.summary.exportedSediment).toFixed(1)} km³`:""}.`;
 case 9:return `${shortNumber(data.meanTemp.length)} climate cells · mean temperature ${data.summary.avgTemp.toFixed(1)} °C · mean precipitation ${Math.round(data.summary.avgRain)} mm/year.`;
 case 10:return `${shortNumber(data.channels.length)} river-channel cells · ${data.lakes.length} lakes · ${shortNumber(Math.round(data.summary.lakeAreaKm2))} km² lake area · ${data.summary.annualRunoffKm3.toFixed(1)} km³/year estimated runoff.`;
 case 11:return `${shortNumber(data.summary.landCells)} soil-bearing cells · mean regolith ${data.summary.meanDepthM.toFixed(2)} m · mean fertility ${Math.round(data.summary.meanFertility*100)}% · ${shortNumber(data.summary.highFertilityCells)} high-fertility cells.`;
 case 12:return `${data.counts.filter(Boolean).length} environmental classes · ${shortNumber(Math.round(data.summary.forestAreaKm2))} km² forest potential · ${shortNumber(Math.round(data.summary.drylandAreaKm2))} km² dryland · average thermal season ${data.summary.meanGrowingMonths.toFixed(1)} months.`;
 case 13:return `${data.counts.filter(Boolean).length} vegetation / habitat classes · ${shortNumber(Math.round(data.summary.forestAreaKm2))} km² closed forest · average canopy ${Math.round(data.summary.meanCanopy*100)}% · estimated mean vegetation height ${data.summary.meanHeightM.toFixed(1)} m.`;
 default:return '';
}}
function nextSeed(){return Math.floor(Math.random()*0xffffffff);}
function stopWorker(){if(worker){worker.terminate();worker=null;}if(cancelPending){const cancel=cancelPending;cancelPending=null;cancel();}}
function scheduleGeneration(ms=230){if(!startupReady)return;clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>void generateCurrent(),ms);}
async function generateCurrent(){
 if(!startupReady)return;
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
   job.onmessageerror=()=>{cancelPending=null;reject(Error('Generation worker response could not be decoded'));};
   job.postMessage({id,stage,settings,locked});
  });
  if(result.cancelled||id!==requestId||stage!==currentStage()||settingsStamp!==JSON.stringify(workspace.working.settings))return;
  if(!result.ok)throw Error(result.error);
  workspace.working.data=result.data;workspace.working.dataSettings=structuredClone(settings);dirty=false;
  if(workspace.viewStage===stage||!latestData(workspace.viewStage))workspace.viewStage=stage;
  selectedId=null;resetBorderCache();
  if(stage===1)requestAnimationFrame(fitMap);
  persist();const saved=await flushPersist();
  if(id!==requestId)return;
  showBusy(false);rebuildUI();if(saved)notice(`${stageText(stage)} generated`);
 }catch(error){if(id!==requestId)return;showBusy(false);rebuildUI();notice(`Generation failed: ${error.message}`,true);}
 finally{if(id===requestId)stopWorker();}
}
function defaultsForStage(stage){
 if(stage===2){const g=geometryData();return {...DEFAULTS[2],averageArea:formatNumber(g.areaKm2/1200)};}
 const settings={...(DEFAULTS[stage]||{})};

 return settings;
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
 requestId++;stopWorker();clearTimeout(rebuildTimer);generating=false;
 workspace.locked=workspace.locked.slice(0,stage-1);
 workspace.working={stage,settings:{...defaultsForStage(stage),...structuredClone(earlier.settings)},data:structuredClone(earlier.data),dataSettings:structuredClone(earlier.settings)};dirty=JSON.stringify(workspace.working.settings)!==JSON.stringify(workspace.working.dataSettings);
 workspace.viewStage=stage;selectedId=null;resetBorderCache();
 void persist();rebuildUI();notice(`Layer ${stage} is editable again`);
}
async function unlockLayer(stage){
 if(unlocking||!workspace.locked[stage-1])return;
 const targetWorld=workspace;
 unlocking=true;
 try{
  // Unlocking a historical layer branches the world. Preserve any later locked
  // layers as a named checkpoint automatically, without a confirmation dialog.
  if(stage<workspace.locked.length){
   const previous=structuredClone(workspace);
   const metadata={id:`save-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    name:`${workspace.name} — before unlocking layer ${stage}`.slice(0,100),
    created:new Date().toISOString(),stage:workspace.locked.length};
   snapshots=await commitCheckpoint(await db(),{kind:'save',metadata,world:previous});
  }
  if(workspace!==targetWorld)return;
  reviseStage(stage);
 }catch(error){notice(`Unlock cancelled: could not preserve later layers (${error.message})`,true);}
 finally{unlocking=false;const toggle=root.querySelector('[data-action="lock-or-unlock"]');if(toggle&&viewStage()<=workspace.locked.length)toggle.disabled=false;}
}
function rgb(r,g,b){return `rgb(${r|0},${g|0},${b|0})`;}
function gradient(value,stops){const t=clamp(value,0,1);for(let i=1;i<stops.length;i++)if(t<=stops[i][0]){const [at,a]=stops[i-1],[bt,b]=stops[i],v=(t-at)/(bt-at);return rgb(...a.map((x,k)=>x+(b[k]-x)*v));}return rgb(...stops[stops.length-1][1]);}
const heightColors=[[0,[24,54,83]],[.30,[43,104,130]],[.43,[138,157,153]],[.52,[110,145,116]],[.64,[172,168,124]],[.78,[137,115,95]],[1,[232,236,231]]];
const altitudeColors=[[0,[18,55,134]],[.22,[39,123,209]],[.42,[139,202,239]],[.5,[248,249,246]],[.57,[247,198,190]],[.75,[215,92,70]],[1,[128,26,37]]];
const landColors=[[0,[54,99,83]],[.38,[76,121,81]],[.57,[119,140,92]],[.72,[166,146,105]],[.88,[157,145,130]],[1,[234,235,223]]];
const landformColors=['#1d4965','#4c8295','#b5a986','#6e9d6d','#779273','#9a977a','#d3cdbb','#746a65','#839778'];
const soilColors=['#23566e','#777879','#9c9382','#cfb889','#85936b','#8f756c','#426852','#7b675c','#d9bf88','#b7b9ae'];
const biomeColors=['#214e68','#4295b5','#e5ecf2','#a0a99d','#477368','#307f69','#548c64','#adc18a','#b9ae77','#d4bc8b','#989d74','#247357','#388b61','#b2af60','#abb4a0','#477f77','#577765'];
const vegetationColors=['#214e68','#4295b5','#d3d3c5','#9aab8f','#a8bb77','#8d9e63','#5e9162','#347450','#206342','#4b9079','#459a71','#a8b997','#aeaa73'];
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
 geometryCache={mesh,paths,bounds,spatial:buildCellIndex(mesh,bounds)};return geometryCache;
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
const segmentPaths=new WeakMap();
function drawSegments(segments,color,width){
 let path=segmentPaths.get(segments);
 if(!path){path=new Path2D();for(const [x1,y1,x2,y2] of segments){path.moveTo(x1,y1);path.lineTo(x2,y2);}segmentPaths.set(segments,path);}
 ctx.strokeStyle=color;ctx.lineWidth=width/view.scale;ctx.stroke(path);
}

function colorForCell(i,stage,display){
 const mesh=latestData(2)||(currentStage()===2?workspace.working.data:null),plates=latestData(3),heights=latestData(4),oceans=latestData(5),coasts=(stage>=6?latestData(6):oceans),landforms=latestData(7),erosion=latestData(8),hydrology=stage>=10?latestData(10):null;
 const soils=stage>=11?latestData(11):null,biomes=stage>=12?latestData(12):null,vegetation=stage>=13?latestData(13):null;
 if(stage>=13&&vegetation&&['vegetation','habitats','canopyCover','groundCover','biomass','habitatComplexity','riparian','auto'].includes(display)){
  if(display==='habitats')return vegetationColors[vegetation.coverClass[i]];
  if(display==='vegetation'||display==='auto'){if(vegetation.coverClass[i]<2)return vegetationColors[vegetation.coverClass[i]];return gradient(.58*vegetation.canopyCover[i]+.42*vegetation.groundCover[i],[[0,[174,163,123]],[.25,[137,155,103]],[.55,[73,134,78]],[1,[27,96,60]]]);}
  if(vegetation.coverClass[i]<2)return vegetationColors[vegetation.coverClass[i]];
  if(display==='canopyCover')return gradient(vegetation.canopyCover[i],[[0,[199,182,136]],[.4,[137,159,102]],[.75,[61,126,75]],[1,[19,83,58]]]);
  if(display==='groundCover')return gradient(vegetation.groundCover[i],[[0,[178,162,115]],[.45,[151,171,109]],[1,[66,140,69]]]);
  if(display==='biomass')return gradient(vegetation.biomass[i],[[0,[185,173,126]],[.5,[123,153,88]],[1,[40,105,62]]]);
  if(display==='habitatComplexity')return gradient(vegetation.habitatComplexity[i],[[0,[161,148,117]],[.5,[144,165,122]],[1,[69,129,105]]]);
  if(display==='riparian')return gradient(vegetation.riparian[i],[[0,[133,124,104]],[.4,[107,156,137]],[1,[54,165,197]]]);
 }
 if(stage>=12&&biomes&&['biomes','productivity','treePotential','waterStress','growingSeason','ecotones','auto'].includes(display)){
  if(display==='biomes'||display==='auto')return biomeColors[biomes.biome[i]];
  if(biomes.biome[i]<2)return biomeColors[biomes.biome[i]];
  if(display==='productivity')return gradient(biomes.productivity[i],[[0,[150,126,90]],[.4,[166,172,104]],[.7,[98,154,91]],[1,[35,111,67]]]);
  if(display==='treePotential')return gradient(biomes.treePotential[i],[[0,[206,185,130]],[.35,[152,171,107]],[.75,[70,137,85]],[1,[23,89,64]]]);
  if(display==='waterStress')return gradient(biomes.waterStress[i],[[0,[69,144,128]],[.5,[196,175,108]],[1,[183,106,73]]]);
  if(display==='growingSeason')return gradient(biomes.growingMonths[i]/12,[[0,[91,117,157]],[.5,[152,168,127]],[1,[65,147,80]]]);
  if(display==='ecotones')return gradient(biomes.ecotone[i],[[0,[75,104,87]],[.5,[179,170,104]],[1,[223,130,75]]]);
 }

 const elev=(stage>=8?erosion?.elevations[i]:undefined)??(stage>=7?landforms?.elevations[i]:undefined)??(stage>=5?coasts?.elevations?.[i]:undefined)??heights?.elevations[i]??0;
 if(stage>=11&&soils&&['soils','soilDepth','soilFertility','soilPermeability','soilGroundwater','soilErosion','auto'].includes(display)){
  if(soils.soilType[i]===0)return coasts.water[i]?'#234e66':'#4186a7';
  if(display==='soils'||display==='auto')return soilColors[soils.soilType[i]]||soilColors[4];
  if(display==='soilDepth')return gradient(soils.depthM[i]/5,[[0,[117,117,115]],[.25,[170,152,110]],[.6,[138,123,77]],[1,[73,98,69]]]);
  if(display==='soilFertility')return gradient(soils.fertility[i],[[0,[188,126,81]],[.45,[192,191,122]],[.7,[113,154,102]],[1,[42,111,73]]]);
  if(display==='soilPermeability')return gradient(soils.permeability[i],[[0,[137,105,91]],[.5,[169,159,119]],[1,[86,157,175]]]);
  if(display==='soilGroundwater')return gradient(soils.groundwater[i],[[0,[181,154,109]],[.5,[117,164,152]],[1,[50,110,166]]]);
  if(display==='soilErosion')return gradient(soils.erosionRisk[i],[[0,[72,131,98]],[.5,[202,177,103]],[1,[183,76,64]]]);
 }
 if(stage>=10&&hydrology){
  if(display==='watersheds'){
   if(coasts.water[i])return '#214b63';
   const outlet=hydrology.outlet[i],h=(outlet*137.508+41)%360;
   return `hsl(${Math.round(h)},${31+(outlet%3)*5}%,${37+(outlet%5)*4}%)`;
  }
  if(display==='catchment'){
   if(coasts.water[i])return '#234e66';
   const avg=REFERENCE_AREA_KM2;
   return gradient(Math.log1p(hydrology.catchmentArea[i]/avg)/Math.log1p(100),[[0,[164,158,119]],[.32,[139,172,137]],[.64,[80,162,166]],[1,[35,90,150]]]);
  }
  if(display==='hydrology'||display==='auto'){
   if(coasts.water[i])return gradient(clamp(.32+(elev-coasts.seaLevel)*.7,0,1),[[0,[22,56,77]],[1,[53,113,143]]]);
   if(hydrology.lakeId[i]>=0)return '#4695b6';
   return gradient(clamp((elev-coasts.seaLevel)*1.6,0,1),landColors);
  }
 }
 if(display==='geometry'||stage===1){const h=((i*137.508)%360);return `hsl(${150+(h%55)},${18+(i%4)*2}%,${36+(i%7)*3}%)`;}
 if((display==='plates'||stage===3)&&plates){const owner=plates.owners[i],h=(owner*137.508+22)%360;return `hsl(${h},38%,42%)`;}
 if(stage>=9){
  const climate=latestData(9);
  if(climate){
   if(display==='temperature'||display==='january'||display==='july'){
    const t=display==='january'?climate.janTemp[i]:display==='july'?climate.julTemp[i]:climate.meanTemp[i];
    return gradient((t+35)/75,[[0,[49,79,139]],[.22,[101,154,193]],[.41,[213,234,219]],[.57,[213,210,132]],[.77,[211,130,72]],[1,[164,58,47]]]);
   }
   if(display==='rain')return gradient(Math.log1p(climate.precipitation[i])/Math.log1p(4800),[[0,[193,153,96]],[.3,[206,186,123]],[.55,[150,183,126]],[.78,[77,149,158]],[1,[37,80,143]]]);
   if(display==='moisture')return gradient(climate.moisture[i],[[0,[172,136,92]],[.35,[202,192,125]],[.6,[129,170,124]],[1,[44,105,87]]]);
   if(display==='seasonality')return gradient(climate.seasonalRange[i]/39,[[0,[65,129,152]],[.45,[171,189,153]],[.75,[224,174,104]],[1,[183,91,72]]]);
  }
 }
 if(display==='landforms'&&stage>=7&&landforms)return landformColors[landforms.classes[i]]||'#6e9d6d';
 if(display==='erosion'&&stage>=8&&erosion){const delta=elev-landforms.elevations[i];return delta<-.004?gradient(Math.min(1,-delta/.15),[[0,[105,111,105]],[1,[190,98,65]]]):delta>.004?gradient(Math.min(1,delta/.15),[[0,[105,111,105]],[1,[67,163,151]]]):'#78827b';}
 if(display==='flow'&&stage>=8&&erosion){if(coasts.water[i])return '#245773';const volume=erosion.discharge[i]/Math.max(1,erosion.summary.maxDischarge);return gradient(Math.pow(volume,.28),[[0,[104,115,100]],[.3,[115,145,132]],[1,[74,175,216]]]);}
 if((display==='height'||stage===4)&&heights)return gradient(clamp((heights.elevations[i]+1.8)/3.6,0,1),altitudeColors);
 if((display==='coast'||stage>=5)&&coasts&&heights){const sea=coasts.seaLevel;return coasts.water[i]?gradient(clamp(.36+(elev-sea)*.7,0,1),[[0,[24,54,74]],[1,[61,116,146]]]):gradient(clamp((elev-sea)*1.6,0,1),landColors);}
 return 'rgb(54,99,83)';
}
const defaultPalettes=['geometry','geometry','geometry','plates','height','coast','coast','landforms','coast','temperature','hydrology','soils','biomes','vegetation'];
const paletteStages={
 natural:0,geometry:1,plates:3,height:4,coast:5,landforms:7,erosion:8,flow:8,
 temperature:9,rain:9,moisture:9,seasonality:9,january:9,july:9,
 hydrology:10,catchment:10,watersheds:10,
 soils:11,soilDepth:11,soilFertility:11,soilPermeability:11,soilGroundwater:11,soilErosion:11,
 biomes:12,productivity:12,treePotential:12,waterStress:12,growingSeason:12,ecotones:12,
 vegetation:13,habitats:13,canopyCover:13,groundCover:13,biomass:13,habitatComplexity:13,riparian:13
};
function resolvedDisplayMode(stage){
 const requested=workspace.viewMode;
 if(requested!=='natural'&&paletteStages[requested]<=stage)return requested;
 return defaultPalettes[stage]||'geometry';
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
 const allowed=resolvedDisplayMode(stage);
 const stroke=workspace.showEdges,points=mesh.cells,geometry=prepareGeometry(mesh),record=stageRecord(stage)?.data;
 if(colorCache.mesh!==mesh||colorCache.record!==record||colorCache.stage!==stage||colorCache.mode!==allowed){
  colorCache={mesh,record,stage,mode:allowed,colors:points.map((_,i)=>colorForCell(i,stage,allowed))};
 }
 const bounds={x0:-view.x/view.scale,y0:-view.y/view.scale,x1:(width-view.x)/view.scale,y1:(height-view.y)/view.scale};
 if(stroke){ctx.strokeStyle='rgba(5,20,28,.31)';ctx.lineWidth=.55/view.scale;}
 // At full-world zoom a simple linear pass is cheaper; zoomed-in views
 // visit only intersecting cells through the spatial bucket index.
 const visible=(bounds.x1-bounds.x0)*(bounds.y1-bounds.y0)>mesh.width*mesh.height*.35
  ? null:cellsInBounds(geometry.spatial,bounds.x0,bounds.y0,bounds.x1,bounds.y1);
 for(const i of visible||points.keys()){
  if(!visible){const [x0,y0,x1,y1]=geometry.bounds[i];if(x1<bounds.x0||x0>bounds.x1||y1<bounds.y0||y0>bounds.y1)continue;}
  const path=geometry.paths[i];ctx.fillStyle=colorCache.colors[i];ctx.fill(path);
  if(stroke)ctx.stroke(path);
  else if(stage>=3){ctx.strokeStyle=colorCache.colors[i];ctx.lineWidth=1.35/view.scale;ctx.stroke(path);}
 }
  if(stage>=3&&workspace.showPlateBorders&&latestData(3)){
   const plates=latestData(3);
   if(borderCache.mesh!==mesh||borderCache.plates!==plates){borderCache.mesh=mesh;borderCache.plates=plates;borderCache.plateLines=borderSegments(mesh,plates.owners);}
   drawSegments(borderCache.plateLines,'rgba(254,204,124,.96)',2.3);
  }
  if(stage>=5&&workspace.showCoastBorders&&(stage>=6?latestData(6):latestData(5))){
   const coasts=stage>=6?latestData(6):latestData(5);
   if(borderCache.mesh!==mesh||borderCache.coasts!==coasts){borderCache.mesh=mesh;borderCache.coasts=coasts;borderCache.coastLines=borderSegments(mesh,coasts.water);}
   drawSegments(borderCache.coastLines,'rgba(229,244,239,.93)',2.2);
  }
  // Use the same cell graph as the erosion solver; these are approximate
  // center-to-center drainage paths, not finalized river geometry.
  if(stage>=8&&(allowed==='flow'||(stage<10&&workspace.showFlow))&&latestData(8)){
   const flow=latestData(8);ctx.strokeStyle='rgba(130,226,247,.9)';ctx.lineCap='round';ctx.lineWidth=2.0/view.scale;ctx.beginPath();
   for(const i of flow.channels){const j=flow.flowTo[i];if(j<0)continue;ctx.moveTo(points[i].x,points[i].y);ctx.lineTo(points[j].x,points[j].y);}
   ctx.stroke();
  }
  // Hydrography only exists in layer 9 and never leaks into older stages.
  if(stage>=10&&(allowed==='hydrology'||workspace.showFlow||allowed==='catchment'||allowed==='watersheds'||(stage>=11&&allowed==='soils'))&&latestData(10)){
   const hydro=latestData(10),maxVolume=Math.max(.001,hydro.summary.maxDischarge);
   ctx.lineCap='round';ctx.strokeStyle='rgba(95,213,237,.89)';
   for(const i of hydro.channels){
    const j=hydro.flowTo[i];if(j<0||hydro.lakeId[i]>=0&&hydro.lakeId[j]===hydro.lakeId[i])continue;
    const volume=Math.sqrt(clamp(hydro.discharge[i]/maxVolume,0,1));
    ctx.lineWidth=(1.4+2.9*volume)/view.scale;ctx.beginPath();
    ctx.moveTo(points[i].x,points[i].y);ctx.lineTo(points[j].x,points[j].y);ctx.stroke();
   }
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
 // Use the polygon index so taps remain fast on high-resolution worlds.
 // A global nearest-site fallback handles rare rounded-coordinate seams.
 const picked=cellAtPoint(prepareGeometry(mesh).spatial,p.x,p.y);
 if(picked!==null)return picked;
 let closest=null,d2=Infinity;for(let i=0;i<mesh.cells.length;i++){const c=mesh.cells[i],score=(p.x-c.x)**2+(p.y-c.y)**2;if(score<d2){d2=score;closest=i;}}
 return closest;
}
function updateInspector(){const panel=root.querySelector('#wg-inspector');if(!panel)return;
 if(selectedId===null){panel.hidden=true;return;}
 const c=(latestData(2)||(currentStage()===2?workspace.working.data:null))?.cells?.[selectedId];if(!c){panel.hidden=true;return;}
 const stage=effectiveStage(),plate=latestData(3),elevation=latestData(4),sea=(stage>=6?latestData(6):latestData(5)),details=[`Position ${Math.round(c.x)}, ${Math.round(c.y)}`,`${c.neighbors.length} neighboring cells`];
 if(stage>=3&&plate){const p=plate.plates[plate.owners[selectedId]];details.push(`Plate ${p.id+1}`);}
 if(stage>=4&&elevation){
  const height=(stage>=8?latestData(8)?.elevations[selectedId]:undefined)??(stage>=7?latestData(7)?.elevations[selectedId]:undefined)??(stage>=5?sea?.elevations?.[selectedId]:undefined)??elevation.elevations[selectedId];
  const datum=stage>=6&&sea?sea.seaLevel:0;
  details.push(`Elevation: ${elevationToMetres(height,datum).toFixed(1)} m (${stage>=6&&sea?'relative to sea level':'provisional zero datum'})`);
 }
 if(stage>=5&&sea)details.push(sea.water[selectedId]?'Ocean cell':'Land cell');
 if(stage>=7&&latestData(7)){const l=latestData(7);details.push(`Landform: ${LANDFORM_NAMES[l.classes[selectedId]]}`);details.push(`Ruggedness: ${Math.round(l.ruggedness[selectedId]*100)}%`);}
 if(stage>=8&&latestData(8)){const e=latestData(8);details.push(`Eroded depth: ${elevationToMetres(e.erosionDepth[selectedId]).toFixed(1)} m`);details.push(`Deposited depth: ${elevationToMetres(e.deposition[selectedId]).toFixed(1)} m`);details.push(`Estimated runoff: ${e.discharge[selectedId].toFixed(2)}`);if(e.flowTo[selectedId]>=0)details.push(`Downhill neighbor: cell ${e.flowTo[selectedId]+1}`);}
 if(stage>=9&&latestData(9)){const c=latestData(9);details.push(`Latitude: ${c.latitudes[selectedId].toFixed(1)}°`);details.push(`Mean temperature: ${c.meanTemp[selectedId].toFixed(1)} °C`);details.push(`January / July: ${c.janTemp[selectedId].toFixed(1)} / ${c.julTemp[selectedId].toFixed(1)} °C`);details.push(`Precipitation: ${Math.round(c.precipitation[selectedId])} mm/year`);details.push(`Moisture index: ${Math.round(c.moisture[selectedId]*100)}%`);}
 details.push(`Cell area: ${shortNumber(Math.round(cellArea(c)))} km²`);
 if(stage>=10&&latestData(10)){
  const h=latestData(10);details.push(`Upstream catchment: ${Math.round(h.catchmentArea[selectedId]).toLocaleString()} km²`);
  details.push(`Estimated flow: ${h.discharge[selectedId].toFixed(3)} km³/year`);
  if(h.lakeId[selectedId]>=0){const lake=h.lakes[h.lakeId[selectedId]];details.push(`Lake ${lake.id+1}: ${Math.round(lake.areaKm2)} km², depth ${elevationToMetres(h.lakeDepth[selectedId]).toFixed(1)} m · surface ${elevationToMetres(lake.level,sea.seaLevel).toFixed(1)} m above sea level`);}
  if(h.flowTo[selectedId]>=0)details.push(`Drainage toward: cell ${h.flowTo[selectedId]+1}`);
 }
 if(stage>=11&&latestData(11)){
  const soil=latestData(11),kind=soil.soilType[selectedId];details.push(`Soil: ${SOIL_NAMES[kind]}`);
  if(kind!==0){details.push(`Soil depth: ${soil.depthM[selectedId].toFixed(2)} m`);details.push(`Organic matter: ${Math.round(soil.organicMatter[selectedId]*100)}% potential`);
   details.push(`Fertility: ${Math.round(soil.fertility[selectedId]*100)}% · Permeability: ${Math.round(soil.permeability[selectedId]*100)}%`);
   details.push(`Groundwater: ${Math.round(soil.groundwater[selectedId]*100)}% · Erosion risk: ${Math.round(soil.erosionRisk[selectedId]*100)}%`);}
 }
 if(stage>=12&&latestData(12)){
  const biome=latestData(12),k=biome.biome[selectedId];details.push(`Biome: ${BIOME_NAMES[k]}`);
  if(k>=2){details.push(`Tree-cover potential: ${Math.round(biome.treePotential[selectedId]*100)}%`);details.push(`Ecological productivity potential: ${Math.round(biome.productivity[selectedId]*100)}%`);
   details.push(`Warm months (>5 °C): ${biome.growingMonths[selectedId]} · drought stress ${Math.round(biome.waterStress[selectedId]*100)}%`);details.push(`Biome transition score: ${Math.round(biome.ecotone[selectedId]*100)}%`);}
 }
 if(stage>=13&&latestData(13)){
  const v=latestData(13),i=selectedId;
  details.push(`Vegetation: ${VEGETATION_NAMES[v.coverClass[i]]}`);
  if(v.coverClass[i]>=2){
   details.push(`Canopy / ground cover: ${Math.round(v.canopyCover[i]*100)}% / ${Math.round(v.groundCover[i]*100)}%`);
   details.push(`Relative biomass: ${Math.round(v.biomass[i]*100)}% · estimated height ${v.heightM[i].toFixed(1)} m`);
   details.push(`Habitat complexity: ${Math.round(v.habitatComplexity[i]*100)}% · riparian influence ${Math.round(v.riparian[i]*100)}%`);
  }
 }
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
function pointerEnd(event){if(!movePointers.has(event.pointerId))return;const position=canvasPoint(event);movePointers.delete(event.pointerId);if(!movePointers.size){if(event.type!=='pointercancel'&&event.type!=='lostpointercapture'&&!panMoved&&gesture?.kind==='pan'){if(measureMode)measureAt(position.x,position.y);else{selectedId=pickCell(position.x,position.y);updateInspector();schedulePaint();}}gesture=null;}else{gesture={kind:'pan',origin:[...movePointers.values()][0]};panMoved=true;}}
function downloadText(text,name){return shareText(text,name);}
function screenshot(){canvas.toBlob(async blob=>{if(!blob){notice('Unable to capture map',true);return;}try{await shareBlob(blob,`${workspace.name.replace(/[^a-z0-9_-]+/gi,'-').toLowerCase()||'world'}-layer${effectiveStage()}-map.png`);notice('Current map view shared');}catch(e){if(e.name!=='AbortError')notice(e.message,true);}},'image/png');}
function worldThroughStage(stage){
 const target=stageRecord(stage);if(!target?.data)throw Error('This layer has not been generated');
 if(stage===currentStage()&&(generating||dirty))throw Error('Wait until the current layer finishes generating before saving');
 return snapshotThroughStage(workspace,stage);
}
async function exportWorld(world,labelStage){const full=structuredClone(world);full.exportedAt=new Date().toISOString();await downloadText(JSON.stringify(full),`${full.name.replace(/[^a-z0-9_-]+/gi,'-').toLowerCase()||'world'}-stage${labelStage}-worldgen.json`);notice('Complete world file shared');}
async function doExport(){
 const stage=viewStage();
 try{const selected=worldThroughStage(stage);await exportWorld(selected,stage);}
 catch(error){notice(`Export unavailable: ${error.message}`,true);}
}
async function exportAll(){
 if(generating||dirty){notice('Wait for the current working layer to finish before exporting everything',true);return;}
 try{await exportWorld(workspace,availableThrough());}catch(e){if(e.name!=='AbortError')notice(e.message,true); }
}
function availableThrough(){return workspace.locked.length+(workspace.working.data?1:0);}

async function saveCheckpoint(){
 const stage=viewStage();
 if(!latestData(stage)){notice('This layer has no preview yet. Finish generating it or select an earlier completed layer.',true);return;}
 let world;
 try{world=worldThroughStage(stage);}catch(error){notice(error.message,true);return;}
 const proposed=prompt('Checkpoint name',`${workspace.name} — through layer ${stage}`);if(proposed===null)return;
 const name=proposed.trim().slice(0,100)||`${workspace.name} — through layer ${stage}`;
 const snap={id:`save-${globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`,name,created:new Date().toISOString(),stage};
 try{
  snapshots=await commitCheckpoint(await db(),{kind:'save',metadata:snap,world});
  if(root.querySelector('.wg-snapshot-list'))showLibrary();
  notice(`Layer ${stage} checkpoint saved: ${name}`);
 }catch(error){notice(`Checkpoint could not be saved: ${error.message}`,true);}
}
function openModal(title,html,extraClass=''){releaseTerrainViewer();root.querySelector('#wg-modal-host').innerHTML=`<div class="wg-modal-backdrop"><section class="wg-modal ${extraClass}" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}"><div class="wg-modal-heading"><h2>${escapeHTML(title)}</h2><button class="wg-icon-button" data-action="close-modal" aria-label="Close">×</button></div>${html}</section></div>`;activeModal=true;}
function modal(html){openModal('World library',html);}
function showLibrary(){
 modal(`<p class="wg-modal-caption">Automatic caching keeps your current work. Named checkpoints preserve full, independent world states.</p><div class="wg-library-actions"><button data-action="new-world">+ New world</button><button data-action="import">Import JSON</button><button data-action="export">Export selected layer</button><button data-action="export-all">Export entire world</button><button data-action="screenshot">Map PNG</button><button data-action="render">Explore 3D terrain</button></div><h3>Saved checkpoints <span>${snapshots.length}</span></h3><div class="wg-snapshot-list">${snapshots.length?snapshots.map(s=>`<div class="wg-snapshot"><div><strong>${escapeHTML(s.name)}</strong><small>${escapeHTML(new Date(s.created).toLocaleString())} · Layer ${s.stage}</small></div><div><button data-action="restore" data-id="${escapeHTML(s.id)}">Open</button><button data-action="export-checkpoint" data-id="${escapeHTML(s.id)}">Export</button><button class="wg-delete" data-action="delete" data-id="${escapeHTML(s.id)}" aria-label="Delete checkpoint">×</button></div></div>`).join(''):'<p class="wg-hint">No checkpoints yet. Lock a layer, then tap Save.</p>'}</div><p class="wg-modal-caption">Exports include all locked layers, working data, settings, seeds, and generated geometry. Your world stays on this device unless you export it.</p>`);
}
/** 3D terrain follows the selected layer without changing saved data. */
function showTerrain3D(){
 const selected=effectiveStage(),mesh=latestData(2),geometry=latestData(1);
 if(selected<ELEVATION_RENDER_STAGE||!latestData(ELEVATION_RENDER_STAGE)||!mesh||!geometry){
  notice('3D terrain becomes available at layer 4 — Elevation',true);return;
 }
 if(selected===currentStage()&&(generating||dirty)){
  notice('Finish the current layer generation before opening the 3D terrain viewer',true);return;
 }
 let terrain,appearance;
 try{terrain=selectTerrainSource(selected,latestData);appearance=selectTerrainAppearance(selected,latestData);}
 catch(error){notice(`3D terrain unavailable: ${error.message}`,true);return;}
 releaseTerrainViewer();
 const baseExaggeration=terrainVerticalScales(geometry).baseExaggeration;
 const description=terrain.usesEarlierTerrain?
  `Layer ${String(terrain.terrainStage).padStart(2,'0')} terrain · Layer ${String(selected).padStart(2,'0')} ${terrainAppearanceName(selected).toLowerCase()} appearance${selected>=9?' · saved rivers and lakes':''}`:
  `Layer ${String(terrain.terrainStage).padStart(2,'0')} · ${terrain.label} · ${terrain.hasCoast?'Zero-height flooding datum':'Signed altitude only (no water)'}`;
 openModal(`3D terrain · ${terrainAppearanceName(selected)}`,`<div class="wg-3d-root">
  <div class="wg-3d-intro">Read-only GPU terrain · ${escapeHTML(description)}</div>
  <div class="wg-3d-viewport"><canvas id="wg-3d-canvas" aria-label="Interactive 3D terrain from ${escapeHTML(terrain.label)}"></canvas>
   <div class="wg-3d-loading" id="wg-3d-loading">Preparing 3D terrain…</div></div>
  <div class="wg-3d-bar">
   <div class="wg-3d-modes"><button data-action="3d-orbit" class="wg-3d-selected" aria-pressed="true">Orbit</button><button data-action="3d-pan" aria-pressed="false">Pan</button></div>
   <button data-action="3d-zoom-out" aria-label="Zoom out">−</button>
   <button data-action="3d-fit">Fit</button>
   <button data-action="3d-zoom-in" aria-label="Zoom in">+</button>
  </div>
  <button class="wg-3d-height-toggle" data-action="3d-height-toggle" aria-expanded="false" aria-controls="wg-3d-height-panel">Relief · <span id="wg-3d-height-summary">${formatRelief(reliefMultiplier)}</span><span aria-hidden="true">⌄</span></button>
  <div id="wg-3d-height-panel" class="wg-3d-height-panel" hidden>
   <span class="wg-3d-height-title">Vertical relief</span>
   <button data-action="3d-height-down" aria-label="Decrease vertical relief by 5%">−</button>
   <label class="wg-screen-reader-only" for="wg-3d-height-value">Vertical relief multiplier</label>
   <input id="wg-3d-height-value" type="number" inputmode="decimal" min="0.01" max="1000" step="any" value="${reliefMultiplier}" aria-label="Vertical relief multiplier" />
   <span class="wg-3d-height-unit">×</span>
   <button data-action="3d-height-up" aria-label="Increase vertical relief by 5%">+</button>
   <span class="wg-3d-height-state" id="wg-3d-height-state">Applied · ${(baseExaggeration*reliefMultiplier).toPrecision(3)}× physical height</span>
  </div>
  <div class="wg-3d-foot"><span id="wg-3d-status">Preparing surface…</span><span>Drag to orbit · pinch to zoom / pan · double-tap to focus</span></div>
 </div>`,'wg-3d-modal');
 const canvasEl=root.querySelector('#wg-3d-canvas'),message=root.querySelector('#wg-3d-status');
 const viewer=new Terrain3DViewer(canvasEl,{initialHeightMultiplier:reliefMultiplier,onStatus:text=>{if(terrainViewer!==viewer)return;if(message)message.textContent=text;}});
 terrainViewer=viewer;
 viewer.initialize(geometry,mesh,terrain.elevations,{seaLevel:terrain.seaLevel,showOcean:terrain.hasCoast,label:selected>=9?`${terrain.label} + ${terrainAppearanceName(selected).toLowerCase()}`:terrain.label,hydrology:selected>=10?latestData(10):null,waterMask:selected>=6?latestData(6)?.water:selected>=5?latestData(5)?.water:null,appearance}).then(()=>{
  if(viewer.disposed)return;
  const loading=root.querySelector('#wg-3d-loading');if(loading)loading.hidden=true;
 }).catch(error=>{
  if(viewer.disposed)return;
  const loading=root.querySelector('#wg-3d-loading');
  if(loading){loading.hidden=false;loading.textContent=`3D unavailable: ${error.message}`;}
  if(message)message.textContent='3D setup failed';
 });
}
function releaseTerrainViewer(){
 terrainViewer?.dispose();terrainViewer=null;
}
function closeModal(){releaseTerrainViewer();root.querySelector('#wg-modal-host').innerHTML='';activeModal=false;}
function changeWorld(world){if(!startupReady)return;const next=prepareWorld(world);requestId++;stopWorker();clearTimeout(rebuildTimer);generating=false;measurePoints=[];measureMode=false;workspace=next;resetBorderCache();dirty=!!(workspace.working.data&&workspace.working.dataSettings&&JSON.stringify(workspace.working.settings)!==JSON.stringify(workspace.working.dataSettings));selectedId=null;firstFit=!workspace.viewport;void persist();closeModal();rebuildUI();requestAnimationFrame(()=>{resizeCanvas();if(firstFit)fitMap();else restoreViewport();});if(currentStage()<=IMPLEMENTED&&(!workspace.working.data||dirty))scheduleGeneration(150);}
async function handleImport(file){if(!file)return;try{if(file.size>60*1024*1024)throw Error('Files over 60 MB are not supported');const parsed=JSON.parse(await file.text());prepareWorld(parsed);if(!confirm(`Load '${parsed.name}'? Your current working state will be replaced. Export or save a checkpoint first to preserve it.`))return;changeWorld(parsed);notice('Complete world imported');}catch(error){notice(`Import failed: ${error.message}`,true);}finally{root.querySelector('#wg-import').value='';}}
function renderReliefState(value,pending=false){
 reliefMultiplier=clampRelief(value);
 writeReliefPreference(reliefMultiplier);
 const number=root.querySelector('#wg-3d-height-value'),summary=root.querySelector('#wg-3d-height-summary'),state=root.querySelector('#wg-3d-height-state');
 if(number&&document.activeElement!==number)number.value=String(Number(reliefMultiplier.toPrecision(7)));
 if(summary)summary.textContent=formatRelief(reliefMultiplier);
 if(state)state.textContent=`${pending?'Applying after 2 seconds…':'Applied'} · ${(terrainVerticalScales(geometryData()).baseExaggeration*reliefMultiplier).toPrecision(3)}× physical height`;
}
async function handleAction(action,button){
 switch(action){
  case 'home':{if(hasLauncherHost()){const saved=await flushPersist();if(saved||confirm('Automatic saving failed. Return to the launcher without saving the latest changes?'))returnToLauncher();}break;}
  case 'update':{const saved=await flushPersist();if(saved||confirm('Automatic saving failed. Refresh without saving the latest changes?'))await localUpdateButton(button,{onError:message=>notice('Update failed: '+message,true)});break;}
  case 'save':await saveCheckpoint();break;
  case 'library':showLibrary();break;
  case 'render':showTerrain3D();break;
  case 'close-modal':closeModal();break;
  case 'close-inspector':selectedId=null;updateInspector();schedulePaint();break;
  case 'fit':fitMap();break;
  case 'locate-cell':locateCell();break;
  case 'measure':measureMode=!measureMode;measurePoints=[];selectedId=null;updateInspector();updateMeasurement();schedulePaint();break;
  case 'toggle-explore':{const center=canvas?screenToWorld(canvas.clientWidth/2,canvas.clientHeight/2):null;workspace.exploreMode=!workspace.exploreMode;rebuildUI();requestAnimationFrame(()=>{resizeCanvas();if(center){view.x=canvas.clientWidth/2-center.x*view.scale;view.y=canvas.clientHeight/2-center.y*view.scale;}rememberViewport();schedulePaint();});persist('preferences');break;}
  case 'toggle-overlays':{const panel=root.querySelector('#wg-overlays'),open=panel.hidden;panel.hidden=!open;root.querySelector('[data-action="toggle-overlays"]').setAttribute('aria-expanded',String(open));break;}
  case 'screenshot':screenshot();break;
  case '3d-orbit':case '3d-pan':{
   terrainViewer?.setMode(action==='3d-pan'?'pan':'orbit');
   root.querySelectorAll('[data-action="3d-orbit"],[data-action="3d-pan"]').forEach(el=>{
    const active=el.dataset.action===action;el.classList.toggle('wg-3d-selected',active);el.setAttribute('aria-pressed',String(active));
   });break;
  }
  case '3d-fit':terrainViewer?.resetCamera();break;
  case '3d-zoom-in':terrainViewer?.zoom(.73);break;
  case '3d-zoom-out':terrainViewer?.zoom(1.37);break;
  case '3d-height-toggle':{
   const panel=root.querySelector('#wg-3d-height-panel');
   if(!panel)break;
   panel.hidden=!panel.hidden;
   button.setAttribute('aria-expanded',String(!panel.hidden));
   break;
  }
  case '3d-height-up':case '3d-height-down':{
   if(!terrainViewer)break;
   terrainViewer.queueHeightStep(action==='3d-height-up'?1:-1,(steps,pending)=>{
    if(terrainViewer?.disposed)return;
    renderReliefState(Math.pow(1.05,steps),pending);
   });
   break;
  }

  case 'zoom-in':zoomBy(1.45,canvas.clientWidth/2,canvas.clientHeight/2);break;
  case 'zoom-out':zoomBy(1/1.45,canvas.clientWidth/2,canvas.clientHeight/2);break;
  case 'reroll':if(viewStage()!==currentStage()||!stageUsesSeed(currentStage()))break;workspace.working.settings.seed=nextSeed();dirty=true;void persist();rebuildUI();scheduleGeneration(20);break;
  case 'regenerate':scheduleGeneration(10);break;
  case 'reset-settings':workspace.working.settings=defaultsForStage(currentStage());dirty=true;void persist();rebuildUI();scheduleGeneration(50);break;
  case 'lock-or-unlock':if(viewStage()<=workspace.locked.length)await unlockLayer(viewStage());else if(viewStage()===currentStage())commitLayer();break;
  case 'rename':{const name=prompt('World name',workspace.name);if(name!==null&&name.trim()){workspace.name=name.trim().slice(0,80);void persist();rebuildUI();}break;}
  case 'export':await doExport();break;
  case 'export-all':await exportAll();break;
  case 'export-checkpoint':{const saved=snapshots.find(s=>s.id===button.dataset.id);if(saved){const savedWorld=await storeGet(`checkpoint:${saved.id}`);if(savedWorld){const loaded=prepareWorld(savedWorld);await exportWorld(loaded,saved.stage);}else notice('Checkpoint data unavailable',true);}break;}
  case 'import':root.querySelector('#wg-import').click();break;
  case 'new-world':if(confirm('Create a new world? Your current working world will be replaced. Save a checkpoint or export it first if needed.'))changeWorld(newWorld());break;
  case 'restore':{const saved=snapshots.find(s=>s.id===button.dataset.id);if(saved&&confirm(`Open checkpoint '${saved.name}'? This replaces your current working world.`)){const savedWorld=await storeGet(`checkpoint:${saved.id}`);if(!savedWorld){notice('Checkpoint data unavailable',true);break;}changeWorld(savedWorld);notice('Checkpoint restored');}break;}
  case 'delete':{const saved=snapshots.find(s=>s.id===button.dataset.id);if(saved&&confirm(`Delete checkpoint '${saved.name}'?`)){snapshots=await commitCheckpoint(await db(),{kind:'delete',id:saved.id});if(root.querySelector('.wg-snapshot-list'))showLibrary();notice('Checkpoint deleted');}break;}
 }
}
function bindEvents(){
 root.addEventListener('toggle',event=>{
  const details=event.target;
  if(!details.matches?.('[data-fine-tune-stage]'))return;
  const stage=Number(details.dataset.fineTuneStage);
  if(details.open)expandedFineTuneStages.add(stage);
  else expandedFineTuneStages.delete(stage);
 },true);
 root.addEventListener('click',event=>{
  if(suppressHandleClick&&event.target.closest('.wg-console-handle')){suppressHandleClick=false;event.preventDefault();return;}
  const stageBtn=event.target.closest('[data-stage]');if(stageBtn&&!stageBtn.disabled){workspace.viewStage=Number(stageBtn.dataset.stage);selectedId=null;persist('preferences');rebuildUI();return;}
  const info=event.target.closest('[data-info]');if(info){event.preventDefault();showParameterHelp(info.dataset.info);return;}
  const adjust=event.target.closest('[data-adjust]');if(adjust){event.preventDefault();adjustParameter(adjust.dataset.adjust,Number(adjust.dataset.direction));return;}
  const actionBtn=event.target.closest('[data-action]');if(actionBtn){event.preventDefault();void handleAction(actionBtn.dataset.action,actionBtn).catch(e=>notice(e.message,true));}
 });
 // Sliders update immediately; typed values commit only on change so a user can
 // clear and retype a number without generating an invalid intermediate world.
 root.addEventListener('input',event=>{
  const el=event.target,key=el.dataset?.slider;
  if(key){
   const [min,max]=controlBounds(currentStage(),key);
   const value=key==='averageArea'?sliderToArea(el.value,min,max):storedParameter(key,Number(el.value));
   applyParameter(key,value,false);
   return;
  }
 });
 root.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='wg-3d-height-value'){
   const parsed=Number(el.value);
   if(!el.value.trim()||!Number.isFinite(parsed)||parsed<.01||parsed>1000){
    notice('Vertical relief must be from 0.01 to 1,000×',true);
    el.value=String(reliefMultiplier);return;
   }
   terrainViewer?.setHeightMultiplier(parsed);
   renderReliefState(parsed);
   el.value=String(Number(reliefMultiplier.toPrecision(7)));
   return;
  }
  if(el.dataset?.number){const key=el.dataset.number;applyParameter(key,el.value.trim()===''?'':storedParameter(key,Number(el.value)),true);return;}
  if(el.dataset?.setting){applyParameter(el.dataset.setting,el.value,true);return;}
  if(el.id==='wg-preset'){
   if(!el.value)return;
   const stage=currentStage();
   if(viewStage()!==stage||stage>IMPLEMENTED)return;
   workspace.working.settings=applyStagePreset(stage,activeSettings(),geometryData(),el.value);
   dirty=true;void persist();rebuildUI();scheduleGeneration(stage===2?300:75);
   return;
  }
  if(el.id==='wg-map-layer-select'){workspace.viewStage=Number(el.value);selectedId=null;persist('preferences');rebuildUI();return;}
  if(el.id==='wg-edges'){workspace.showEdges=el.checked;persist('preferences');schedulePaint();}
  if(el.id==='wg-plate-borders'){workspace.showPlateBorders=el.checked;persist('preferences');schedulePaint();}
  if(el.id==='wg-coast-borders'){workspace.showCoastBorders=el.checked;persist('preferences');schedulePaint();}
  if(el.id==='wg-flow'){workspace.showFlow=el.checked;persist('preferences');schedulePaint();}
  if(el.id==='wg-palette'){workspace.viewMode=el.value==='natural'?'auto':el.value;persist('preferences');schedulePaint();}
  if(el.id==='wg-seed'){
   if(viewStage()!==currentStage()||!stageUsesSeed(currentStage()))return;
   const value=el.value.trim(),seed=Number(value);
   if(!value||!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff){
    notice('Enter a whole-number seed from 0 to 4,294,967,295',true);
    el.value=String(workspace.working.settings.seed);return;
   }
   if(seed!==workspace.working.settings.seed){workspace.working.settings.seed=seed;dirty=true;void persist();showBusy(generating);scheduleGeneration(40);}
  }
  if(el.id==='wg-import')void handleImport(el.files?.[0]);
 });
 bindDrawerDrag();
 canvas.addEventListener('pointerdown',pointerStart);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerEnd);canvas.addEventListener('pointercancel',pointerEnd);canvas.addEventListener('lostpointercapture',pointerEnd);
 canvas.addEventListener('wheel',event=>{event.preventDefault();const p=canvasPoint(event);zoomBy(event.deltaY<0?1.14:1/1.14,p.x,p.y);},{passive:false});
 canvas.addEventListener('dblclick',event=>{const p=canvasPoint(event);zoomBy(1.5,p.x,p.y);});
 addEventListener('resize',()=>{applyConsoleHeight();resizeCanvas();});
 if('ResizeObserver' in globalThis)new ResizeObserver(resizeCanvas).observe(canvas);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void flushPersist();});
 addEventListener('pagehide',()=>void flushPersist());
}
const startupStorage=createStartupStorage({read:storeGet,commit:commitStorageChanges});
function openReadyWorld(result){
 workspace=result.world;snapshots=result.snapshots;storageWarned=false;
 dirty=!!(workspace.working.data&&workspace.working.dataSettings&&JSON.stringify(workspace.working.settings)!==JSON.stringify(workspace.working.dataSettings));
 firstFit=!(workspace.viewport&&Number.isFinite(workspace.viewport.scale)&&Number.isFinite(workspace.viewport.centerX)&&Number.isFinite(workspace.viewport.centerY));
 workspace.viewStage=clamp(Math.round(Number(workspace.viewStage)||1),1,Math.min(IMPLEMENTED,workspace.working.stage));
 startupReady=true;if(result.needsWorldSave)persist();buildShell();
 if(currentStage()<=IMPLEMENTED&&(!workspace.working.data||dirty))scheduleGeneration(100);
}
function showStartupRecovery(state){
 startupReady=false;
 console.warn('WorldGen startup storage:',state.errors.join('; '));
 const entries=state.library?.snapshots||[];
 root.innerHTML=`<div id="worldgen-root" class="wg-recovery-shell"><main class="wg-recovery" aria-labelledby="wg-recovery-title">
  <header class="wg-recovery-head"><div class="wg-eyebrow">WORLDGEN <span>v${APP_VERSION}</span></div>
  <h1 id="wg-recovery-title">World recovery</h1></header>
  <p>Your saved world could not be opened safely. Generation and automatic saving are paused. Nothing has been replaced.</p>
  <div class="wg-recovery-errors" role="alert">${state.errors.map(error=>`<p>${escapeHTML(error)}</p>`).join('')}</div>
  <button class="wg-primary" data-recovery="retry">Retry storage load</button>
  ${state.rawAvailable?'<button class="wg-secondary" data-recovery="export-raw">Export original working record</button>':''}
  <h2>Saved checkpoints</h2>
  ${state.library?entries.length?`<div class="wg-snapshot-list">${entries.map((s,i)=>`<div class="wg-snapshot"><div><strong>${escapeHTML(s.name)}</strong><small>Layer ${s.stage}</small></div><div><button data-recovery="restore" data-index="${i}">Restore</button><button data-recovery="export" data-index="${i}">Export</button></div></div>`).join('')}</div>`:'<p>No named checkpoints were found.</p>':'<p>The checkpoint library is unavailable. Retry to read it; it has not been reset.</p>'}
  <p class="wg-modal-caption">Restoring a checkpoint or creating a new world replaces the working record only after storage can be read and the replacement has been saved successfully. Export your original record first if available.</p>
  <button class="wg-secondary" data-recovery="new">Start a new world…</button>
  ${hasLauncherHost()?'<button class="wg-secondary" data-recovery="home">Return to launcher</button>':''}
  <p class="wg-recovery-status" role="status" aria-live="polite"></p>
 </main></div>`;
 const panel=root.querySelector('.wg-recovery'),status=panel.querySelector('.wg-recovery-status');
 let busy=false;
 async function act(button){
  if(busy)return;
  const action=button.dataset.recovery,entry=entries[Number(button.dataset.index)];
  if(action==='home'){returnToLauncher();return;}
  if(action==='new'&&!confirm('Replace the current working world with a new world? Named checkpoints will be preserved. Export the original record first if needed.'))return;
  if(action==='restore'&&(!entry||!confirm(`Restore checkpoint '${entry.name}'? This replaces the current working record.`)))return;
  busy=true;for(const control of panel.querySelectorAll('button'))control.disabled=true;
  status.textContent='Working…';
  try{
   if(action==='export-raw'){await downloadText(JSON.stringify(state.raw,null,2),'worldgen-recovery-original.json');status.textContent='Original record shared.';return;}
   if(action==='export'){const world=await readRecoveryCheckpoint(storeGet,state,entry.id);await exportWorld(world,entry.stage);status.textContent='Checkpoint shared.';return;}
   const result=action==='retry'?await startupStorage.load():await startupStorage.replace(action==='new'?{kind:'new',confirmed:true}:{kind:'checkpoint',id:entry.id,confirmed:true});
   if(result.kind==='ready')openReadyWorld(result);else showStartupRecovery(result);
  }catch(error){status.textContent=`Recovery could not finish: ${error?.message||error}.`;}
  finally{busy=false;for(const control of panel.querySelectorAll('button'))control.disabled=false;}
 }
 for(const button of panel.querySelectorAll('[data-recovery]'))button.addEventListener('click',()=>void act(button));
}
async function initialize(){
 const result=await startupStorage.load();
 if(result.kind==='ready')openReadyWorld(result);else showStartupRecovery(result);
}
await initialize();
