#!/usr/bin/env python3
"""Browser-level WorldGen smoke run when navigation is blocked by the runner.

This uses actual headless Chromium for DOM, CSS, input events and canvas. The
runner prohibits localhost/file/HTTPS navigation, so we load exactly the
project's ESM source modules as Blob URLs into an about:blank page. IndexedDB
and Web Workers are bridged *only in this test* to equivalent in-memory
asynchronous shims; the normal app is not modified. Browser WebGL2 is not
available in this restricted environment, so the 3D control is checked as DOM
behavior; terrain generation and its GPU model have separate Node tests.

Run: python3 tests/browser-smoke.py
Requires Python Playwright and a local chromium executable.
"""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.getenv('WORLDGEN_SCREENSHOTS', '/tmp/worldgen-browser-smoke'))
OUT.mkdir(parents=True, exist_ok=True)
SOURCES = {p.name:p.read_text() for p in (ROOT/'src').glob('*.js')}
CSS = (ROOT/'src/styles.css').read_text()

SHIM = r"""(() => {
 const records = new Map();
 const copy=v=>v===undefined?undefined:structuredClone(v);
 const database={
   objectStoreNames:{contains:()=>true},createObjectStore(){},close(){},
   transaction(){
     let pending=0, aborted=false, done=false;
     const tx={oncomplete:null,onerror:null,onabort:null,error:null,objectStore:()=>store,
       abort(){aborted=true;this.onabort?.();}};
     function finish(){setTimeout(()=>{if(!pending&&!aborted&&!done){done=true;tx.oncomplete?.();}},0);}
     function request(op){
       pending++; const req={onsuccess:null,onerror:null,result:undefined};
       setTimeout(()=>{
         try{req.result=op();req.onsuccess?.();}catch(e){tx.error=e;req.onerror?.();tx.onerror?.();}
         pending--;finish();
       },0);return req;
     }
     const store={
       get:k=>request(()=>copy(records.get(k))),
       count:k=>request(()=>Number(records.has(k))),
       put:(v,k)=>request(()=>{records.set(k,copy(v));return k;}),
       delete:k=>request(()=>{records.delete(k);})
     };
     return tx;
   }
 };
 Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){
   const req={result:database,onsuccess:null,onerror:null,onupgradeneeded:null};
   setTimeout(()=>{req.onupgradeneeded?.();req.onsuccess?.();},0);
   return req;
 }}});
 window.__browserSmokeErrors=[];
 window.addEventListener('error',e=>window.__browserSmokeErrors.push(String(e.message||e.error)));
 window.addEventListener('unhandledrejection',e=>window.__browserSmokeErrors.push(String(e.reason)));
 class FakeWorker {
   constructor(url){this.url=String(url);this.onmessage=null;this.onerror=null;this.disposed=false;}
   terminate(){this.disposed=true;}
   postMessage(message){
     setTimeout(()=>{
       if(this.disposed)return;
       try {
         if(this.url!=='worldgen-smoke-compute'){this.onmessage?.({data:{kind:'error',message:'No WebGL2 in browser smoke runner'}});return;}
         const data=window.__browserSmokeEngine.generateStage(message.stage,message.locked,message.settings,progress=>{
            if(!this.disposed)this.onmessage?.({data:{id:message.id,progress}});
         });
         if(!this.disposed)this.onmessage?.({data:{id:message.id,ok:true,data}});
       }catch(e){if(!this.disposed)this.onmessage?.({data:{id:message.id,ok:false,error:String(e)}});}
     },0);
   }
 }
 Object.defineProperty(window,'Worker',{value:FakeWorker,configurable:true});
})()"""

MODULE_LOADER = r"""async sources => {
 const built = new Map();
 function build(name){
   if(built.has(name))return built.get(name);
   let source = sources[name];
   if(!source)throw Error('Missing module '+name);
   if(name==='app.js')source=source.replaceAll("new Worker(new URL('./compute-worker.js',import.meta.url),{type:'module'})", "new Worker('worldgen-smoke-compute',{type:'module'})");
   if(name==='terrain-3d.js')source=source.replaceAll("new URL('./terrain-3d-worker.js',import.meta.url)","'worldgen-smoke-3d'");
   source=source.replace(/(from\s*['"])(\.\/[^'"]+\.js)(['"])/g,(_m,prefix,file,suffix)=>prefix+build(file.slice(2))+suffix);
   const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
   built.set(name,url);return url;
 }
 window.__browserSmokeEngine=await import(build('engine.js'));
 await import(build('app.js'));
 return {title:document.title,host:!!document.querySelector('.wg-shell')};
}"""


