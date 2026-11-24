// Generated release-scoped asset inventory. Only the shell is compulsory.
const CACHE='__SHELL_CACHE_NAME__';
const ASSETS=__PRECACHE_ASSETS__;
const scope=new URL(self.registration.scope);
const address=path=>new URL(path,scope).href;
const byURL=new Map(ASSETS.map(a=>[address(a.path),a]));
const managed=k=>k.startsWith('worldgen-shell-');
const marker=address('./__offline_release_metadata__');
const coreGroups=[...new Set(ASSETS.flatMap(a=>a.groups.filter(g=>g.startsWith('app:'))))];
const members=g=>ASSETS.filter(a=>a.groups.includes(g));
const flights=new Map();
let routingInfo;
async function matches(response,asset){
 if(!response?.ok)return false;
 const bytes=await response.clone().arrayBuffer();
 if(bytes.byteLength!==asset.size)return false;
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')===asset.sha256;
}
async function populate(cache,asset,oldCaches=[],network=true){
 const url=address(asset.path);
 const existing=await cache.match(url);
 if(existing&&await matches(existing,asset))return existing;
 for(const old of oldCaches){
  const hit=await old.match(url);
  if(hit&&await matches(hit,asset)){await cache.put(url,hit.clone());return hit;}
 }
 if(!network)return null;
 if(flights.has(url))return (await flights.get(url)).clone();
 const pending=(async()=>{
  const response=await fetch(new Request(url,{cache:'reload'}));
  if(!await matches(response,asset))throw Error('Asset unavailable or release changed: '+asset.path);
  await cache.put(url,response.clone());return response;
 })();
 flights.set(url,pending);
 try{return (await pending).clone();}finally{flights.delete(url);}
}
async function parallel(items,fn){
 // Wait for every started operation before propagating failure; no late writes
 // can recreate an aborted installation after its cache is deleted.
 for(let i=0;i<items.length;i+=4){
  const results=await Promise.allSettled(items.slice(i,i+4).map(fn));
  const rejected=results.find(r=>r.status==='rejected');if(rejected)throw rejected.reason;
 }
}
async function previousCaches(){
 const names=(await caches.keys()).filter(k=>managed(k)&&k!==CACHE).reverse();
 return Promise.all(names.map(async name=>({name,cache:await caches.open(name)})));
}
async function metadata(cache){try{return await (await cache.match(marker))?.json()||{};}catch{return {};}}
async function install(){
 const cache=await caches.open(CACHE),previous=await previousCaches(),old=previous.map(x=>x.cache);
 const priorMetadata=await Promise.all(previous.map(async p=>({...p,info:await metadata(p.cache)})));
 const activePrevious=priorMetadata.find(p=>p.info.active)||priorMetadata.find(p=>!p.info.schema);
 try{
  await parallel(members('shell'),a=>populate(cache,a,old));
  // Keep previously complete application cores available offline on upgrade.
  // Legacy precaches have no metadata; check actual assets instead.
  for(const group of coreGroups){
   const assets=members(group);let installed=false;
   for(const prior of priorMetadata){
    const info=prior.info;
    if(info.installed?.includes(group)||(!info.schema&&assets.some(a=>a.path.endsWith('/app.js')||a.path==='./app.js')&&await prior.cache.match(address(assets.find(a=>a.path.endsWith('/app.js')||a.path==='./app.js').path)))){installed=true;break;}
   }
   if(installed)await parallel(assets,a=>populate(cache,a,old));
  }
  // Reuse already downloaded optional files, but never fetch optional packs
  // merely because the app version changes. Quota pressure cannot block shell.
  for(const asset of ASSETS.filter(a=>a.groups.some(g=>g.startsWith('reader:')))){
   try{await populate(cache,asset,activePrevious?[activePrevious.cache]:[],false);}catch{/* optional */}
  }
  const installed=[];for(const group of coreGroups)if((await status(cache,group)).complete)installed.push(group);
  await cache.put(marker,new Response(JSON.stringify({schema:1,installed,previous:activePrevious?.name||null,obsolete:previous.map(p=>p.name).filter(k=>k!==activePrevious?.name)})));
 }catch(error){await caches.delete(CACHE);throw error;}
}
async function status(cache,group){
 const assets=members(group);let count=0,bytes=0;
 for(const a of assets)if(await cache.match(address(a.path))){count++;bytes+=a.size;}
 return {group,count,total:assets.length,bytes,totalBytes:assets.reduce((n,a)=>n+a.size,0),complete:assets.length>0&&count===assets.length};
}
let groupQueue=Promise.resolve();
function groupOperation(fn){const next=groupQueue.then(fn);groupQueue=next.catch(()=>{});return next;}
async function handleGroup(data,port){
 const cache=await caches.open(CACHE);
 const groups=[...new Set(ASSETS.flatMap(a=>a.groups))].filter(g=>g!=='shell');
 if(data.action==='status'){port.postMessage({ok:true,groups:await Promise.all(groups.map(g=>status(cache,g)))});return;}
 const group=data.group;
 if(!groups.includes(group))throw Error('Unknown offline pack');
 if(data.action==='download'){
  const assets=members(group);let done=0;
  await parallel(assets,async a=>{await populate(cache,a);port.postMessage({progress:++done,total:assets.length});});
  if(group.startsWith('app:')){
   const info=await metadata(cache);info.installed=[...new Set([...(info.installed||[]),group])];
   await cache.put(marker,new Response(JSON.stringify(info)));
  }
 }else if(data.action==='remove'&&group.startsWith('reader:')){
  // Original archives can be shared by several graded packs. Retain assets
  // needed by any other complete pack; user-imported reader caches untouched.
  const others=await Promise.all(groups.filter(g=>g!==group&&g.startsWith('reader:')).map(g=>status(cache,g)));
  const keep=new Set(others.filter(s=>s.complete).map(s=>s.group));
  for(const asset of members(group))if(!asset.groups.some(g=>keep.has(g)))await cache.delete(address(asset.path));
 }else throw Error('Unsupported offline operation');
 port.postMessage({ok:true,groups:await Promise.all(groups.map(g=>status(cache,g)))});
}
self.addEventListener('install',event=>event.waitUntil(install()));
self.addEventListener('message',event=>{
 if(event.data==='activate-update'){
  event.waitUntil((async()=>{
   const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
   if(windows.filter(c=>c.id!==event.source?.id).length){event.source?.postMessage({type:'offline-update-blocked'});return;}
   const cache=await caches.open(CACHE),info=await metadata(cache);
   if(info.previous&&event.source?.id){info.oldClient=event.source.id;await cache.put(marker,new Response(JSON.stringify(info)));}
   await self.skipWaiting();
  })());return;
 }
 if(event.data?.type==='offline-pack'&&event.ports?.[0]){
  const port=event.ports[0];event.waitUntil(groupOperation(()=>handleGroup(event.data,port)).catch(error=>port.postMessage({ok:false,error:error.message||String(error)})));
 }
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE),info=await metadata(cache);
 info.active=true;await cache.put(marker,new Response(JSON.stringify(info)));routingInfo=Promise.resolve(info);
 // Retain one prior release for the explicitly reloading client. Do not
 // touch imported chapter, font, user data or any unrelated cache namespace.
 await Promise.all((info.obsolete||[]).filter(k=>managed(k)&&k!==CACHE&&k!==info.previous).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));
function navigationResponse(response){return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});}
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||url.pathname.startsWith('/_profiles/'))return;
 if(event.request.mode==='navigate'){
  if(url.pathname!==scope.pathname&&url.pathname!==new URL('./index.html',scope).pathname)return;
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE);const result=await cache.match(address('./index.html'))||await fetch(event.request);
   const info=await (routingInfo??=metadata(cache));
   if(info.oldClient&&event.resultingClientId===info.oldClient){delete info.oldClient;await cache.put(marker,new Response(JSON.stringify({...await metadata(cache),oldClient:null})));}
   return navigationResponse(result);
  })());return;
 }
 const asset=byURL.get(url.href);if(!asset)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),info=await (routingInfo??=metadata(cache));
  if(info.oldClient&&info.oldClient===event.clientId&&info.previous){
   const prior=await caches.open(info.previous);return await prior.match(url.href)||new Response('Reload to use the new release.',{status:503});
  }
  const hit=await cache.match(url.href);if(hit)return hit;
  try{return await populate(cache,asset);}catch{return new Response('Offline asset unavailable. Connect and retry.',{status:503});}
 })());
});
