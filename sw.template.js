const CACHE='__CACHE__', ASSETS=__ASSETS__;
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);await c.addAll(ASSETS.map(p=>new Request(new URL(p,self.registration.scope),{cache:'reload'})));await self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('worldgen-shell-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url);if(url.origin!==location.origin)return;
 if(e.request.mode==='navigate'){
  e.respondWith((async()=>{const index=new URL('./index.html',self.registration.scope);const response=await caches.match(index.href)||await fetch(e.request);return new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers});})());return;
 }
 e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
