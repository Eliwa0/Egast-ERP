import {createServer} from '../../frontend/node_modules/vite/dist/node/index.js';
import path from 'node:path';
const server=await createServer({root:path.resolve(process.env.REVIEW_ROOT||'frontend'),server:{host:'127.0.0.1',port:5200,strictPort:true,forwardConsole:false},optimizeDeps:{force:true},plugins:[{
 name:'isolated-vendor-lifecycle-observer',enforce:'pre',
 transform(code,id){
  if(id.endsWith('/pages/PurchaseQuotationDraftPage.jsx'))return code.replace('  if (loading) {',`  globalThis.__vendorLifecycle = {code:vendorCardCode,name:vendorName,currency,loading,select:handleSelectVendor,reload:loadDraftData};\n  if (loading) {`);
 }
}]});
await server.listen();server.printUrls();
