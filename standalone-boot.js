if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(error=>console.warn('Offline cache unavailable:',error));
}
await import('./app.js');
