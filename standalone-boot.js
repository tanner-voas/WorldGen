import {registerStandaloneWorker} from './browser-host.js';
registerStandaloneWorker({onError:error=>console.warn('Offline cache unavailable:',error)});
await import('./app.js');
