import {buildElevationSurface,buildFocusedTerrainPatch,createSurfaceSampler} from './terrain-3d-model.js';
import {buildTerrainSiteColors} from './terrain-3d-material.js';

// A close-up worker owns one immutable copy of the world. Camera movement only
// sends compact tile coordinates; it does not repeatedly clone thousands of
// Voronoi polygons, terrain arrays and environmental records across threads.
let detailContext=null;
self.onmessage=({data})=>{
 try{
  if(data.kind==='init-detail'){
   const {geometry,mesh,elevations,appearance,grid,waterMask,seaLevel}=data;
   detailContext={geometry,mesh,elevations,appearance,grid,
    sampler:createSurfaceSampler(mesh,elevations,{waterMask,seaLevel}),
    sourceColors:buildTerrainSiteColors(mesh,appearance||null)};
   self.postMessage({kind:'detail-ready'});
   return;
  }
  if(data.kind==='detail'){
   if(!detailContext)throw Error('Close-up source is not initialized');
   const {geometry,mesh,elevations,grid,sampler,sourceColors,appearance}=detailContext;
   const patches=data.tiles.map(tile=>buildFocusedTerrainPatch(
    geometry,mesh,elevations,grid,tile,{appearance,sampler,sourceColors}));
   const transfer=patches.flatMap(patch=>[patch.vertexData.buffer,patch.indices.buffer,
    ...(patch.materialColors?[patch.materialColors.buffer]:[])]);
   self.postMessage({kind:'detail',key:data.key,patches},transfer);
   return;
  }
  const {geometry,mesh,elevations,seaLevel,hydrology,waterMask,appearance}=data;
  const result=buildElevationSurface(geometry,mesh,elevations,value=>{
   self.postMessage({kind:'progress',value});
  },{seaLevel,hydrology,waterMask,appearance});
  const transfer=[result.vertexData.buffer,result.insideMask.buffer,result.ocean.buffer,
   result.hydrology.rivers.buffer,result.hydrology.lakes.buffer,
   ...result.levels.map(level=>level.indices.buffer),
   ...result.uniformLevels.map(level=>level.indices.buffer)];
  if(result.materialColors)transfer.push(result.materialColors.buffer);
  self.postMessage({kind:'success',result},transfer);
 }catch(error){
  self.postMessage({kind:'error',message:error.message||String(error)});
 }
};
