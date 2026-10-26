"""Browser regression for direct-list offsets; fixture data, no SAP writes."""
import os
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe', headless=True)
    page = browser.new_page()
    page.goto(os.environ.get('SALES_FRONTEND_URL', 'http://127.0.0.1:5173'))
    page.wait_for_load_state('networkidle')
    page.on('pageerror', lambda error: print('Browser error:', error))
    page.evaluate("""async()=>{
      const R=await import('/node_modules/.vite/deps/react.js');const React=R.default||R;
      const C=await import('/node_modules/.vite/deps/react-dom_client.js');
      const source=await (await fetch('/src/pages/SalesDocumentListPage.jsx')).text();
      const routerUrl=source.match(/from ["']([^"']*react-router-dom[^"']*)["']/)[1];
      const {MemoryRouter}=await import(routerUrl);
      const {I18nProvider}=await import('/src/contexts/I18nContext.jsx');
      const {default:List}=await import('/src/pages/SalesDocumentListPage.jsx');
      const host=document.createElement('div');host.id='pagination-regression';document.body.append(host);
      window.directRequests=[];
      const fetcher=async params=>{window.directRequests.push(params);const offset=params.offset||0;
        const count=offset===0?20:5;
        return {documents:Array.from({length:count},(_,i)=>({document_entry:offset+i,document_number:'DOC-'+(offset+i),currency:'EGP'})),
          has_more:offset===0,next_offset:offset===0?20:null};};
      (C.createRoot||C.default.createRoot)(host).render(React.createElement(MemoryRouter,null,
        React.createElement(I18nProvider,null,React.createElement(List,{title:'Direct SAP documents',fetcher,
          primaryDateKey:'document_date',secondaryDateKey:'due_date',detailPath:id=>'/document/'+id,statusOptions:[]}))));
    }""")
    host=page.locator('#pagination-regression')
    expect(host.locator('tbody tr')).to_have_count(20)
    host.get_by_role('button',name='Next',exact=True).click()
    expect(host.locator('tbody tr')).to_have_count(5)
    assert page.evaluate('window.directRequests.map(r=>r.offset)')==[0,20]
    expect(host.get_by_role('button',name='Next',exact=True)).to_have_count(0)
    assert host.locator('tbody tr').all_text_contents()[0].startswith('DOC-20')
    host.get_by_role('button',name='Previous',exact=True).click()
    expect(host.locator('tbody tr')).to_have_count(20)
    host.locator('input[type=date]').first.fill('2026-01-01')
    page.wait_for_function('window.directRequests.at(-1).date_from === "2026-01-01"')
    assert page.evaluate('window.directRequests.at(-1).offset')==0
    browser.close()
print('PASS direct-list browser pagination: short page -> next_offset 20, final page, previous, filter reset.')
