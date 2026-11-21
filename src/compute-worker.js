import {generateStage} from './engine.js';
self.onmessage=event=>{
 const {id,stage,locked,settings}=event.data;
 try{const data=generateStage(stage,locked,settings);self.postMessage({id,ok:true,data});}
 catch(error){self.postMessage({id,ok:false,error:error?.message||String(error)});}
};