def run():
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.getenv('CHROMIUM','/usr/bin/chromium'),
      headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
  context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,service_workers='block')
  page=context.new_page()
  page.set_default_timeout(12000)
  page.set_content('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div></body></html>')
  page.add_style_tag(content=CSS)
  page.evaluate(SHIM)
  started=page.evaluate(MODULE_LOADER,SOURCES)
  assert started['host'],started
  print('Started:',started)
  page.locator('#wg-stage-main').wait_for()
  # Exercise a realistic mobile workflow through all 13 layers, including
  # revising settings from multiple presets before locking each result.
  for stage in range(1,14):
   if stage>1:
    page.wait_for_function("stage => document.querySelector('.wg-layer-label')?.textContent.includes('LAYER '+String(stage).padStart(2,'0'))",arg=stage)
   select=page.locator('#wg-preset');select.wait_for()
   options=select.locator('option').evaluate_all('(els)=>els.map(e=>e.value).filter(Boolean)')
   assert len(options)>=3, (stage,options)
   choice=({'1':'regional','2':'coarse','3':'few','4':'mountains','5':'exposed','6':'balanced',
       '7':'alpine','8':'pristine','9':'rainforest','10':'rivers','11':'fertile','12':'forested','13':'old'}
       .get(str(stage),options[0]))
   if stage>=7:
    alternate=options[-1] if options[-1]!=choice else options[0]
    select.select_option(alternate)
    page.wait_for_timeout(240)
   select.select_option(choice)
   assert len(page.locator('#wg-preset-description').inner_text())>30
   if stage>=7:
    fine=page.locator('.wg-fine-tune')
    assert fine.count()==1
    fine.locator('summary').click()
    assert fine.evaluate('(e)=>e.open')
    if stage==7:
     page.locator('[data-slider="ridge"]').evaluate("el => {el.value='1.4';el.dispatchEvent(new Event('input',{bubbles:true}));}")
     assert page.locator('#wg-preset').input_value()==''
   page.wait_for_function("() => !document.querySelector('#wg-status')?.textContent.includes('Generating')",timeout=20000)
   # Generation completion is marked by enabled panel action and saved preview.
   page.wait_for_function("() => {const b=document.querySelector('.wg-panel-lock');return b&&!b.disabled&&document.querySelector('#wg-status')?.textContent.includes('Cached')}",timeout=20000)
   if stage in [2,7,9,13]:page.screenshot(path=str(OUT/f'worldgen-stage-{stage:02d}.png'))
   if stage==4:
    page.locator('[data-action="render"]').click()
    page.locator('#wg-3d-height-panel').wait_for(state='attached')
    page.locator('[data-action="3d-height-toggle"]').click()
    height=page.locator('#wg-3d-height-value');height.fill('15.37');height.press('Tab')
    assert '15.37' in page.locator('#wg-3d-height-summary').inner_text()
    page.locator('[data-action="close-modal"]').click()
    page.locator('[data-action="render"]').click()
    assert abs(float(page.locator('#wg-3d-height-value').input_value())-15.37)<1e-6
    page.locator('[data-action="close-modal"]').click()
   if stage==9:
    page.locator('[data-action="render"]').click()
    assert abs(float(page.locator('#wg-3d-height-value').input_value())-15.37)<1e-6
    page.locator('[data-action="close-modal"]').click()
   page.locator('.wg-panel-lock').click()
   print('Browser stage',stage,'preset',choice,'locked')
  errors=page.evaluate('window.__browserSmokeErrors')
  assert not errors,errors
  print('Browser errors:',errors,'screenshots:',OUT)
  browser.close()

if __name__=='__main__':run()
