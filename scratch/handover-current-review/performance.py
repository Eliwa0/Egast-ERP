"""Counterfactual legacy/current algorithms; measured fixture RTT, never live SAP."""
import json,os,re,sys,time,statistics,math
from pathlib import Path
from urllib.parse import parse_qs,urlsplit
from unittest.mock import patch
ROOT=Path(os.environ['FROZEN_ROOT']);OUT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'backend'))
os.environ.update(DJANGO_SETTINGS_MODULE='receipt_project.settings',SAP_BASE_URL='https://sap-fixture.invalid/b1s/v2',SAP_COMPANY_DB='FIXTURE',SAP_USERNAME='fixture',SAP_PASSWORD='fixture',SAP_VERIFY_SSL='true')
from django.conf import settings
settings.DATABASES={'default':{'ENGINE':'django.db.backends.sqlite3','NAME':':memory:'}}
settings.CACHES={'default':{'BACKEND':'django.core.cache.backends.locmem.LocMemCache'}}
import django;django.setup()
from api.services.sap_service import SAPServiceLayer
from api.services.workflow_order_reads import read_candidate_orders
from api.performance import PerformanceMiddleware,record_sap
from django.test import RequestFactory,override_settings
from django.http import JsonResponse
attempts=[];rows=[]
def blocked(*args,**kwargs):attempts.append(True);raise AssertionError('Unexpected real HTTP in fixture benchmark')
def summary(values):return {'mean_ms':round(statistics.mean(values),3),'median_ms':round(statistics.median(values),3),'p95_ms':round(sorted(values)[math.ceil(.95*len(values))-1],3)}
with patch('requests.sessions.Session.request',side_effect=blocked),override_settings(PERFORMANCE_METRICS_ENABLED=True):
 for workflow in ['item_tracking','order_candidates']:
  for mode in ['legacy','current']:
   timings=[];backends=[];spans=[];counts=[]
   for sample in range(30):
    sap=SAPServiceLayer();count=[0];span=[0.]
    def delay(entity='Items'):
     began=time.perf_counter();time.sleep(.002);elapsed=time.perf_counter()-began
     count[0]+=1;span[0]+=elapsed*1000;record_sap('GET',entity,elapsed)
    def ensure(*args,**kwargs):delay('SQLQueries');return {}
    def sql(*args,**kwargs):delay('SQLQueries');return {'value':[{'ItemCode':args[1].split("'")[1],'ManBtchNum':'Y','ManSerNum':'N'}]}
    def read(method,path):
     assert method=='GET';delay('Items' if workflow=='item_tracking' else 'Orders');q=parse_qs(urlsplit(path).query);offset=int(q.get('$skip',['0'])[0])
     if workflow=='item_tracking':
      selected=re.findall(r"ItemCode eq '([^']+)'",q['$filter'][0]);page=selected[offset:offset+5]
      values=[{'ItemCode':code,'ManageBatchNumbers':'tYES','ManageSerialNumbers':'tNO'}for code in page]
     else:
      selected=[int(x) for x in re.findall(r'DocEntry eq (\d+)',q['$filter'][0])];page=selected[offset:offset+5];values=[{'DocEntry':entry,'DocumentLines':[]}for entry in page]
     return {'value':values,**({'odata.nextLink':'fixture-next'} if offset+len(page)<len(selected) else {})}
    sap.ensure_sql_query=ensure;sap.execute_sql_query=sql;sap._request=read
    def single(entry):delay('Orders');return {'DocEntry':entry,'DocumentLines':[]}
    sap.get_sales_order=single
    def operation(request):
     if workflow=='item_tracking':
      codes=[f'FIX{i}'for i in range(10)];actual={code:sap.get_item_tracking_flags(code)for code in codes} if mode=='legacy' else sap.get_item_tracking_flags_bulk(codes)
      assert actual=={code:{'manage_batches':True,'manage_serials':False}for code in codes}
     else:
      entries=list(range(10));actual={i:single(i)for i in entries} if mode=='legacy' else read_candidate_orders(sap,entries)
      assert actual=={i:{'DocEntry':i,'DocumentLines':[]}for i in entries}
     return JsonResponse({'count':len(actual)})
    middleware=PerformanceMiddleware(operation);start=time.perf_counter();response=middleware(RequestFactory().get('/fixture/read/'));timings.append((time.perf_counter()-start)*1000)
    assert response.status_code==200
    values=dict(re.findall(r'(total|sap|db);dur=([0-9.]+)',response['Server-Timing']))
    backends.append(float(values['total']));spans.append(float(values['sap']));counts.append(count[0])
   rows.append({'workflow':workflow,'mode':mode,'samples':30,'records':10,'transport_delay_ms':2,'simulated_page_size':5,'request_counts':sorted(set(counts)),'measured_wrapper_wall':summary(timings),'django_middleware_wall':summary(backends),'fixture_sap_spans':summary(spans),'errors':0,'timeouts':0,'equivalent_fixture_output':True})
assert not attempts
(OUT/'performance.json').write_text(json.dumps({'environment':'isolated fixtures; not live SAP or UI latency','comparison':'Existing legacy/current code paths in this snapshot, NOT a new implementation before/after','p95_method':'nearest rank, 30 samples','unexpected_http':len(attempts),'rows':rows},indent=2))
print(json.dumps(rows))
