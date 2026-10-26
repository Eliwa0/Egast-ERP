import json

with open("sqlite_backup_data.json", "r", encoding="utf-8") as f:
    data = json.load(f)

cleaned = [
    obj for obj in data
    if obj.get("model", "").lower() != "api.userprofile"
]

with open("sqlite_backup_data_clean.json", "w", encoding="utf-8") as f:
    json.dump(cleaned, f, ensure_ascii=False, indent=2)

print("Removed:", len(data) - len(cleaned))