import json,re
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
OUT=Path(__file__).resolve().parent;origin='http://127.0.0.1:5196'
user={'id':1,'username':'vendor-fixture','role':'admin','is_superuser':True}
drafts={str(i):{'id':i,'status':'DRAFT','vendor_card_code':('OLD' if i==41 else ''),'vendor_name':('Original Vendor' if i==41 else ''),'currency':'EGP','lines':[]} for i in [41,42]}
calls=[];held=[];errors=[];hold=False
def reply(route,payload):route.fulfill(content_type='application/json',headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,PUT,PATCH,OPTIONS'},body=json.dumps(payload))
def fixture(route):
 global hold
 r=route.request;path=urlparse(r.url).path
 if r.method=='OPTIONS':reply(route,{});return
 calls.append({'method':r.method,'path':path})
 if path.endswith('/me/'):reply(route,{'data':user});return
 for id in drafts:
  if path.endswith('/purchase-quotations/'+id+'/'):
   if r.method in ['PUT','PATCH']:drafts[id].update(r.post_data_json);reply(route,{'data':{'draft':drafts[id]}});return
   assert r.method=='GET'
   if hold:held.append((route,json.loads(json.dumps(drafts[id]))));return
   reply(route,{'data':{'draft':drafts[id]}});return
 assert r.method=='GET',('Blocked mutation',r.method,path)
 if path.endswith('/cost-centers/'):reply(route,{'cost_centers':[]});return
 if path.endswith('/currencies/'):reply(route,{'data':{'currencies':[{'code':'EGP'},{'code':'USD'}]}});return
 if any(path.endswith(s) for s in ['/farms/','/farm-list/','/item-groups/','/quotation-metadata/','/metadata/','/tax-codes/','/warehouses/','/batch-attributes/','/batch-udf-metadata/','/contractors/','/business-partners/']):reply(route,{'data':{},'farms':[],'item_groups':[],'field_options':{}});return
 raise AssertionError('Undeclared vendor fixture '+path)

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
 context=browser.new_context(viewport={'width':1280,'height':900});context.add_init_script('localStorage.setItem("auth_user",'+json.dumps(json.dumps(user))+');localStorage.setItem("app-lang","en");')
 context.route('**/api/**',fixture);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 def entry(route):
  response=route.fetch();html=re.sub(r'<script type="module" src="/src/main\.jsx[^"\n]*"></script>','<script type="module">import "/scripts/fixtures/purchase-vendor-lifecycle.jsx";</script>',response.text());route.fulfill(response=response,body=html)
 context.route('**/purchase-quotations/41',entry)
 page.goto(origin+'/purchase-quotations/41');page.wait_for_function('window.__vendorLifecycle?.code==="OLD" && !window.__vendorLifecycle.loading')
 count=lambda:sum(c['method']=='GET' and c['path'].endswith('/purchase-quotations/41/') for c in calls)
 assert count()==1,calls
 page.evaluate('window.__vendorLifecycle.select({code:"NEW",name:"Edited Vendor",currency:"USD"})')
 page.wait_for_function('window.__vendorLifecycle.code==="NEW" && window.__vendorLifecycle.currency==="USD"')
 page.wait_for_timeout(200);assert count()==1,'Vendor/currency edit must not reload draft'
 page.get_by_role('button',name='Refresh',exact=True).click();page.wait_for_function('!window.__vendorLifecycle.loading')
 assert count()==2 and page.evaluate('window.__vendorLifecycle.name')=='Edited Vendor'
 hold=True;page.evaluate('window.__vendorLifecycle.reload()');page.wait_for_timeout(150);assert len(held)==1
 page.evaluate('window.__vendorLifecycle.select({code:"LATEST",name:"Latest edit",currency:"USD"})')
 page.wait_for_function('window.__vendorLifecycle.code==="LATEST"')
 reply(held[0][0],{'data':{'draft':held[0][1]}});hold=False
 page.wait_for_function('!window.__vendorLifecycle.loading');assert page.evaluate('window.__vendorLifecycle.code')=='LATEST'
 assert count()==3
 # SPA route change with the same router, without creating or posting a document.
 page.evaluate('history.pushState({},"","/purchase-quotations/42");dispatchEvent(new PopStateEvent("popstate"))')
 page.wait_for_function('!window.__vendorLifecycle.loading && window.__vendorLifecycle.code===""')
 assert page.evaluate('window.__vendorLifecycle.name')==''
 assert sum(c['method']=='GET' and c['path'].endswith('/purchase-quotations/42/') for c in calls)==1
 assert not errors,errors
 browser.close()
(OUT/'vendor-lifecycle.json').write_text(json.dumps({'completed':True,'requests':calls,'errors':errors,'cases':['initial load','edit and rerender without extra GET','explicit refresh','in-flight stale vendor response','SPA draft switch without vendor leakage']},indent=2))
print('PASS: actual PurchaseQuotationDraftPage lifecycle, explicit test-only state observer; all HTTP intercepted.')
