"""A4 Chromium PDF verification of the real printable component and print helper."""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scratch/readiness-pdf-tools'))
import pymupdf as fitz

out = ROOT / 'scratch/predeploy/print'
out.mkdir(exist_ok=True)
results = []
with sync_playwright() as playwright:
    browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{os.environ.get('AUDIT_CHROME_PORT', '9777')}")
    context = browser.new_context()
    origin = 'http://127.0.0.1:5188'
    context.route('**/*', lambda route: route.continue_()
                  if route.request.url.startswith(origin + '/') and not route.request.url.startswith(origin + '/api/')
                  else route.fulfill(status=200, content_type='application/json', body='{"success":true,"data":[]}'))
    context.add_init_script('window.close=()=>{};window.print=()=>{window.__printCalled=true}')
    page = context.new_page()
    page.goto(origin + '/login')
    page.evaluate("import('/scripts/fixtures/sales-print-verification.jsx').then(m=>m.install())")
    for kind in ['QUOTATION', 'SALES_ORDER', 'DELIVERY']:
        for language in ['en', 'ar']:
            for count, orientation in [(n, axis) for n in [1,10,55] for axis in ['portrait','landscape']]:
                name = f'{kind.lower()}-{language}-{count}' + ('-landscape' if orientation == 'landscape' else '')
                page.evaluate('args=>window.renderFixture(...args)', [kind, language, count])
                with page.expect_popup() as popup:
                    page.evaluate('args=>window.printFixture(args)', {'lang':language,'orientation':orientation})
                printed = popup.value
                expect(printed.locator('body')).to_contain_text('5001')
                printed.evaluate('window.close=()=>{};window.print=()=>{window.__printCalled=true}')
                printed.wait_for_function('window.__printReady && window.__printCalled && document.fonts.status === "loaded"', timeout=20000)
                assert printed.evaluate('[...document.images].every(img=>img.complete && img.naturalWidth>0)')
                printed.emulate_media(media='print')
                printed.evaluate('async()=>{document.body.getBoundingClientRect(); await document.fonts.ready}')
                cdp = printed.context.new_cdp_session(printed)
                cdp.send('DOM.enable'); cdp.send('CSS.enable')
                root_node = cdp.send('DOM.getDocument')['root']['nodeId']
                cell_node = cdp.send('DOM.querySelector', {'nodeId': root_node, 'selector': 'tbody td:nth-child(2)'})['nodeId']
                used_fonts = cdp.send('CSS.getPlatformFontsForNode', {'nodeId':cell_node})['fonts']
                assert any(font['isCustomFont'] and 'Cairo' in font['familyName'] for font in used_fonts), used_fonts
                printed.pdf(path=str(out / f'{name}.pdf'), format='A4', prefer_css_page_size=True, print_background=True)
                pdf = fitz.open(out / f'{name}.pdf')
                content = '\n'.join(sheet.get_text() for sheet in pdf)
                for i in range(count):
                    assert f'ROW-{i+1:03}' in content, (name, i, content)
                assert 'USD' in content and '6,000.00' in content and 'WH-VERIFIED' in content, name
                assert 'EGP' not in content, name
                width, height = (841.89,595.28) if orientation == 'landscape' else (595.28,841.89)
                assert all(abs(sheet.rect.width-width)<1 and abs(sheet.rect.height-height)<1 for sheet in pdf)
                fonts = sorted({font[3] for sheet in pdf for font in sheet.get_fonts()})
                assert any(font[2] == 'Type3' or 'Cairo' in font[3] for sheet in pdf for font in sheet.get_fonts()), (name, fonts)
                for number, sheet in enumerate(pdf):
                    assert '5001' in sheet.get_text(), (name, number)
                    sheet.get_pixmap(matrix=fitz.Matrix(1, 1)).save(out / f'{name}-page-{number+1}.png')
                results.append({'document':kind,'language':language,'orientation':orientation,'rows':count,'pages':len(pdf),'embedded_fonts':fonts,'browser_fonts':used_fonts,'bytes':(out/f'{name}.pdf').stat().st_size})
                pdf.close()
                printed.close()
    context.close()
(out / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print('PASS: 36 real component/print-helper A4 portrait/landscape PDFs; all rows/totals/warehouses and repeated DocNum present; local Cairo fonts embedded; EN/AR, 1/10/55 lines.')
