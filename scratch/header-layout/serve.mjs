import {createServer} from '../../frontend/node_modules/vite/dist/node/index.js';
const server=await createServer({root:new URL('../../frontend',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'),server:{host:'127.0.0.1',port:5197,strictPort:true,forwardConsole:false},optimizeDeps:{force:true}});
await server.listen();server.printUrls();
