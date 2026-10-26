import hashlib,json,subprocess
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
start=json.loads((OUT/'start-hashes.json').read_text());manifest=json.loads((OUT/'manifest.json').read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
start_changes=[k for k,h in start.items() if not(ROOT/k).exists() or sha(ROOT/k)!=h]
root_drift=[k for k,h in manifest['files'].items() if not(ROOT/k).exists() or sha(ROOT/k)!=h]
frozen_drift=[k for k,h in manifest['files'].items() if sha(OUT/'frozen'/k)!=h]
before=json.loads((ROOT/'scratch/sales-unification/after-visual.json').read_text(encoding='utf-8'));after=json.loads((OUT/'after-visual.json').read_text(encoding='utf-8'))
def key(row):return (row['route'],row['lang'],row['theme'],row['width'])
prior={key(r):r for r in before};comparisons=[]
for r in after:
 b=prior.get(key(r))
 if not b:continue
 bc=Counter(tuple(c)for c in b['initial_calls']);ac=Counter(tuple(c)for c in r['initial_calls'])
 comparisons.append({'route':r['route'],'language':r['lang'],'theme':r['theme'],'width':r['width'],'historical_baseline_requests':sum(bc.values()),'current_measured_requests':sum(ac.values()),'equal_method_path_counts':bc==ac})
(OUT/'api-comparison.json').write_text(json.dumps({'note':'Historical baseline used only for comparison; current run was executed independently','cases':comparisons},indent=2))
summary={'root':str(ROOT),'git_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'snapshot_sha256':manifest['sha256'],'pinned_nonprotected_files':len(manifest['files']),'app_changes_during_task':start_changes,'working_tree_drift':root_drift,'frozen_input_drift':frozen_drift,'current_visual_cases':len(after),'current_visual_page_errors':sum(len(r['errors'])for r in after),'current_visual_console':sum(len(r['console'])for r in after),'api_comparison_cases':len(comparisons),'api_count_differences':sum(not r['equal_method_path_counts']for r in comparisons),'protected_content_rehashed':False}
(OUT/'integrity.json').write_text(json.dumps(summary,indent=2))
with (OUT/'git-after.txt').open('wb')as f:subprocess.run(['git','status','--short'],cwd=ROOT,stdout=f,stderr=subprocess.DEVNULL)
print(json.dumps(summary))
