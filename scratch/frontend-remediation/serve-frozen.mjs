import { createServer } from '../../frontend/node_modules/vite/dist/node/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'frozen-final/frontend');
// Frozen test input never needs HMR. Keep console and pageerror assertions in tests;
// disable Vite's extra console-to-websocket relay, whose unconnected send recurses.
const server = await createServer({ root, configFile: path.join(root, 'vite.config.js'),
  server: { host: '127.0.0.1', port: 5192, strictPort: true, forwardConsole: false },
  optimizeDeps: { force: true } });
await server.listen();
server.printUrls();
