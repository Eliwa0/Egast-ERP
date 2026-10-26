import hashlib,json,zipfile,difflib,subprocess
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
start=json.loads((OUT/'start-hashes.json').read_text());manifest=json.loads((OUT/'manifest.json').read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
changed=[k for k,h in start.items() if not(ROOT/k).exists() or sha(ROOT/k)!=h]
added=[k for k in manifest['files'] if k.startswith('frontend/') and k not in start]
drift=[k for k,h in manifest['files'].items() if not(ROOT/k).exists() or sha(ROOT/k)!=h]
frozen_drift=[k for k,h in manifest['files'].items() if sha(OUT/'frozen'/k)!=h]
with zipfile.ZipFile(OUT/'before.zip') as z:
 diff=[]
 for key in changed:
  if key in z.namelist():diff.extend(difflib.unified_diff(z.read(key).decode('utf-8-sig').replace('\r\n','\n').splitlines(True),(ROOT/key).read_text(encoding='utf-8-sig').splitlines(True),fromfile='before/'+key,tofile='after/'+key))
 (OUT/'task-only.diff').write_text(''.join(diff),encoding='utf-8')
before=json.loads((OUT/'before-visual.json').read_text(encoding='utf-8'));after=json.loads((OUT/'after-visual.json').read_text(encoding='utf-8'))
def key(row):return (row['route'],row['lang'],row['theme'],row['width'])
prior={key(r):r for r in before};comparisons=[]
for row in after:
 if key(row) not in prior:continue
 b=Counter(tuple(c) for c in prior[key(row)]['initial_calls']);a=Counter(tuple(c) for c in row['initial_calls'])
 comparisons.append({'route':row['route'],'lang':row['lang'],'theme':row['theme'],'width':row['width'],'before_requests':sum(b.values()),'after_requests':sum(a.values()),'same_method_path_counts':a==b,'before':dict((str(k),v)for k,v in b.items()),'after':dict((str(k),v)for k,v in a.items())})
(OUT/'api-comparison.json').write_text(json.dumps(comparisons,ensure_ascii=False,indent=2),encoding='utf-8')
summary={'snapshot_sha256':manifest['sha256'],'pinned_nonprotected_files':len(manifest['files']),'changed_files':changed,'new_frontend_files':added,'working_tree_drift':drift,'frozen_input_drift':frozen_drift,'before_visual_cases':len(before),'after_visual_cases':len(after),'comparable_cases':len(comparisons),'api_count_differences':[r for r in comparisons if not r['same_method_path_counts']],'protected_content_rehashed':False}
(OUT/'integrity.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
with (OUT/'git-after.txt').open('wb') as f:subprocess.run(['git','status','--short'],stdout=f,stderr=subprocess.DEVNULL)
print(json.dumps({k:v for k,v in summary.items() if k!='api_count_differences'}));print('API count differences:',len(summary['api_count_differences']))
