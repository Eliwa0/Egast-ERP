import hashlib,json,re,zipfile,difflib,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
start=json.loads((OUT/'start-hashes.json').read_text());manifest=json.loads((OUT/'manifest.json').read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
changed=[k for k,h in start.items() if not(ROOT/k).exists() or sha(ROOT/k)!=h]
current_drift=[k for k,h in manifest['files'].items() if not(ROOT/k).exists() or sha(ROOT/k)!=h]
frozen_drift=[k for k,h in manifest['files'].items() if sha(OUT/'frozen'/k)!=h]
sources={k:(ROOT/k).read_text(encoding='utf-8-sig') for k in start if k.startswith('frontend/src/') and (ROOT/k).suffix in {'.jsx','.js'}}
remaining=json.loads((OUT/'lint-final.json').read_text(encoding='utf-8'));open_rules={}
for x in remaining:
 for m in x['messages']:open_rules[(Path(x['filePath']).relative_to(OUT/'frozen').as_posix(),m['ruleId'])]=m
rows=json.loads((ROOT/'scratch/frontend-remediation/lint-review-ledger.json').read_text(encoding='utf-8'));ledger=[]
for row in rows:
 file=row['file']
 if file.endswith('translations.js'):continue
 stem=Path(file).stem;consumers=[]
 for key,source in sources.items():
  if key!=file and re.search(r"(?:from\s*|import\s*\()['\"][^'\"]*/"+re.escape(stem)+r"(?:\.[jm]sx?)?['\"]",source):consumers.append(key)
 still_open=(file,row['rule']) in open_rules
 reason=None
 if still_open:
  reason=('Provider/hook share a public module contract. Consumers in protected scope cannot be inspected or migrated under this authorization; no incompatible split or ESLint exception was applied.' if row['rule'].startswith('react-refresh') else 'Vendor state participates in loadDraftData fallback, which is called from an effect. Blind dependency insertion risks reloading/overwriting vendor edits; unchanged pending lifecycle coverage.')
 else:
  reason=('Preserve hook/initializer evaluation; remove unreferenced lexical binding. Functions never invoked by any binding consumer were removed; positional batch argument compatibility preserved with an elided rest tuple.' if row['rule']=='no-unused-vars' else 'Separate initial request from manual loading transition; token identity and real-browser lifecycle regression added.' if row['rule']=='react-hooks/set-state-in-effect' else 'Formatting helpers moved into a utility module; existing detail consumer updated, outputs regression-tested.' if row['rule'].startswith('react-refresh') else 'Dependency repaired after checking consumers: event callback/export memo, guarded one-time effect, or stable filter-open/key subscription. No extra fetch dependency was added to loadDraftData.')
 ledger.append({**{k:row[k] for k in ['file','line','rule','message']},'status':'open' if still_open else 'closed','reason':reason,'nonprotected_direct_consumers':consumers,'protected_consumers':'Not inspected; no protected source read for consumer search'})
(OUT/'review-ledger.json').write_text(json.dumps(ledger,ensure_ascii=False,indent=2),encoding='utf-8')
with zipfile.ZipFile(OUT/'before.zip') as z:
 diff=[]
 for key in changed:
  if key in z.namelist():diff.extend(difflib.unified_diff(z.read(key).decode('utf-8-sig').replace('\r\n','\n').splitlines(True),(ROOT/key).read_text(encoding='utf-8-sig').splitlines(True),fromfile='before/'+key,tofile='after/'+key))
 (OUT/'task-only.diff').write_text(''.join(diff),encoding='utf-8')
summary={'snapshot_sha256':manifest['sha256'],'pinned_nonprotected_files':len(manifest['files']),'changed_since_start':changed,'frozen_input_drift':frozen_drift,'working_tree_drift':current_drift,'closed_lint_findings':sum(r['status']=='closed' for r in ledger),'open_lint_findings':sum(r['status']=='open' for r in ledger),'protected_translation_errors': '12 historical findings not reopened or rechecked; entire protected translation source excluded from ESLint in this run','protected_source_content_rehashed':False}
(OUT/'integrity.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
with (OUT/'git-after.txt').open('wb') as f:subprocess.run(['git','status','--short'],stdout=f,stderr=subprocess.DEVNULL)
print(json.dumps(summary))
