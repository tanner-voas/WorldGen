import {rasterize} from './raster.js';

self.onmessage=async ({data:job})=>{
 try{
  const pixels=await rasterize(job,progress=>self.postMessage({progress}));
  self.postMessage({pixels},[pixels.buffer]);
 }catch(error){self.postMessage({error:error.message});}
};
