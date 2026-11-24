// v0.2.6: standalone PWA update flow; hosted mode uses AppLauncher’s updater.
// An installing worker may activate automatically (skipWaiting in sw.js), so
// "installed"/"waiting" must NOT be the only signals that allow a reload.

export function withTimeout(work, milliseconds, description){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`${description} timed out. Check your connection and try again.`)),milliseconds);
    Promise.resolve(work).then(
      value=>{clearTimeout(timer);resolve(value);},
      error=>{clearTimeout(timer);reject(error);}
    );
  });
}

export function waitForActivation(worker, service, milliseconds=20000){
  return new Promise((resolve,reject)=>{
    let finished=false;
    let activationTimer;
    const onMessage=event=>{if(event.data?.type==='offline-update-blocked')finish(new Error('Close other app windows before installing this update.'));};
    const finish=error=>{
      if(finished)return;
      finished=true;
      clearTimeout(timer);clearTimeout(activationTimer);
      worker.removeEventListener?.('statechange',check);
      service.removeEventListener?.('controllerchange',check);
      service.removeEventListener?.('message',onMessage);
      error?reject(error):resolve();
    };
    const check=()=>{
      if(worker.state==='redundant'){
        finish(new Error('Update installation failed. Your existing app is safe.'));
      }else if(worker.state==='installed'){
        // Workers from an earlier version may still require an activation request.
        worker.postMessage?.('activate-update');
      }else if(worker.state==='activated'){
        // Activation may precede clients.claim/controllerchange on WebKit.
        // Allow the controller time to swap, but never wait indefinitely.
        if(!service.controller||service.controller===worker)finish();
        else if(!activationTimer)activationTimer=setTimeout(()=>finish(),1500);
      }
    };
    const timer=setTimeout(()=>finish(new Error('Update installation timed out. Try again.')),milliseconds);
    worker.addEventListener?.('statechange',check);
    service.addEventListener?.('controllerchange',check);
    service.addEventListener?.('message',onMessage);
    check();
  });
}

export async function checkForUpdatesAndReload({
  navigatorRef=globalThis.navigator,
  locationRef=globalThis.location,
  onStatus=()=>{},
  timeoutMs=120000
}={}){
  if(navigatorRef?.onLine===false)throw new Error('Connect to the internet to check for updates.');
  const service=navigatorRef?.serviceWorker;
  if(service && typeof service.register==='function'){
    onStatus('Checking for updates…');
    const registration=await withTimeout(
      service.register('./sw.js',{updateViaCache:'none'}),timeoutMs,'Service worker registration'
    );
    // An older worker may already be waiting; always check for a newer one.
    await withTimeout(registration.update(),timeoutMs,'Update check');
    const pending=registration.waiting||registration.installing;
    if(pending&&pending.state!=='activated'){
      onStatus('Installing update…');
      await waitForActivation(pending,service,timeoutMs);
    }
  }
  onStatus('Reloading…');
  locationRef.reload(); // Reload the current standalone PWA.
}

export async function runUpdateButton(button,{onError=()=>{},...options}={}){
  if(button.disabled)return false;
  const previous=button.innerHTML;
  const originalLabel=button.getAttribute?.('aria-label');
  button.disabled=true;
  button.setAttribute?.('aria-busy','true');
  button.classList?.add('pwa-updating');
  try{
    await checkForUpdatesAndReload({
      ...options,
      onStatus:label=>{button.setAttribute?.('aria-label',label);options.onStatus?.(label);}
    });
    return true;
  }catch(error){
    onError(error?.message||String(error));
    return false;
  }finally{
    button.disabled=false;
    button.removeAttribute?.('aria-busy');
    button.classList?.remove('pwa-updating');
    if(originalLabel===null||originalLabel===undefined)button.removeAttribute?.('aria-label');
    else button.setAttribute?.('aria-label',originalLabel);
    button.innerHTML=previous;
  }
}
