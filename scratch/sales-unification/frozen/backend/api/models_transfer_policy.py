from django.conf import settings
from django.db import models


class TransferPolicyRevision(models.Model):
    """Company intent only; SAP master data is validated, never copied here."""
    DRAFT, ACTIVE, DISABLED = "DRAFT", "ACTIVE", "DISABLED"
    company_scope = models.CharField(max_length=255)
    stage_key = models.CharField(max_length=40)
    revision = models.PositiveIntegerField()
    state = models.CharField(max_length=8, default=DRAFT, choices=[(s, s) for s in (DRAFT, ACTIVE, DISABLED)])
    configuration = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="transfer_policies_created")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="transfer_policies_updated")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["company_scope", "stage_key", "revision"], name="transfer_policy_revision_unique"),
            models.UniqueConstraint(fields=["company_scope", "stage_key"], condition=models.Q(state="ACTIVE"), name="transfer_policy_active_unique"),
        ]
        ordering = ["stage_key", "-revision"]
