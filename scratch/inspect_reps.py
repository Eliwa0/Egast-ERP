import json

p = r'C:\Users\hp\.gemini\antigravity\brain\d8adbeea-fb43-4512-bbb1-fc838e0c0186\.system_generated\logs\transcript_full.jsonl'
targets = {6340, 6452, 7277, 9258, 9585, 11995}

with open(p, 'r', encoding='utf-8') as f:
    for i, line in enumerate(f):
        if i in targets:
            obj = json.loads(line)
            args = obj['tool_calls'][0]['args']
            desc = args.get('Description', '')
            rep = args.get('ReplacementContent', '')
            sl = args.get('StartLine')
            el = args.get('EndLine')
            print(f"=== Line {i} ({desc}) Start:{sl} End:{el} Lines:{len(rep.splitlines())} ===")
