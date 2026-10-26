import os
import json
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'receipt_project.settings')
django.setup()

from api.models_issue import PendingIssue, PendingIssueLine

issues = PendingIssue.objects.all().order_by('-id')[:5]
print(f"Latest {len(issues)} Pending Issues:")
for issue in issues:
    print(f"\nID: {issue.id}, Order: {issue.production_order_doc_num}, Status: {issue.status}, CreatedBy: {issue.created_by}")
    print(f"SAP Error: {issue.sap_error}")
    for line in issue.lines.all():
        print(f"  Line {line.line_number}: Item={line.item_code}, Qty={line.issue_quantity}, Whs={line.warehouse_code}")
        print(f"  Allocations: {json.dumps(line.allocations_json, indent=4)}")
