import {buildElevationSurface,buildFocusedTerrainPatch,createSurfaceSampler} from './terrain-3d-model.js';
import {buildPickBounds} from './terrain-pick-bounds.js';
import {buildMorphFields} from './terrain-3d-morph.js';
import {buildTerrainSiteColors} from './terrain-3d-material.js';

// A close-up worker owns one immutable copy of the world. Camera movement only
// sends compact tile coordinates; it does not repeatedly clone thousands of
// Voronoi polygons, terrain arrays and environmental records across threads.
let detailContext=null;
self.onmessage=({data})=>{
 try{
  if(data.kind==='init-detail'){
   const {geometry,mesh,elevations,appearance,grid,waterMask,seaLevel,hydrology}=data;
   detailContext={geometry,mesh,elevations,appearance,grid,
    sampler:createSurfaceSampler(mesh,elevations,{waterMask,seaLevel,hydrology}),
    sourceColors:buildTerrainSiteColors(mesh,appearance||null)};
   self.postMessage({kind:'detail-ready'});
   return;
  }
  if(data.kind==='detail'){
   if(!detailContext)throw Error('Close-up source is not initialized');
   const {geometry,mesh,elevations,grid,sampler,sourceColors,appearance}=detailContext;
   const patches=data.tiles.map(tile=>buildFocusedTerrainPatch(
    geometry,mesh,elevations,grid,tile,{appearance,sampler,sourceColors,subdivisions:tile.subdivisions}));
   for(const patch of patches)patch.pickBounds=buildPickBounds(patch.vertexData,patch.indices);
   const transfer=patches.flatMap(patch=>[patch.vertexData.buffer,patch.indices.buffer,patch.pickBounds.buffer,
    ...(patch.materialColors?[patch.materialColors.buffer]:[])]);
   self.postMessage({kind:'detail',key:data.key,patches},transfer);
   return;
  }
  const {geometry,mesh,elevations,seaLevel,hydrology,waterMask,appearance}=data;
  const result=buildElevationSurface(geometry,mesh,elevations,value=>{
   self.postMessage({kind:'progress',value});
  },{seaLevel,hydrology,waterMask,appearance,includeUniformLevels:false});
  result.morphFields=buildMorphFields(result);
  // The production viewer always has morph references and uses stitched
  // adaptive indices even for uniform views. Do not build duplicate legacy
  // index arrays on this path.
  for(const level of result.levels)level.pickBounds=buildPickBounds(result.vertexData,level.indices);
  result.waterPickBounds={ocean:buildPickBounds(result.ocean,null,3),
   lakes:buildPickBounds(result.hydrology.lakes,null,3),rivers:buildPickBounds(result.hydrology.rivers,null,3)};
  const transfer=[result.morphFields.terrain.buffer,result.vertexData.buffer,result.insideMask.buffer,result.ocean.buffer,
   result.hydrology.rivers.buffer,result.hydrology.lakes.buffer,
   ...result.levels.flatMap(level=>[level.indices.buffer,level.pickBounds.buffer]),
   ...Object.values(result.waterPickBounds).map(bounds=>bounds.buffer),
   ...result.uniformLevels.map(level=>level.indices.buffer)];
  if(result.materialColors)transfer.push(result.materialColors.buffer);
  if(result.surfaceMaterials)transfer.push(result.surfaceMaterials.data.buffer);
  if(result.morphFields.material)transfer.push(result.morphFields.material.buffer);
  if(result.hydrology.riverMask)transfer.push(result.hydrology.riverMask.buffer);
  self.postMessage({kind:'success',result},transfer);
 }catch(error){
  self.postMessage({kind:'error',message:error.message||String(error)});
 }
};
