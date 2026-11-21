import {buildElevationSurface} from './terrain-3d-model.js';
self.onmessage=({data})=>{
 try{
  const {geometry,mesh,elevations,seaLevel,hydrology,waterMask,appearance}=data;
  const result=buildElevationSurface(geometry,mesh,elevations,value=>{
   self.postMessage({kind:'progress',value});
  },{seaLevel,hydrology,waterMask,appearance});
  const transfer=[result.vertexData.buffer,result.ocean.buffer,result.hydrology.rivers.buffer,result.hydrology.lakes.buffer,...result.levels.map(level=>level.indices.buffer),...result.uniformLevels.map(level=>level.indices.buffer)];
  if(result.materialColors)transfer.push(result.materialColors.buffer);
  self.postMessage({kind:'success',result},transfer);
 }catch(error){
  self.postMessage({kind:'error',message:error.message||String(error)});
 }
};
