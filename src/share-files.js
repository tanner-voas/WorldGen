/** File sharing only. Never navigate to a blob URL or trigger an anchor download.
 * An explicit second tap restores transient user activation after async preparation. */
export async function shareFile(file,{env=globalThis}={}){
 const nav=env.navigator,doc=env.document;
 let supported=false;try{supported=typeof nav?.share==='function'&&typeof nav.canShare==='function'&&nav.canShare({files:[file]});}catch{}
 if(!supported)throw Error('File sharing is unavailable in this browser. Open the app on a device that supports the system share sheet.');
 // A separate title is treated as a second text item by some iOS share targets.
 const share=()=>nav.share({files:[file]});
 if(nav.userActivation?.isActive){try{await share();return 'shared';}catch(err){if(err.name!=='NotAllowedError')throw err;}}
 return new Promise((resolve,reject)=>{
  const dialog=doc.createElement('dialog');dialog.style.cssText='position:fixed;z-index:2147483647;width:min(340px,90vw);box-sizing:border-box;padding:20px;border:1px solid #b5c4bd;border-radius:18px;background:#fff;color:#173a30;font:16px/1.4 system-ui;';
  const heading=doc.createElement('strong');heading.textContent='File ready to share';const text=doc.createElement('p');text.textContent=file.name;text.style.overflowWrap='anywhere';
  const button=doc.createElement('button');button.textContent='Share file';button.style.cssText='font:inherit;padding:12px;margin-right:8px;border-radius:10px;background:#1e493b;color:white;border:0';
  const cancel=doc.createElement('button');cancel.textContent='Cancel';cancel.style.cssText='font:inherit;padding:12px;border:1px solid #aaa;border-radius:10px;background:white;color:#173a30';
  const error=doc.createElement('p');error.setAttribute('role','alert');
  const finish=(err)=>{dialog.remove();err?reject(err):resolve('shared');};
  button.onclick=async()=>{button.disabled=true;cancel.disabled=true;try{await share();finish();}catch(err){if(err.name==='AbortError')finish(err);else{error.textContent=err.message||'Unable to share file';button.disabled=false;cancel.disabled=false;}}};
  cancel.onclick=()=>finish(new DOMException('Share cancelled','AbortError'));
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!button.disabled)cancel.onclick();});dialog.append(heading,text,button,cancel,error);doc.body.append(dialog);try{dialog.showModal();}catch(err){finish(err);}
 });
}
export const shareBlob=(blob,name,options={})=>shareFile(new File([blob],name,{type:blob.type||'application/octet-stream'}),options);
export const shareText=(text,name,{type='application/json',...options}={})=>shareBlob(new Blob([text],{type}),name,options);
