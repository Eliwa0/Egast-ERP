"""Actual routes, isolated declared fixtures; no business HTTP forwarded."""
import json,os,sys,time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
origin='http://127.0.0.1:5200';phase=sys.argv[1];results=[]
user={'id':1,'username':'visual-fixture','role':'admin','is_superuser':True}
line={'line_number':0,'item_code':'ITEM-1','item_description':'Fixture product','item_name':'Fixture product','quantity':100,'open_quantity':75,'remaining_open_quantity':75,'uom':'KG','warehouse_code':'WH'}
summary={'sales_order_doc_entry':2002,'sales_order_doc_num':'7002','customer_code':'C001','customer_name':'Fixture Customer / عميل تجريبي','ordered_quantity':100,'delivered_quantity':25,'remaining_open_quantity':75,'has_remaining':True,'items_summary':'Fixture product','lines':[line]}
draft={'id':41,'status':'DRAFT','is_local_creation':True,'quotation_doc_entry':1001,'quotation_doc_num':'5001','customer_code':'C001','customer_name':summary['customer_name'],'currency':'USD','lines':[dict(line,id=1,customized_quantity=100,customized_unit_price=25,is_selected=True)]}
operation={'id':10,'revision':0,'status':'WAITING','vehicle_number':'TRUCK-10','container_number':'CONT-10','containers':['CONT-10'],'pallets':[],'sales_order_doc_entry':None}
def fixture(route,calls):
 request=route.request;path=urlparse(request.url).path
 headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'*'}
 def reply(data):route.fulfill(content_type='application/json',headers=headers,body=json.dumps(data))
 if request.method=='OPTIONS':reply({});return
 calls.append((request.method,path))
 if request.method=='POST' and path.endswith('/shipping/operations/discover/'):reply({'success':True});return
 assert request.method=='GET',f'Blocked business mutation {request.method} {path}'
 if path.endswith('/me/'):reply({'data':user})
 elif path.endswith('/customization/drafts/'):reply({'drafts':[draft],'next_offset':None})
 elif path.endswith(('/customization-delivery/orders/','/delivery/eligible-orders/')):reply({'orders':[summary],'counts':{'total':1,'active':1,'completed':0},'next_offset':None})
 elif path.endswith('/delivery/drafts/'):reply({'drafts':[{'id':91,'status':'DRAFT','sales_order_doc_entry':2002,'sales_order_doc_num':'7002','customer_name':summary['customer_name'],'lines':[dict(line,id=51,delivery_quantity=25)]}]})
 elif path.endswith('/shipping/deliveries/'):reply({'operations':[],'next_offset':None})
 elif path.endswith('/shipping/operations/'):reply({'operations':[operation],'next_offset':None})
 elif path.endswith('/shipping/elements/'):reply({'elements':[]})
 elif path.endswith('/shipping/orders/'):reply({'orders':[{'doc_entry':2002,'doc_num':'7002','customer_name':summary['customer_name'],'lines':[line]}],'next_offset':None})
 elif path.endswith('/shipping/orders/2002/'):reply({'order':{'doc_entry':2002,'doc_num':'7002','customer_name':summary['customer_name'],'lines':[line]}})
 elif path.endswith('/shipping/operations/10/'):reply({'operation':operation})
 elif path.endswith(('/documents/1001/','/orders/documents/2002/','/delivery-documents/2002/')):reply({'document':{'document_entry':1001 if '/1001/' in path else 2002,'document_number':'5001' if '/1001/' in path else '7002','customer_code':'C001','customer_name':summary['customer_name'],'currency':'USD','document_status':'O','lines':[dict(line,unit_price=25,line_total=2500,ordered_quantity=100,delivered_quantity=25,remaining_open_quantity=75)]}})
 elif path.endswith('/cost-centers/'):reply({'cost_centers':[]})
 else:raise AssertionError('Undeclared fixture '+path)

