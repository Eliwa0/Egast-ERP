import json,sys,hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
fixture_source=ROOT/'scratch/handover-current-review/visual.py'
sys.argv=['header','after'];namespace={'__file__':str(fixture_source)}
exec(compile(fixture_source.read_text(encoding='utf-8').split('with sync_playwright() as p:')[0],str(fixture_source),'exec'),namespace)
origin='http://127.0.0.1:5200';namespace['origin']=origin;results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
 for lang in ['en','ar']:
  for width in [320,768,1024,1101,1280,1440,1920]:
   for route in ['/customization-delivery/quotations','/customization-delivery/orders']:
    context=browser.new_context(viewport={'width':width,'height':900});calls=[];errors=[]
    context.add_init_script('localStorage.setItem("app-lang",'+json.dumps(lang)+');localStorage.setItem("auth_user",'+json.dumps(json.dumps(namespace['user']))+');')
    context.route('**/api/**',lambda r:namespace['fixture'](r,calls));page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(origin+route);page.wait_for_load_state('networkidle');page.evaluate('document.fonts.ready')
    def measure():return page.evaluate('''()=>{const toolbar=document.querySelector('.app-toolbar'),brand=document.querySelector('.app-brand'),actions=document.querySelector('.app-toolbar__actions');return {height:toolbar.getBoundingClientRect().height,brand:brand.getBoundingClientRect().toJSON(),actions:actions.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth+1}}''')
    normal=measure()
    page.locator('.breadcrumb__link,.breadcrumb__current').evaluate_all('(nodes)=>nodes.forEach(n=>n.textContent=(n.textContent+" ").repeat(20))')
    long=measure();assert not long['overflow'],(lang,width,route,long)
    if width>=769:
     assert abs(normal['height']-long['height'])<1,(normal,long)
     if width>=1101:assert long['actions']['y']<long['brand']['bottom'] and long['actions']['bottom']>long['brand']['y'],long
     assert long['actions']['right']<=width+1 and long['actions']['left']>=-1,long
     page.locator('.toolbar-review-menu--review > button').first.hover()
     menu=page.locator('.toolbar-review-menu--review > .toolbar-review-menu__list')
     expect(menu).to_be_visible()
     bounds=menu.bounding_box();assert bounds['x']>=-1 and bounds['x']+bounds['width']<=width+1,bounds
    else:
     expect(page.locator('.mobile-nav-toggle')).to_be_visible()
    if width in [320,1440]:page.screenshot(path=str(OUT/f'{lang}-{width}-{route.split("/")[-1]}.png'),full_page=False)
    assert not errors,errors
    results.append({'language':lang,'width':width,'route':route,'normal':normal,'long':long,'page_errors':errors})
    (OUT/'results.json').write_text(json.dumps({'completed':False,'cases':results},indent=2))
    context.close()
 browser.close()
css=ROOT/'frontend/src/styles/pages/sales-readiness.css'
(OUT/'results.json').write_text(json.dumps({'completed':True,'cases':results,'css_sha256':hashlib.sha256(css.read_bytes()).hexdigest()},indent=2))
print('PASS',len(results),'header cases; desktop height stable, menu within viewport, mobile toggle preserved.')
