// Lock browser page magnification, not in-app canvas/map zoom.
(()=>{
 const options={passive:false,capture:true};
 const prevent=e=>{if(e.cancelable)e.preventDefault();};
 for(const event of ['gesturestart','gesturechange','gestureend'])document.addEventListener(event,prevent,options);
 document.addEventListener('wheel',e=>{if(e.ctrlKey)prevent(e);},options);
 // Safari may ignore the viewport maximum. Cancel the default action only
 // for multitouch; do not stop propagation to custom pointer handlers.
 document.addEventListener('touchmove',e=>{if(e.touches?.length>1)prevent(e);},options);
 // touch-action:manipulation disables double-tap zoom on ordinary controls.
})();