routes=['/production','/quality','/customization-delivery/quotations','/customization-delivery/orders','/customization-delivery/deliveries','/shipping-loading']
if phase=='after':routes+=['/customization-delivery/quotations/documents/1001','/customization-delivery/orders/documents/2002','/customization-delivery/delivery/documents/2002']
if os.environ.get('VISUAL_ROUTES'):routes=os.environ['VISUAL_ROUTES'].split('|')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
 for lang in ['en','ar']:
  for theme in ['light','dark']:
   for width,height in [(320,640),(768,900),(1440,900)]:
    for route in routes:
     context=browser.new_context(viewport={'width':width,'height':height});calls=[];errors=[];warnings=[]
     context.add_init_script('localStorage.setItem("app-lang",'+json.dumps(lang)+');localStorage.setItem("app-theme",'+json.dumps(theme)+');localStorage.setItem("auth_user",'+json.dumps(json.dumps(user))+');')
     context.route('**/api/**',lambda r:fixture(r,calls))
     page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:warnings.append(m.text) if m.type in ['error','warning'] else None)
     page.goto(origin+route);page.wait_for_load_state('networkidle');page.evaluate('document.fonts.ready');page.wait_for_timeout(100)
     name=f'{phase}-{lang}-{theme}-{width}-{route.strip("/").replace("/","_")}'
     before_dom=page.locator('main').inner_text() if page.locator('main').count() else page.locator('body').inner_text()
     assert ('Fixture' in before_dom) if 'customization-delivery' in route or route=='/shipping-loading' else len(before_dom)>10
     if '/documents/' in route:
      document_table=page.locator('.cd-table').filter(has_text='ITEM-1').last
      expect(document_table).to_be_visible()
      expect(document_table.locator('tbody')).to_contain_text('ITEM-1')
     horizontal=page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
     metrics=page.evaluate('''()=>{const card=document.querySelector('main .card-panel,main .shipping-card');const header=document.querySelector('main .page-header');return {card:card?{radius:getComputedStyle(card).borderRadius,background:getComputedStyle(card).backgroundColor,border:getComputedStyle(card).borderColor}:null,header:header?getComputedStyle(header).gap:null,dir:document.documentElement.dir}}''')
     (OUT/'images').mkdir(exist_ok=True);page.screenshot(path=str(OUT/'images'/f'{name}.png'),full_page=True)
     snapshot_calls=list(calls)
     if phase=='after' and route=='/customization-delivery/deliveries':
      page.locator('.sales-document-toolbar__filters button').nth(3).click()
      expect(page.locator('.sales-document-card').filter(has_text='#91')).to_be_visible()
      assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
      page.screenshot(path=str(OUT/'images'/f'{name}-draft.png'),full_page=True)
     # Client-side search must retain the record and not create a document.
     if route=='/shipping-loading':
      page.locator('.shipping-cards .shipping-card').first.click();expect(page.locator('.shipping-card').filter(has_text='TRUCK-10')).to_be_visible()
      page.locator('.shipping-card').filter(has_text='TRUCK-10').click();expect(page.locator('select').filter(has=page.locator('option[value="CONT-10"]'))).to_be_visible()
      assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+1')
      page.screenshot(path=str(OUT/'images'/f'{name}-container.png'),full_page=True)
     assert not errors,errors
     assert not warnings,warnings
     if phase=='after':assert not horizontal,name
     assert all(method=='GET' or path.endswith('/shipping/operations/discover/') for method,path in calls)
     visible_buttons=page.locator('main button:visible').all_text_contents()
     results.append({'route':route,'lang':lang,'theme':theme,'width':width,'height':height,'horizontal_overflow':horizontal,'errors':errors,'console':warnings,'calls':calls,'initial_calls':snapshot_calls,'metrics':metrics,'visible_buttons':visible_buttons,'image':f'images/{name}.png'})
     (OUT/f'{phase}-visual.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
     context.close()
 browser.close()
print(json.dumps({'completed':True,'cases':len(results),'phase':phase}));
