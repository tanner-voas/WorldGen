/** Guided per-layer parameter profiles. These are starting points, never a
 * second generation algorithm: after applying a preset every value remains
 * independently editable and the ordinary layer generator receives it.
 * Length and cell-density choices use the locked world's physical area.
 */
import {DEFAULTS,MAX_CELLS} from './engine.js';
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const round=(n,places=4)=>Number(n.toFixed(places));

export function stagePresets(stage,geometry){
 const area=Math.max(1,Number(geometry?.areaKm2)||2097152);
 const factor=clamp(Math.pow(area/(2048*1024),.25),.55,2.6);
 const distance=(km,lo,hi)=>round(clamp(km*factor,lo,hi),2);
 const streams=n=>round(clamp(n*factor,2,120),2);
 const count=n=>Math.round(clamp(n*factor,3,50));
 const cells=n=>round(area/clamp(n,100,MAX_CELLS),6);
 const profile=(id,label,description,values)=>({id,label,description,values:{...DEFAULTS[stage],...values}});
 switch(stage){
  case 1:return [
   profile('regional','Regional rectangle','A practical mid-sized rectangular region with room for detailed local features.',{shape:'rectangle',width:2048,height:1024}),
   profile('island','Island disk','A roughly circular region suited to isolated islands and archipelagos.',{shape:'circle',radius:850}),
   profile('continent','Continental ellipse','A broad, horizontally elongated region suited to major continental landmasses.',{shape:'ellipse',radiusX:3000,radiusY:1650}),
   profile('vast','Vast rectangle','A large rectangular world; cell density will be chosen independently in Layer 2.',{shape:'rectangle',width:12000,height:8000})
  ];
  case 2:return [
   profile('coarse','Fast overview','Around 500 cells; quickest for exploring overall geography.',{averageArea:cells(500),distribution:'random',relaxation:1}),
   profile('balanced','Balanced mesh','Around 1,200 cells, blue-noise placement and light smoothing.',{averageArea:cells(1200),distribution:'random',relaxation:1}),
   profile('organic','Organic clusters','Around 2,500 cells with irregular clustering and less relaxation.',{averageArea:cells(2500),distribution:'clustered',relaxation:0}),
   profile('detailed','Detailed world','Around 5,000 cells, suitable for exploring smaller regions.',{averageArea:cells(5000),distribution:'random',relaxation:2}),
   profile('ultra','Maximum detail','20,000 cells with limited relaxation; can be slow on phones.',{averageArea:cells(20000),distribution:'random',relaxation:1})
  ];
  case 3:return [
   profile('few','Broad plates','A small number of wide plate territories with relatively few boundaries.',{plates:count(6)}),
   profile('balanced','Balanced plates','A moderate number of tectonic territories.',{plates:count(15)}),
   profile('fragmented','Fragmented plates','Many smaller tectonic territories and more shared boundaries.',{plates:count(32)})
  ];
  case 4:return [
   profile('quiet','Low-relief basin','Subtle boundary uplift and relatively even altitudes around zero.',{motion:.2,uplift:.35,upliftWidth:distance(95,30,500),roughness:.2}),
   profile('balanced','Balanced relief','Moderate positive ranges, negative rifts, and background altitude variation.',{motion:.7,uplift:.9,upliftWidth:distance(126,30,500),roughness:.46}),
   profile('mountains','Mountain belts','Strong, wide boundary uplift and rugged variations.',{motion:1.65,uplift:1.45,upliftWidth:distance(235,30,500),roughness:.6}),
   profile('rift','Narrow rifts','Sharp, relatively narrow tectonic relief and strong plate stress.',{motion:1.8,uplift:1.3,upliftWidth:distance(48,30,500),roughness:.32})
  ];
  case 5:return [
   profile('exposed','Exposed terrain','Raise the elevation field to reveal more land above the zero datum.',{oceanOffset:.48}),
   profile('balanced','Original datum','Keep the existing altitude field, flooding exactly where elevation is zero or lower.',{oceanOffset:0}),
   profile('wet','Broad seas','Lower the elevation field to submerge more of the available terrain.',{oceanOffset:-.36}),
   profile('deep','Drowned world','A strongly lowered altitude field that floods most low and moderate ground.',{oceanOffset:-.85})
  ];
  case 6:return [
   profile('untouched','Unmodified shores','Keep the Layer 5 water mask and shoreline exactly as generated.',{edgeOcean:0,setbackStrength:0}),
   profile('balanced','Soft coastlines','Gentle local lowering and coastal setback at the outside edge.',{edgeOcean:.4,edgeFade:distance(1.5,.5,5),setbackStrength:.3,setbackWidth:distance(10,2,18)}),
   profile('coastal','Ocean rim','Encourage an ocean margin with a stronger outer-edge falloff.',{edgeOcean:1.2,edgeFade:distance(3.4,.5,5),setbackStrength:.7,setbackWidth:distance(14,2,18)}),
   profile('receded','Strong setback','Pull more land away from the outer boundary, creating additional coastal gaps.',{edgeOcean:.8,edgeFade:distance(4,.5,5),setbackStrength:1.55,setbackWidth:distance(18,2,18)})
  ];
  case 7:return [
   profile('rolling','Rolling countryside','Rounded hills, modest detail, little incision and scarce volcanoes.',{ridge:.18,detail:.3,valleys:.2,volcanism:.02}),
   profile('balanced','Balanced landforms','A mixture of hills, mountain ridges, valleys and occasional volcanism.',{}),
   profile('alpine','Alpine highlands','Pronounced ridges, steep valleys and complex mountain terrain.',{ridge:1.5,detail:1.05,valleys:1.4,volcanism:.12}),
   profile('volcanic','Volcanic belts','Strong active volcanic terrain with rugged ridges and moderate valleys.',{ridge:1.1,detail:.9,valleys:.55,volcanism:.95}),
   profile('broken','Fractured wilderness','Highly variable ridges and deep incised valleys.',{ridge:1.45,detail:1.5,valleys:1.5,volcanism:.35})
  ];
  case 8:return [
   profile('pristine','Minimal erosion','Keep landforms close to their original heights with very light weathering.',{rainfall:.3,hydraulic:.15,thermal:.12,hardness:.9,iterations:4}),
   profile('balanced','Balanced erosion','Mix water-driven sediment movement with gradual slope weathering.',{}),
   profile('rivers','River-carved','High runoff and hydraulic incision form stronger drainage and deposition patterns.',{rainfall:1.5,hydraulic:1.45,thermal:.25,hardness:.2,iterations:32}),
   profile('weathered','Rounded old terrain','Intense thermal weathering on weaker rock smooths steep slopes.',{rainfall:.55,hydraulic:.65,thermal:1.5,hardness:.12,iterations:35}),
   profile('hard','Resistant escarpments','Durable rock preserves rugged terrain despite moderate rainfall.',{rainfall:.95,hydraulic:.7,thermal:.4,hardness:.94,iterations:14})
  ];
  case 9:return [
   profile('temperate','Temperate seasons','Mild equatorial reference, mid-latitude coverage and moderate precipitation.',{equatorTemp:23,latitudeCenter:33,latitudeSpan:80,axialTilt:24,rainfall:950,windDirection:45,rainShadow:.8,maritime:.7}),
   profile('balanced','Balanced climate','Broad latitudinal coverage with moderate rain and ocean moderation.',{}),
   profile('rainforest','Tropical wet','Warm conditions, heavy precipitation and weak mountain rain shadows.',{equatorTemp:35,latitudeCenter:0,latitudeSpan:45,axialTilt:10,rainfall:3100,windDirection:70,rainShadow:.25,maritime:1.2}),
   profile('desert','Arid rain shadow','Hotter, dry conditions amplified by strong mountain rain shadows.',{equatorTemp:36,latitudeCenter:20,latitudeSpan:90,axialTilt:17,rainfall:280,windDirection:-30,rainShadow:1.9,maritime:.15}),
   profile('cold','Cold high latitude','Subpolar temperatures, broad seasonal contrast and reduced ocean moderation.',{equatorTemp:14,latitudeCenter:62,latitudeSpan:48,axialTilt:38,rainfall:700,windDirection:10,rainShadow:.8,maritime:.3})
  ];
  case 10:return [
   profile('dry','Sparse channels','High losses and a high catchment threshold create few active streams.',{runoffScale:.38,infiltration:.75,evaporation:1.3,riverThreshold:streams(65),lakeDepth:.17,minLakeCells:5}),
   profile('balanced','Balanced drainage','Mixed connected rivers and occasional persistent basin lakes.',{riverThreshold:streams(4)}),
   profile('rivers','Riverlands','Heavy runoff, low infiltration and small channel thresholds produce many rivers.',{runoffScale:2.1,infiltration:.1,evaporation:.2,riverThreshold:streams(2),lakeDepth:.01,minLakeCells:1}),
   profile('lakes','Lake country','Wet basins with low minimum lake depth and compact qualifying lakes.',{runoffScale:1.6,infiltration:.12,evaporation:.25,riverThreshold:streams(9),lakeDepth:.002,minLakeCells:1})
  ];
  case 11:return [
   profile('thin','Thin rocky soils','Little soil production or organic accumulation; exposed mineral landscapes.',{weathering:.25,organicInput:.2,alluvialInput:.25,permeabilityBias:1.5,groundwaterRecharge:.35}),
   profile('balanced','Balanced soils','Mixed mineral weathering, organic matter and alluvial buildup.',{}),
   profile('fertile','Deep fertile soil','Intense weathering, organic inputs and floodplain deposition.',{weathering:1.8,organicInput:1.8,alluvialInput:1.7,permeabilityBias:.8,groundwaterRecharge:1.25}),
   profile('permeable','Well-drained ground','Coarser, permeable soils with limited organic buildup and groundwater.',{weathering:.7,organicInput:.5,alluvialInput:.65,permeabilityBias:1.95,groundwaterRecharge:.4}),
   profile('wet','Waterlogged ground','Poor drainage with high recharge and organic accumulation.',{weathering:1.3,organicInput:1.8,alluvialInput:1.2,permeabilityBias:.3,groundwaterRecharge:1.9})
  ];
  case 12:return [
   profile('forested','Forest potential','Cooler, wetter biome classification with a lower forest moisture requirement.',{temperatureShift:-2,rainfallResponse:1.55,forestThreshold:.55,wetlandThreshold:.55,alpineLimit:8,patchVariation:.1}),
   profile('balanced','Balanced biomes','Classify biomes using existing climate and soils with moderate regional variation.',{}),
   profile('arid','Dry ecosystems','Reduced effective rainfall and a higher moisture requirement for trees.',{temperatureShift:3,rainfallResponse:.46,forestThreshold:1.55,wetlandThreshold:.9,alpineLimit:9,patchVariation:.15}),
   profile('alpine','Alpine environments','Cool classification and an expanded cold-mountain habitat envelope.',{temperatureShift:-9,rainfallResponse:.9,forestThreshold:1.1,wetlandThreshold:.7,alpineLimit:13,patchVariation:.12}),
   profile('mosaic','Mixed ecotones','Increased regional patch variation to produce more varied biome transitions.',{temperatureShift:0,rainfallResponse:1.1,forestThreshold:.9,wetlandThreshold:.65,alpineLimit:9,patchVariation:.38})
  ];
  case 13:return [
   profile('sparse','Sparse early growth','Low, immature vegetation with extensive disturbance and bare habitat.',{vegetationDensity:.35,maturity:.25,disturbance:.7,riparianStrength:.25,patchiness:.2}),
   profile('balanced','Balanced vegetation','Natural vegetation and habitat mosaic from locked biome suitability.',{}),
   profile('old','Mature wilderness','Dense old vegetation with low disturbance and strong riverside growth.',{vegetationDensity:1.65,maturity:1,disturbance:.04,riparianStrength:1.15,patchiness:.12}),
   profile('patchy','Patchwork habitats','Strong spatial variation creates mixed open and closed vegetation.',{vegetationDensity:1.1,maturity:.72,disturbance:.38,riparianStrength:.7,patchiness:.43}),
   profile('riverside','Riparian corridors','Concentrate additional vegetation around saved streams and lakes.',{vegetationDensity:.85,maturity:.8,disturbance:.18,riparianStrength:1.5,patchiness:.12})
  ];
  default:return [];
 }
}

/** Compare only controllable settings; an independently rerolled seed does not
 * invalidate the descriptive profile used to initialize the layer. */
export function matchingPreset(stage,settings,geometry){
 return stagePresets(stage,geometry).find(p=>Object.entries(p.values).every(([key,value])=>key==='seed'||
  (typeof value==='number'?Math.abs(Number(settings[key])-value)<1e-5:settings[key]===value)))||null;
}

export function applyStagePreset(stage,settings,geometry,id){
 const profile=stagePresets(stage,geometry).find(p=>p.id===id);
 if(!profile)throw Error('Unknown stage preset');
 return {...settings,...profile.values,...('seed' in settings?{seed:settings.seed}:{})};
}
