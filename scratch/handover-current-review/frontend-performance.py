"""Warm Vite+fixture screen/read timings, not production SAP or pure React CPU."""
import json,sys,time,statistics,math
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
OUT=Path(__file__).resolve().parent;source=OUT/'visual.py';sys.argv=['profile','after'];ns={'__file__':str(source)}
exec(compile(source.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],str(source),'exec'),ns)
results=[]
def stats(values):return {'mean_ms':round(statistics.mean(values),2),'median_ms':round(statistics.median(values),2),'p95_ms':round(sorted(values)[math.ceil(len(values)*.95)-1],2)}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
 for route in ['/customization-delivery/quotations','/customization-delivery/orders','/customization-delivery/deliveries','/shipping-loading']:
  context=browser.new_context(viewport={'width':1440,'height':900});calls=[];errors=[]
  context.add_init_script('localStorage.setItem("app-lang","en");localStorage.setItem("app-theme","light");localStorage.setItem("auth_user",'+json.dumps(json.dumps(ns['user']))+');')
  context.route('**/api/**',lambda r:ns['fixture'](r,calls));page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  times=[];request_times=[];counts=[]
  for sample in range(31):
   calls.clear();started=time.perf_counter();page.goto(ns['origin']+route,wait_until='domcontentloaded')
   expect(page.locator('main').get_by_text('Fixture Customer',exact=False).first).to_be_visible()
   page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
   visible=(time.perf_counter()-started)*1000
   page.wait_for_load_state('networkidle')
   entries=page.evaluate('performance.getEntriesByType("resource").filter(e=>e.name.includes("/api/")).map(e=>e.duration)')
   assert not errors,errors
   if sample:
    times.append(visible);request_times.extend(entries);counts.append(len(calls))
  results.append({'route':route,'samples':30,'warmup_excluded':1,'viewport':[1440,900],'language':'en','theme':'light','screen_data_visible_includes_navigation_and_two_frames':stats(times),'fixture_http_resource_duration':stats(request_times),'requests_per_navigation':sorted(set(counts)),'page_errors':errors,'sap_ms':None,'pure_react_cpu_ms':None})
  (OUT/'frontend-performance.json').write_text(json.dumps({'completed':False,'environment':'local Vite, intercepted HTTP, warm browser cache; not production timing','rows':results},indent=2));context.close()
 browser.close()
(OUT/'frontend-performance.json').write_text(json.dumps({'completed':True,'environment':'local Vite, intercepted HTTP, warm browser cache; not production timing','rows':results},indent=2))
print('PASS: 4 routes, 30 measured + 1 excluded warmup each; all HTTP fixtures.')
