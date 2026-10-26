import {createServer} from '../../frontend/node_modules/vite/dist/node/index.js';
import path from 'node:path';
const server=await createServer({root:path.resolve(process.env.LINT_ROOT||'frontend'),server:{host:'127.0.0.1',port:5194,strictPort:true,forwardConsole:false},optimizeDeps:{force:true}});
await server.listen();server.printUrls();
