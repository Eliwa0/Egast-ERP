import json
import os
from pathlib import Path
import runpy
import sys
from unittest.mock import patch
from urllib.parse import urlsplit
from playwright.sync_api import BrowserContext, LocatorAssertions
ROOT=Path(__file__).resolve().parents[2]
page=None
errors=[]
requests=[]
new_page=BrowserContext.new_page
visible=LocatorAssertions.to_be_visible
def capture(context,*args,**kwargs):
    global page
    page=new_page(context,*args,**kwargs)
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request',lambda request:requests.append(urlsplit(request.url).path) if '/api/' in request.url else None)
    return page
def inspect(assertion,*args,**kwargs):
    try:return visible(assertion,*args,**kwargs)
    except Exception:
        Path(__file__).with_name('browser-diagnostic.json').write_text(json.dumps({'body':page.locator('body').inner_text(),
            'errors':errors,'requests':requests},indent=2),encoding='utf-8')
        raise
with patch.object(BrowserContext,'new_page',capture),patch.object(LocatorAssertions,'to_be_visible',inspect):
    runpy.run_path(str(ROOT/'frontend/scripts'/sys.argv[1]),run_name='__main__')
