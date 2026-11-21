import {buildElevationSurface} from './terrain-3d-model.js';
self.onmessage=({data})=>{
 try{
  const {geometry,mesh,elevations,seaLevel}=data;
  const result=buildElevationSurface(geometry,mesh,elevations,value=>{
   self.postMessage({kind:'progress',value});
  },{seaLevel});
  const transfer=[result.vertexData.buffer,result.ocean.buffer,...result.levels.map(level=>level.indices.buffer)];
  self.postMessage({kind:'success',result},transfer);
 }catch(error){
  self.postMessage({kind:'error',message:error.message||String(error)});
 }
};
