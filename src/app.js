import {DEFAULTS,STAGES,IMPLEMENTED,SCHEMA_VERSION,newWorld,validateWorld,WORLD_WIDTH,WORLD_HEIGHT} from './engine.js';

const APP_VERSION='0.1.0',DB_NAME='worldgen-v1',KEY='workspace';
const host=globalThis.__APP_LAUNCHER__;
const root=document.querySelector('#app');
if(!root)throw Error('WorldGen requires an #app element');
document.body.classList.add('worldgen-active');
root.classList.add('worldgen-host');
document.title=`WorldGen v${APP_VERSION}`;

const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const shortNumber=x=>Number(x).toLocaleString('en-US');
const OPTIONS={
  1:[
    ['count','Cells','range',100,3200,100],
    ['distribution','Placement','select',[['jittered','Even / jittered'],['random','Blue-noise random'],['clustered','Clustered']]],
    ['jitter','Position jitter','range',0,1.7,0.05],
    ['relaxation','Lloyd relaxation','range',0,3,1]
  ],
  2:[['plates','Plates','range',3,50,1],['continental','Continental ratio','range',0.1,0.9,0.05],['motion','Plate motion','range',0,2,0.05]],
  3:[['uplift','Uplift strength','range',0,1.6,0.05],['roughness','Surface roughness','range',0,1.4,0.05],['continentalHeight','Crust elevation','range',0.05,0.8,0.025]],
  4:[['land','Land coverage target','range',0.1,0.85,0.01]]
};
const palettes={
  natural:'Natural',geometry:'Cell geometry',plates:'Tectonic plates',height:'Elevation',coast:'Land / sea'
};
let dbPromise=null,workspace=newWorld(),snapshots=[],view={scale:1,x:0,y:0},canvas,ctx,renderPending=false;
let generating=false,dirty=false,storageHealthy=true,storageWarned=false,requestId=0,worker=null,rebuildTimer=null,writeQueue=Promise.resolve(),selectedId=null,activeModal=null;
let firstFit=true,movePointers=new Map(),gesture=null,panMoved=false;
function db(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  if(!('indexedDB' in globalThis)){reject(Error('IndexedDB unavailable'));return;}
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>{const database=req.result;if(!database.objectStoreNames.contains('data'))database.createObjectStore('data');};
  req.onerror=()=>reject(req.error||Error('Storage unavailable'));req.onsuccess=()=>resolve(req.result);
 });
 return dbPromise;
}
async function storeGet(key){const database=await db();return new Promise((resolve,reject)=>{const req=database.transaction('data').objectStore('data').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function storePut(key,value){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('data','readwrite');tx.objectStore('data').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
function persist(){workspace.updated=new Date().toISOString();const copy=structuredClone(workspace);writeQueue=writeQueue.catch(()=>{}).then(()=>storePut(KEY,copy)).then(()=>{storageHealthy=true;storageWarned=false;}).catch(e=>{storageHealthy=false;showBusy(generating);if(!storageWarned){storageWarned=true;notice(`Automatic saving unavailable: ${e.message}. Export your world as a backup.`,true);}});return writeQueue;}
function saveSnapshots(){const copy=structuredClone(snapshots);writeQueue=writeQueue.catch(()=>{}).then(()=>storePut('snapshots',copy));return writeQueue;}
function notice(message,error=false){let el=root.querySelector('#wg-toast');if(!el)return;el.textContent=message;el.classList.toggle('error',error);el.classList.add('visible');clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.classList.remove('visible'),4000);}
function stageText(stage){return STAGES[stage]?.[0]||'Unknown stage';}
function currentStage(){return workspace.working.stage;}
function stageRecord(stage){return workspace.locked[stage-1]||(stage===currentStage()?workspace.working:null);}
function latestData(stage){return stageRecord(stage)?.data||null;}
function viewStage(){return workspace.viewStage||1;}
function effectiveStage(){const chosen=viewStage();return latestData(chosen)?chosen:Math.min(currentStage()-1,IMPLEMENTED);}
function activeSettings(){return workspace.working.settings;}
function showBusy(busy){generating=busy;const el=root.querySelector('#wg-status');if(el)el.innerHTML=busy?'<span class="wg-busy-dot"></span> Generating…':storageHealthy?'<span class="wg-saved-dot"></span> Cached locally':'<span class="wg-busy-dot"></span> Export backup';const lock=root.querySelector('[data-action="lock"]');if(lock)lock.disabled=busy||dirty||!workspace.working.data;}

function buildShell(){
 root.innerHTML=`<div id="worldgen-root" class="wg-shell">
   <header class="wg-header">
    <button class="wg-icon-button wg-home" data-action="home" aria-label="Return to launcher" title="Return to launcher">${host?'⌂':'≡'}</button>
    <div class="wg-headline"><div class="wg-eyebrow">WORLDGEN <span>v${APP_VERSION}</span></div><button class="wg-world-name" data-action="rename" title="Rename world">${escapeHTML(workspace.name)} <span>⌄</span></button></div>
    <button class="wg-icon-button" data-action="save" aria-label="Save checkpoint" title="Save checkpoint">▣</button>
    <button class="wg-icon-button" data-action="library" aria-label="Open world library" title="World library">☰</button>
   </header>
   <main class="wg-map-area">
    <canvas id="wg-map" aria-label="Interactive world map: drag to pan, pinch or scroll to zoom, tap a polygon to inspect" role="img"></canvas>
    <div class="wg-map-buttons"><button data-action="fit" aria-label="Fit world to view" title="Fit entire world">⤢</button><button data-action="zoom-in" aria-label="Zoom in">+</button><button data-action="zoom-out" aria-label="Zoom out">−</button></div>
    <div class="wg-display-bar"><label for="wg-palette" class="wg-screen-reader-only">Map display</label><select id="wg-palette" aria-label="Map display mode">${Object.entries(palettes).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select><label class="wg-edge-toggle"><input id="wg-edges" type="checkbox" checked><span>Mesh</span></label></div>
    <div class="wg-map-scale" id="wg-map-scale">World width: 2,048 units</div>
    <div class="wg-inspector" id="wg-inspector" hidden></div>
   </main>
   <section class="wg-console" aria-label="World generation stages">
    <div class="wg-console-handle"></div>
    <div class="wg-progress-row"><div class="wg-stage-heading"><span class="wg-section-caption">GENERATION PIPELINE</span><span id="wg-status"><span class="wg-saved-dot"></span> Cached locally</span></div><div class="wg-stage-scroll" id="wg-stage-scroll"></div></div>
    <div class="wg-stage-main" id="wg-stage-main"></div>
   </section>
   <div class="wg-modal-host" id="wg-modal-host"></div><div id="wg-toast" class="wg-toast" role="status" aria-live="polite"></div>
   <input id="wg-import" type="file" accept=".json,application/json" hidden />
  </div>`;
 canvas=root.querySelector('#wg-map');ctx=canvas.getContext('2d',{alpha:false});
 bindEvents();rebuildUI();requestAnimationFrame(()=>{resizeCanvas();if(firstFit)fitMap();});
}
function rebuildUI(){
 root.querySelector('.wg-world-name').innerHTML=`${escapeHTML(workspace.name)} <span>⌄</span>`;
 const active=currentStage(),stage=viewStage(),rail=root.querySelector('#wg-stage-scroll');
 rail.innerHTML=STAGES.slice(1).map(([name],i)=>{
  const n=i+1,locked=n<=workspace.locked.length,working=n===active,upcoming=n>IMPLEMENTED,available=locked||(working&&!!workspace.working.data);
  const klass=stage===n?'current':locked?'done':working?'editable':'later';
  return `<button class="wg-stage-chip ${klass}" data-stage="${n}" ${upcoming||(!available&&n!==active)?'disabled':''} title="${escapeHTML(name)}"><span>${locked?'✓':String(n).padStart(2,'0')}</span><small>${escapeHTML(name)}</small></button>`;
 }).join('');
 rail.querySelector('.current')?.scrollIntoView?.({block:'nearest',inline:'nearest'});
 const row=stageRecord(stage),available=stage<=IMPLEMENTED,editable=stage===active&&active<=IMPLEMENTED;
 const settings=editable?activeSettings():row?.settings;
 let html=`<div class="wg-stage-title"><div><span class="wg-layer-label">LAYER ${String(stage).padStart(2,'0')} ${editable?'· WORKING':stage<=workspace.locked.length?'· LOCKED':'· NOT AVAILABLE'}</span><h2>${escapeHTML(stageText(stage))}</h2><p>${escapeHTML(STAGES[stage]?.[1]||'')}</p></div></div>`;
 if(!available){html+='<p class="wg-hint">This generation layer is planned for a future release.</p>';}
 else if(editable){
  html+=`<div class="wg-controls">${OPTIONS[stage].map(settingRow).join('')}<div class="wg-seed-row"><label for="wg-seed">Random seed</label><input id="wg-seed" type="number" inputmode="numeric" value="${settings.seed}" min="0" max="4294967295"><button data-action="reroll" title="New seed">↻ Reroll</button></div></div>`;
  html+=`<div class="wg-actions"><button class="wg-secondary" data-action="regenerate">Regenerate</button><button class="wg-primary" data-action="lock" ${generating||dirty||!workspace.working.data?'disabled':''}>Lock layer ${stage} →</button></div>`;
 }else if(row){
  html+=`<p class="wg-summary">${describeStage(stage,row.data)} This layer is preserved as part of your world history.</p><div class="wg-actions"><button class="wg-secondary" data-action="edit-earlier">Revise this layer</button><button class="wg-primary" data-action="save">Save checkpoint</button></div>`;
 }else{html+='<p class="wg-hint">Generate and lock the preceding layer to continue.</p>';}
 root.querySelector('#wg-stage-main').innerHTML=html;
 root.querySelector('#wg-palette').value=workspace.viewMode==='auto'?'natural':workspace.viewMode;
 root.querySelector('#wg-edges').checked=workspace.showEdges;
 showBusy(generating);updateInspector();schedulePaint();
}
function settingRow([key,label,type,a,b,c]){
 const s=activeSettings(),value=s[key],shown=key==='continental'||key==='land'?`${Math.round(value*100)}%`:String(value);
 if(type==='select')return `<label class="wg-form-field"><span>${label}</span><select data-setting="${key}">${a.map(([v,n])=>`<option value="${v}" ${v===value?'selected':''}>${n}</option>`).join('')}</select></label>`;
 return `<label class="wg-form-field"><span>${label} <output data-value="${key}">${shown}</output></span><input data-setting="${key}" type="range" min="${a}" max="${b}" step="${c}" value="${value}"></label>`;
}
function describeStage(stage,data){if(!data)return 'No preview generated yet.';switch(stage){
 case 1:return `${shortNumber(data.cells.length)} Voronoi cells across a 2:1 world.`;
 case 2:return `${data.plates.length} tectonic plates with distinct crust properties and motion.`;
 case 3:return `${data.elevations.length} elevation samples with plate-boundary uplift.`;
 case 4:return `${Math.round(data.landFraction*100)}% of the cells are above sea level.`;
 default:return '';
}}
function nextSeed(){return Math.floor(Math.random()*0xffffffff);}
function scheduleGeneration(ms=230){clearTimeout(rebuildTimer);rebuildTimer=setTimeout(()=>void generateCurrent(),ms);}
async function generateCurrent(){
 const stage=currentStage();if(stage>IMPLEMENTED)return;
 if(worker){worker.terminate();worker=null;}
 const id=++requestId;const settings=structuredClone(workspace.working.settings);const settingsStamp=JSON.stringify(settings);const locked=workspace.locked.map(({stage,data})=>({stage,data}));
 showBusy(true);
 try{
  worker=new Worker(new URL('./compute-worker.js',import.meta.url),{type:'module'});
  const result=await new Promise((resolve,reject)=>{
   const job=worker;
   job.onmessage=event=>resolve(event.data);
   job.onerror=error=>reject(Error(error.message||'Generation worker failed'));
   job.postMessage({id,stage,settings,locked});
  });
  if(id!==requestId||stage!==currentStage()||settingsStamp!==JSON.stringify(workspace.working.settings))return;
  if(!result.ok)throw Error(result.error);
  workspace.working.data=result.data;workspace.working.dataSettings=structuredClone(settings);dirty=false;
  workspace.viewStage=stage;
  selectedId=null;
  await persist();
  showBusy(false);rebuildUI();notice(`${stageText(stage)} generated`);
 }catch(error){if(id!==requestId)return;showBusy(false);rebuildUI();notice(`Generation failed: ${error.message}`,true);}
 finally{if(id===requestId){worker?.terminate();worker=null;}}
}
function commitLayer(){
 const stage=currentStage(),working=workspace.working;
 if(generating||dirty||!working.data||stage>IMPLEMENTED)return;
 workspace.locked.push({stage,settings:structuredClone(working.settings),data:working.data,lockedAt:new Date().toISOString()});
 const next=stage+1;
 workspace.working={stage:next,settings:next<=IMPLEMENTED?{...DEFAULTS[next]}:{},data:null,dataSettings:null};dirty=false;
 workspace.viewStage=stage;selectedId=null;
 void persist();rebuildUI();notice(`Layer ${stage} locked. Your world history is preserved.`);
 // Advance the interface to a working layer, while preserving the last map.
 if(next<=IMPLEMENTED){workspace.viewStage=next;rebuildUI();scheduleGeneration(50);}
}
function reviseStage(stage){
 const earlier=workspace.locked[stage-1];if(!earlier)return;
 const later=workspace.locked.length-stage;
 if(!confirm(`Revise layer ${stage}? This creates a new branch from that layer. ${later?`${later} later locked layer(s) will be removed from the working branch.`:'Later layers will be regenerated from this revision.'} Save a checkpoint first if you want to preserve the current branch.`))return;
 requestId++;worker?.terminate();worker=null;clearTimeout(rebuildTimer);generating=false;
 workspace.locked=workspace.locked.slice(0,stage-1);
 workspace.working={stage,settings:structuredClone(earlier.settings),data:structuredClone(earlier.data),dataSettings:structuredClone(earlier.settings)};dirty=false;
 workspace.viewStage=stage;selectedId=null;
 void persist();rebuildUI();notice(`Layer ${stage} is editable again`);
}
function rgb(r,g,b){return `rgb(${r|0},${g|0},${b|0})`;}
function gradient(value,stops){const t=clamp(value,0,1);for(let i=1;i<stops.length;i++)if(t<=stops[i][0]){const [at,a]=stops[i-1],[bt,b]=stops[i],v=(t-at)/(bt-at);return rgb(...a.map((x,k)=>x+(b[k]-x)*v));}return rgb(...stops[stops.length-1][1]);}
const heightColors=[[0,[24,54,83]],[.30,[43,104,130]],[.43,[138,157,153]],[.52,[110,145,116]],[.64,[172,168,124]],[.78,[137,115,95]],[1,[232,236,231]]];
const landColors=[[0,[54,99,83]],[.38,[76,121,81]],[.57,[119,140,92]],[.72,[166,146,105]],[.88,[157,145,130]],[1,[234,235,223]]];
function colorForCell(i,stage,display){
 const mesh=latestData(1)||workspace.working.data,plates=latestData(2),heights=latestData(3),coasts=latestData(4);
 const elev=heights?.elevations[i]??0;
 if(display==='geometry'||stage===1){const h=((i*137.508)%360);return `hsl(${150+(h%55)},${18+(i%4)*2}%,${36+(i%7)*3}%)`;}
 if((display==='plates'||stage===2)&&plates){const owner=plates.owners[i],plate=plates.plates[owner],h=(owner*137.508+22)%360;return `hsl(${h},${plate.continental?32:42}%,${plate.continental?49:34}%)`;}
 if((display==='height'||stage===3)&&heights)return gradient((elev+1.5)/3,heightColors);
 if((display==='coast'||stage===4)&&coasts&&heights){const sea=coasts.seaLevel;return coasts.water[i]?gradient(clamp(.36+(elev-sea)*.7,0,1),[[0,[24,54,74]],[1,[61,116,146]]]):gradient(clamp((elev-sea)*1.6,0,1),landColors);}
 return 'rgb(54,99,83)';
}
function displayMode(stage){const mode=workspace.viewMode;return mode==='auto'||mode==='natural'?'auto':mode;}
function paint(){renderPending=false;if(!canvas||!ctx)return;
 const rect=canvas.getBoundingClientRect(),width=rect.width,height=rect.height,dpr=canvas.width/Math.max(1,width);
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#11232b';ctx.fillRect(0,0,width,height);
 const stage=effectiveStage(),mesh=latestData(1)||((stage===1)?workspace.working.data:null);
 if(!mesh?.cells)return;
 ctx.save();ctx.setTransform(dpr*view.scale,0,0,dpr*view.scale,dpr*view.x,dpr*view.y);
 const explicit=displayMode(stage);
 const mode=explicit==='auto'?(stage===1?'geometry':stage===2?'plates':stage===3?'height':'coast'):explicit;
 // Hide overlays that require layers which do not exist at the selected stage.
 const allowed=(mode==='plates'&&stage<2)||(mode==='height'&&stage<3)||(mode==='coast'&&stage<4)?'geometry':mode;
 const stroke=workspace.showEdges,points=mesh.cells;
 const bounds={x0:Math.max(0,-view.x/view.scale),y0:Math.max(0,-view.y/view.scale),x1:Math.min(WORLD_WIDTH,(width-view.x)/view.scale),y1:Math.min(WORLD_HEIGHT,(height-view.y)/view.scale)};
 for(let i=0;i<points.length;i++){
  const c=points[i],p=c.poly;if(c.x<bounds.x0-100||c.x>bounds.x1+100||c.y<bounds.y0-100||c.y>bounds.y1+100)continue;
  ctx.beginPath();ctx.moveTo(p[0],p[1]);for(let k=2;k<p.length;k+=2)ctx.lineTo(p[k],p[k+1]);ctx.closePath();
  ctx.fillStyle=colorForCell(i,stage,allowed);ctx.fill();
  if(stroke){ctx.strokeStyle='rgba(5,20,28,.31)';ctx.lineWidth=.55/view.scale;ctx.stroke();}
 }
 if(selectedId!==null&&points[selectedId]){
  const p=points[selectedId].poly;ctx.beginPath();ctx.moveTo(p[0],p[1]);for(let k=2;k<p.length;k+=2)ctx.lineTo(p[k],p[k+1]);ctx.closePath();ctx.strokeStyle='#f8d47e';ctx.lineWidth=3/view.scale;ctx.stroke();
 }
 ctx.restore();
 const worldDisplay=worldToScreen(WORLD_WIDTH,0).x-worldToScreen(0,0).x;
 const scaleText=root.querySelector('#wg-map-scale');if(scaleText)scaleText.textContent=`${Math.round(WORLD_WIDTH/Math.max(worldDisplay,1)*100)} units / 100 px · ${shortNumber(points.length)} cells`;
}
function schedulePaint(){if(!renderPending){renderPending=true;requestAnimationFrame(paint);}}
function resizeCanvas(){if(!canvas)return;const rect=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.floor(rect.width*dpr)),h=Math.max(1,Math.floor(rect.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}schedulePaint();}
function fitMap(){if(!canvas)return;const {width,height}=canvas.getBoundingClientRect();if(!width||!height)return;view.scale=Math.min(width/WORLD_WIDTH,height/WORLD_HEIGHT)*.965;view.x=(width-WORLD_WIDTH*view.scale)/2;view.y=(height-WORLD_HEIGHT*view.scale)/2;firstFit=false;schedulePaint();}
function worldToScreen(x,y){return{x:x*view.scale+view.x,y:y*view.scale+view.y};}
function screenToWorld(x,y){return{x:(x-view.x)/view.scale,y:(y-view.y)/view.scale};}
function zoomBy(factor,x,y){const p=screenToWorld(x,y);view.scale=clamp(view.scale*factor,0.07,8);view.x=x-p.x*view.scale;view.y=y-p.y*view.scale;schedulePaint();}
function pickCell(x,y){const mesh=latestData(1)||workspace.working.data;if(!mesh?.cells)return null;const p=screenToWorld(x,y);if(p.x<0||p.y<0||p.x>WORLD_WIDTH||p.y>WORLD_HEIGHT)return null;
 // Closest Voronoi site owns this point; stable even at exact shared edges.
 let closest=-1,d2=Infinity;for(let i=0;i<mesh.cells.length;i++){const c=mesh.cells[i],score=(p.x-c.x)**2+(p.y-c.y)**2;if(score<d2){d2=score;closest=i;}}
 return closest;
}
function updateInspector(){const panel=root.querySelector('#wg-inspector');if(!panel)return;
 if(selectedId===null){panel.hidden=true;return;}
 const c=(latestData(1)||workspace.working.data)?.cells?.[selectedId];if(!c){panel.hidden=true;return;}
 const stage=effectiveStage(),plate=latestData(2),elevation=latestData(3),sea=latestData(4),details=[`Position ${Math.round(c.x)}, ${Math.round(c.y)}`,`${c.neighbors.length} neighboring cells`];
 if(stage>=2&&plate){const p=plate.plates[plate.owners[selectedId]];details.push(`Plate ${p.id+1} · ${p.continental?'continental':'oceanic'} crust`);}
 if(stage>=3&&elevation)details.push(`Relative elevation: ${elevation.elevations[selectedId].toFixed(3)}`);
 if(stage>=4&&sea)details.push(sea.water[selectedId]?'Ocean cell':'Land cell');
 panel.hidden=false;panel.innerHTML=`<button class="wg-inspector-close" data-action="close-inspector" aria-label="Close inspection">×</button><strong>Cell ${selectedId+1}</strong>${details.map(s=>`<span>${escapeHTML(s)}</span>`).join('')}`;
}
function canvasPoint(event){const r=canvas.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top};}
function pointerStart(event){if(event.button!==0&&event.pointerType==='mouse')return;const p=canvasPoint(event);canvas.setPointerCapture(event.pointerId);movePointers.set(event.pointerId,p);panMoved=false;if(movePointers.size===1){gesture={kind:'pan',origin:p};}else if(movePointers.size>=2){const [a,b]=[...movePointers.values()];gesture={kind:'pinch',dist:Math.hypot(a.x-b.x,a.y-b.y),mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};}}
function pointerMove(event){if(!movePointers.has(event.pointerId))return;const next=canvasPoint(event),before=movePointers.get(event.pointerId);movePointers.set(event.pointerId,next);
 if(movePointers.size===1&&gesture?.kind==='pan'){const dx=next.x-before.x,dy=next.y-before.y;view.x+=dx;view.y+=dy;if(Math.abs(next.x-gesture.origin.x)+Math.abs(next.y-gesture.origin.y)>5)panMoved=true;schedulePaint();}
 else if(movePointers.size>=2){const [a,b]=[...movePointers.values()],distance=Math.max(.1,Math.hypot(a.x-b.x,a.y-b.y)),middle={x:(a.x+b.x)/2,y:(a.y+b.y)/2};if(gesture?.kind==='pinch'){const ratio=clamp(distance/Math.max(gesture.dist,.1),.5,2);zoomBy(ratio,gesture.mid.x,gesture.mid.y);view.x+=middle.x-gesture.mid.x;view.y+=middle.y-gesture.mid.y;gesture={kind:'pinch',dist:distance,mid:middle};}panMoved=true;schedulePaint();}
}
function pointerEnd(event){if(!movePointers.has(event.pointerId))return;const position=canvasPoint(event);movePointers.delete(event.pointerId);if(!movePointers.size){if(!panMoved&&gesture?.kind==='pan'){selectedId=pickCell(position.x,position.y);updateInspector();schedulePaint();}gesture=null;}else{gesture={kind:'pan',origin:[...movePointers.values()][0]};panMoved=true;}}
function downloadText(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
async function doExport(){const full=structuredClone(workspace);full.exportedAt=new Date().toISOString();const through=workspace.locked.length+(workspace.working.data?1:0);downloadText(JSON.stringify(full),`${workspace.name.replace(/[^a-z0-9_-]+/gi,'-').toLowerCase()||'world'}-stage${through}-worldgen.json`);notice('Complete world file exported');}
function snapshotStage(){return workspace.locked.length+(workspace.working.data?1:0);}
function snapshotName(){return `${workspace.name} — through layer ${snapshotStage()}`;}
async function saveCheckpoint(){
 if(!snapshotStage()){notice('Generate at least one layer to create a checkpoint',true);return;}
 const proposed=prompt('Checkpoint name',snapshotName());if(proposed===null)return;
 const name=proposed.trim().slice(0,100)||snapshotName();
 const snap={id:`save-${Date.now()}-${Math.round(Math.random()*10000)}`,name,created:new Date().toISOString(),stage:snapshotStage(),world:structuredClone(workspace)};
 snapshots.unshift(snap);try{await saveSnapshots();notice(`Checkpoint saved: ${name}`);}catch(error){snapshots=snapshots.filter(s=>s.id!==snap.id);throw Error(`Checkpoint could not be saved: ${error.message}`);}
}
function modal(html){root.querySelector('#wg-modal-host').innerHTML=`<div class="wg-modal-backdrop"><section class="wg-modal" role="dialog" aria-modal="true" aria-label="World library"><div class="wg-modal-heading"><h2>World library</h2><button class="wg-icon-button" data-action="close-modal" aria-label="Close">×</button></div>${html}</section></div>`;activeModal=true;}
function showLibrary(){
 modal(`<p class="wg-modal-caption">Automatic caching keeps your current work. Named checkpoints preserve full, independent world states.</p><div class="wg-library-actions"><button data-action="new-world">+ New world</button><button data-action="import">Import JSON</button><button data-action="export">Export current</button></div><h3>Saved checkpoints <span>${snapshots.length}</span></h3><div class="wg-snapshot-list">${snapshots.length?snapshots.map(s=>`<div class="wg-snapshot"><div><strong>${escapeHTML(s.name)}</strong><small>${escapeHTML(new Date(s.created).toLocaleString())} · Layer ${s.stage}</small></div><div><button data-action="restore" data-id="${escapeHTML(s.id)}">Open</button><button class="wg-delete" data-action="delete" data-id="${escapeHTML(s.id)}" aria-label="Delete checkpoint">×</button></div></div>`).join(''):'<p class="wg-hint">No checkpoints yet. Lock a layer, then tap Save.</p>'}</div><p class="wg-modal-caption">Exports include all locked layers, working data, settings, seeds, and generated geometry. Your world stays on this device unless you export it.</p>`);
}
function closeModal(){root.querySelector('#wg-modal-host').innerHTML='';activeModal=false;}
function changeWorld(world){requestId++;worker?.terminate();worker=null;clearTimeout(rebuildTimer);generating=false;workspace=validateWorld(world);dirty=!!(workspace.working.data&&workspace.working.dataSettings&&JSON.stringify(workspace.working.settings)!==JSON.stringify(workspace.working.dataSettings));selectedId=null;firstFit=true;void persist();closeModal();rebuildUI();requestAnimationFrame(()=>fitMap());if(currentStage()<=IMPLEMENTED&&(!workspace.working.data||dirty))scheduleGeneration(150);}
async function handleImport(file){if(!file)return;try{if(file.size>60*1024*1024)throw Error('Files over 60 MB are not supported');const parsed=JSON.parse(await file.text());validateWorld(parsed);if(!confirm(`Load '${parsed.name}'? Your current working state will be replaced. Export or save a checkpoint first to preserve it.`))return;changeWorld(parsed);notice('Complete world imported');}catch(error){notice(`Import failed: ${error.message}`,true);}finally{root.querySelector('#wg-import').value='';}}
async function handleAction(action,button){
 switch(action){
  case 'home':{await persist();if(host?.returnToLauncher)host.returnToLauncher();else showLibrary();break;}
  case 'save':await saveCheckpoint();break;
  case 'library':showLibrary();break;
  case 'close-modal':closeModal();break;
  case 'close-inspector':selectedId=null;updateInspector();schedulePaint();break;
  case 'fit':fitMap();break;
  case 'zoom-in':zoomBy(1.45,canvas.clientWidth/2,canvas.clientHeight/2);break;
  case 'zoom-out':zoomBy(1/1.45,canvas.clientWidth/2,canvas.clientHeight/2);break;
  case 'reroll':workspace.working.settings.seed=nextSeed();dirty=true;void persist();rebuildUI();scheduleGeneration(20);break;
  case 'regenerate':scheduleGeneration(10);break;
  case 'lock':commitLayer();break;
  case 'edit-earlier':reviseStage(viewStage());break;
  case 'rename':{const name=prompt('World name',workspace.name);if(name!==null&&name.trim()){workspace.name=name.trim().slice(0,80);void persist();rebuildUI();}break;}
  case 'export':await doExport();break;
  case 'import':root.querySelector('#wg-import').click();break;
  case 'new-world':if(confirm('Create a new world? Your current working world will be replaced. Save a checkpoint or export it first if needed.'))changeWorld(newWorld());break;
  case 'restore':{const saved=snapshots.find(s=>s.id===button.dataset.id);if(saved&&confirm(`Open checkpoint '${saved.name}'? This replaces your current working world.`)){changeWorld(structuredClone(saved.world));notice('Checkpoint restored');}break;}
  case 'delete':{const saved=snapshots.find(s=>s.id===button.dataset.id);if(saved&&confirm(`Delete checkpoint '${saved.name}'?`)){snapshots=snapshots.filter(s=>s.id!==saved.id);await saveSnapshots();showLibrary();}break;}
 }
}
function bindEvents(){
 root.addEventListener('click',event=>{
  const stageBtn=event.target.closest('[data-stage]');if(stageBtn&&!stageBtn.disabled){workspace.viewStage=Number(stageBtn.dataset.stage);selectedId=null;void persist();rebuildUI();return;}
  const actionBtn=event.target.closest('[data-action]');if(actionBtn){event.preventDefault();void handleAction(actionBtn.dataset.action,actionBtn).catch(e=>notice(e.message,true));}
 });
 root.addEventListener('input',event=>{
  const el=event.target,setting=el.dataset?.setting;
  if(!setting)return;
  workspace.working.settings[setting]=el.type==='range'?Number(el.value):el.value;dirty=true;void persist();showBusy(generating);
  const output=root.querySelector(`[data-value="${setting}"]`);
  if(output)output.textContent=setting==='continental'||setting==='land'?`${Math.round(Number(el.value)*100)}%`:el.value;
  scheduleGeneration(el.type==='range'?380:80);
 });
 root.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='wg-edges'){workspace.showEdges=el.checked;void persist();schedulePaint();}
  if(el.id==='wg-palette'){workspace.viewMode=el.value==='natural'?'auto':el.value;void persist();schedulePaint();}
  if(el.id==='wg-seed'){workspace.working.settings.seed=clamp(Number(el.value)||0,0,0xffffffff);dirty=true;void persist();showBusy(generating);scheduleGeneration(40);}
  if(el.id==='wg-import')void handleImport(el.files?.[0]);
 });
 canvas.addEventListener('pointerdown',pointerStart);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerEnd);canvas.addEventListener('pointercancel',pointerEnd);
 canvas.addEventListener('wheel',event=>{event.preventDefault();const p=canvasPoint(event);zoomBy(event.deltaY<0?1.14:1/1.14,p.x,p.y);},{passive:false});
 canvas.addEventListener('dblclick',event=>{const p=canvasPoint(event);zoomBy(1.5,p.x,p.y);});
 addEventListener('resize',resizeCanvas);
 if('ResizeObserver' in globalThis)new ResizeObserver(resizeCanvas).observe(canvas);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void persist();});
}
async function initialize(){
 try{const [stored,saved]=await Promise.all([storeGet(KEY),storeGet('snapshots')]);if(stored)workspace=validateWorld(stored);if(Array.isArray(saved))snapshots=saved.filter(s=>s?.world?.schema===SCHEMA_VERSION);}
 catch(error){console.warn('WorldGen startup storage:',error);storageHealthy=false;}
 dirty=!!(workspace.working.data&&workspace.working.dataSettings&&JSON.stringify(workspace.working.settings)!==JSON.stringify(workspace.working.dataSettings));
 buildShell();if(currentStage()<=IMPLEMENTED&&(!workspace.working.data||dirty))scheduleGeneration(100);
}
await initialize();
