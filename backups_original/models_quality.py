from django.db import models
from django.contrib.auth.models import User

class PendingQualityInspection(models.Model):
    PENDING_REVIEW = 'PENDING_REVIEW'
    POSTED = 'POSTED'
    REJECTED = 'REJECTED'
    FAILED = 'FAILED'
    
    STATUS_CHOICES = [
        (PENDING_REVIEW, 'Pending Review'),
        (POSTED, 'Posted'),
        (REJECTED, 'Rejected'),
        (FAILED, 'Failed'),
    ]

    batch_number = models.CharField(max_length=100, db_index=True)
    item_code = models.CharField(max_length=100, blank=True)
    item_name = models.CharField(max_length=200, blank=True)
    supplier_name = models.CharField(max_length=200, blank=True)
    farm_origin = models.CharField(max_length=200, blank=True)
    inspector_name = models.CharField(max_length=100, blank=True)
    data_clerk_name = models.CharField(max_length=100, blank=True)
    contractor_name = models.CharField(max_length=100, blank=True)
    car_number = models.CharField(max_length=50, blank=True)
    crop_name = models.CharField(max_length=100, blank=True)
    raw_material_type = models.CharField(max_length=100, blank=True)
    inspection_date = models.DateField(null=True, blank=True)
    
    sample_size = models.IntegerField(default=5)
    samples_data = models.JSONField(default=list)
    notes = models.TextField(blank=True)
    
    # Calculated aggregates
    total_defects_count = models.IntegerField(default=0)
    average_defects_per_sample = models.FloatField(default=0.0)
    decision = models.CharField(max_length=50, default='Accepted')
    quarantine_violation = models.BooleanField(default=False)
    
    # Excel-specific metrics
    af_waste_total = models.IntegerField(default=0)
    ag_quality_total = models.IntegerField(default=0)
    ah_grand_total = models.IntegerField(default=0)
    combined_bruises_cuts_percentage = models.FloatField(default=0.0)
    high_cut_percentage = models.FloatField(default=0.0)
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=PENDING_REVIEW, db_index=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='quality_submissions')
    reviewed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='quality_reviews')
    rejection_reason = models.TextField(blank=True)
    
    sap_doc_entry = models.CharField(max_length=50, blank=True)
    sap_doc_num = models.CharField(max_length=50, blank=True)
    sap_error = models.TextField(blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    posted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Inspection {self.id} — Batch {self.batch_number} [{self.status}]"
