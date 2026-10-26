from decimal import Decimal

from rest_framework import serializers
from .models import (
    ScaleDevice,
    ScaleVehicle,
    ScaleVehicleMovement,
    ScaleItemElement,
    ScaleDraft,
    ScaleDraftElement,
    ScaleDraftAllocation,
    ScalePermit,
    ScaleDraftTrailer,
    ScaleDraftContainer,
    ScaleMovementTrailer,
    ScaleMovementContainer,
    ScaleReceipt,
    ScaleReceiptItem,
    ScaleEntryExitPermit,
    ScaleEntryExitPermitItem,
)


class ScaleDeviceSerializer(serializers.ModelSerializer):
    is_online = serializers.BooleanField(read_only=True)
    connection_type_display = serializers.CharField(source="get_device_type_display", read_only=True)
    ip_address = serializers.IPAddressField(required=False, allow_null=True, allow_blank=True)

    class Meta:
        model = ScaleDevice
        fields = [
            "id",
            "device_id",
            "device_name",
            "device_type",
            "connection_type_display",
            "com_port",
            "baud_rate",
            "ip_address",
            "port",
            "location",
            "is_active",
            "last_seen",
            "is_online",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        device_type = attrs.get("device_type") or getattr(self.instance, "device_type", "local")

        if attrs.get("ip_address") == "":
            attrs["ip_address"] = None

        if device_type == "remote":
            if not attrs.get("ip_address"):
                raise serializers.ValidationError({"ip_address": "IP address is required for remote scale devices."})
            if attrs.get("port") in ("", None):
                attrs["port"] = 8000
            return attrs

        if device_type == "local":
            com_port = (attrs.get("com_port") or "").strip()
            if not com_port:
                # AUTO mode: agent discovers COM port and baud rate automatically.
                attrs["com_port"] = None
                attrs["baud_rate"] = None
                attrs["ip_address"] = None
                attrs["port"] = None
                return attrs
            # Manual COM: explicit COM port selected by the admin.
            # A manual port can still use automatic baud discovery.
            if "baud_rate" not in attrs:
                attrs["baud_rate"] = getattr(self.instance, "baud_rate", None)
            attrs["ip_address"] = None
            attrs["port"] = None
            return attrs

        if device_type == "virtual":
            attrs["com_port"] = None
            attrs["ip_address"] = None
            attrs["port"] = None
            if not attrs.get("baud_rate"):
                attrs["baud_rate"] = 9600

        return attrs


class ScaleMovementTrailerSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScaleMovementTrailer
        fields = ["id", "trailer_number"]

class ScaleMovementContainerSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScaleMovementContainer
        fields = ["id", "container_number"]

class ScaleVehicleMovementSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)
    duration_display = serializers.SerializerMethodField()
    trailers = ScaleMovementTrailerSerializer(many=True, read_only=True)
    containers = ScaleMovementContainerSerializer(many=True, read_only=True)

    class Meta:
        model = ScaleVehicleMovement
        fields = [
            "id",
            "vehicle",
            "driver_name",
            "entry_time",
            "exit_time",
            "is_active",
            "duration_display",
            "notes",
            "trailers",
            "containers",
            "created_by",
            "created_by_username",
            "created_at",
        ]

    def get_duration_display(self, obj):
        d = obj.duration
        if d:
            total_seconds = int(d.total_seconds())
            hours, remainder = divmod(total_seconds, 3600)
            minutes, _ = divmod(remainder, 60)
            return f"{hours}h {minutes}m"
        return "جاري..."


class ScaleVehicleSerializer(serializers.ModelSerializer):
    current_status = serializers.CharField(read_only=True)
    is_inside = serializers.BooleanField(read_only=True)
    movements_count = serializers.IntegerField(source="movements.count", read_only=True)
    trailers = serializers.SerializerMethodField()
    containers = serializers.SerializerMethodField()

    class Meta:
        model = ScaleVehicle
        fields = [
            "id",
            "vehicle_number",
            "driver_name",
            "driver_id",
            "phone",
            "company",
            "vehicle_type",
            "truck_type",
            "current_status",
            "is_inside",
            "movements_count",
            "trailers",
            "containers",
            "notes",
            "created_at",
            "updated_at",
        ]

    def get_trailers(self, obj):
        last_movement = obj.movements.order_by("-entry_time").first()
        if last_movement and last_movement.exit_time is None:
            return ScaleMovementTrailerSerializer(last_movement.trailers.all(), many=True).data
        return []

    def get_containers(self, obj):
        last_movement = obj.movements.order_by("-entry_time").first()
        if last_movement and last_movement.exit_time is None:
            return ScaleMovementContainerSerializer(last_movement.containers.all(), many=True).data
        return []

class ScaleItemElementSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScaleItemElement
        fields = [
            "id",
            "item_code",
            "item_name",
            "name",
            "weight",
            "is_active",
            "created_at",
            "updated_at",
        ]


class ScaleDraftElementSerializer(serializers.ModelSerializer):
    item_element_name = serializers.CharField(source="item_element.name", read_only=True)
    signed_weight = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = ScaleDraftElement
        fields = [
            "id",
            "draft",
            "item_element",
            "item_element_name",
            "count",
            "stage",
            "action",
            "unit_weight",
            "total_weight",
            "signed_weight",
            "created_at",
        ]


class ScaleDraftTrailerSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScaleDraftTrailer
        fields = ["id", "draft", "trailer_number", "created_at"]


class ScaleDraftContainerSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScaleDraftContainer
        fields = ["id", "draft", "container_number", "created_at"]


class ScaleDraftAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScaleDraftAllocation
        fields = [
            "id",
            "draft",
            "line_number",
            "vendor_card_code",
            "vendor_name",
            "item_code",
            "item_name",
            "crop_name",
            "raw_material_type",
            "batch_number",
            "farm_origin",
            "contractor_name",
            "notes",
            "created_at",
            "updated_at",
        ]



class ScalePermitSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = ScalePermit
        fields = [
            "id",
            "draft",
            "permit_number",
            "permit_type",
            "driver_name",
            "driver_id",
            "phone",
            "company",
            "purpose",
            "supplier",
            "entry_time",
            "exit_time",
            "include_batches_info",
            "batch_details",
            "notes",
            "created_by",
            "created_by_username",
            "created_at",
        ]


class ShippingScaleMixin:
    def get_shipping_manifest(self, obj):
        from api.models_shipping import ShippingOperation
        from api.shipping_views import manifest_dict
        operation = ShippingOperation.objects.filter(scale_draft=obj).select_related('scale_draft').first()
        return manifest_dict(operation, commercial=False) if operation else None

    def to_representation(self, instance):
        result = super().to_representation(instance)
        if result.get('shipping_manifest'):
            # Commercial metadata never enters an outbound scale response.
            for key in ('vendor_card_code', 'vendor_name', 'quotation', 'quotation_number',
                        'quotation_sap_doc_entry', 'quotation_line_index', 'notes'):
                if key in result:
                    result[key] = None
            result['allocations'] = []
        return result


class ScaleDraftListSerializer(ShippingScaleMixin, serializers.ModelSerializer):
    shipping_manifest = serializers.SerializerMethodField()
    effective_vehicle_number = serializers.CharField(read_only=True)
    effective_driver_name = serializers.CharField(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    start_type_display = serializers.CharField(source="get_start_type_display", read_only=True)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)
    allocations_count = serializers.IntegerField(source="allocations.count", read_only=True)
    allocations = ScaleDraftAllocationSerializer(many=True, read_only=True)
    quotation_number = serializers.SerializerMethodField()
    quotation_sap_doc_entry = serializers.SerializerMethodField()

    def get_quotation_number(self, obj):
        if not obj.quotation_id or not obj.quotation:
            return None
        return str(obj.quotation.sap_doc_num or obj.quotation.id)

    def get_quotation_sap_doc_entry(self, obj):
        if not obj.quotation_id or not obj.quotation:
            return None
        return str(obj.quotation.sap_doc_entry or "")

    class Meta:
        model = ScaleDraft
        fields = [
            "id",
            "draft_number",
            "effective_vehicle_number",
            "effective_driver_name",
            "is_direct_entry",
            "is_multi_allocation",
            "is_certified_locked",
            "start_type",
            "start_type_display",
            "truck_type",
            "trailer_number",
            "container_number",
            "item_code",
            "item_name",
            "vendor_card_code",
            "vendor_name",
            "weight_loaded",
            "net_weight_loaded",
            "loaded_time",
            "weight_empty",
            "net_weight_empty",
            "empty_time",
            "product_weight",
            "status",
            "status_display",
            "is_closed",
            "allocations_count",
            "shipping_manifest",
            "allocations",
            "permit_printed",
            "final_card_printed",
            "created_by_username",
            "quotation",
            "quotation_number",
            "quotation_sap_doc_entry",
            "quotation_line_index",
            "created_at",
            "updated_at",
        ]


class ScaleDraftDetailSerializer(ShippingScaleMixin, serializers.ModelSerializer):
    shipping_manifest = serializers.SerializerMethodField()
    effective_vehicle_number = serializers.CharField(read_only=True)
    effective_driver_name = serializers.CharField(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    start_type_display = serializers.CharField(source="get_start_type_display", read_only=True)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)
    closed_by_username = serializers.CharField(source="closed_by.username", read_only=True)
    draft_elements = ScaleDraftElementSerializer(many=True, read_only=True)
    allocations = ScaleDraftAllocationSerializer(many=True, read_only=True)
    permit = ScalePermitSerializer(read_only=True)
    trailers = ScaleDraftTrailerSerializer(many=True, read_only=True)
    containers = ScaleDraftContainerSerializer(many=True, read_only=True)
    quotation_number = serializers.SerializerMethodField()
    quotation_sap_doc_entry = serializers.SerializerMethodField()

    def get_quotation_number(self, obj):
        if not obj.quotation_id or not obj.quotation:
            return None
        return str(obj.quotation.sap_doc_num or obj.quotation.id)

    def get_quotation_sap_doc_entry(self, obj):
        if not obj.quotation_id or not obj.quotation:
            return None
        return str(obj.quotation.sap_doc_entry or "")

    class Meta:
        model = ScaleDraft
        fields = [
            "id",
            "draft_number",
            "effective_vehicle_number",
            "effective_driver_name",
            "vehicle",
            "is_direct_entry",
            "is_multi_allocation",
            "is_certified_locked",
            "direct_vehicle_number",
            "direct_driver_name",
            "truck_type",
            "trailer_number",
            "container_number",
            "start_type",
            "start_type_display",
            "item_code",
            "item_name",
            "vendor_card_code",
            "vendor_name",
            "scale_device",
            "weight_loaded",
            "net_weight_loaded",
            "loaded_time",
            "weight_empty",
            "net_weight_empty",
            "empty_time",
            "product_weight",
            "status",
            "status_display",
            "is_closed",
            "permit_printed",
            "permit_printed_at",
            "final_card_printed",
            "final_card_printed_at",
            "notes",
            "quotation",
            "quotation_number",
            "quotation_sap_doc_entry",
            "quotation_line_index",
            "draft_elements",
            "shipping_manifest",
            "allocations",
            "permit",
            "trailers",
            "containers",
            "created_by",
            "created_by_username",
            "closed_by",
            "closed_by_username",
            "created_at",
            "updated_at",
        ]


class ScaleReceiptItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScaleReceiptItem
        fields = [
            "id",
            "line_number",
            "item_code",
            "item_name",
            "count",
            "quantity_kg",
            "quantity_ton",
            "package_type",
            "notes",
        ]
        read_only_fields = ["id"]


class ScaleReceiptSerializer(serializers.ModelSerializer):
    items = ScaleReceiptItemSerializer(many=True, required=False)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = ScaleReceipt
        fields = [
            "id",
            "receipt_number",
            "receipt_date",
            "vehicle_number",
            "driver_name",
            "driver_license",
            "source",
            "supplier_name",
            "total_quantity_kg",
            "total_quantity_ton",
            "driver_signature_name",
            "receiver_signature_name",
            "driver_signature",
            "receiver_signature",
            "notes",
            "items",
            "created_by_username",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "receipt_number", "total_quantity_kg", "total_quantity_ton"]

    def validate_items(self, items):
        for item in items:
            if int(item.get("count", 1) or 0) < 0:
                raise serializers.ValidationError("Item count cannot be negative.")
            if item.get("quantity_kg") is not None and item["quantity_kg"] < 0:
                raise serializers.ValidationError("Item quantity cannot be negative.")
        return items

    def validate(self, attrs):
        attrs = super().validate(attrs)
        normalized_items = []
        for item in attrs.get("items", []):
            item = dict(item)
            kg = Decimal(item.get("quantity_kg") or 0)
            item["quantity_kg"] = kg
            item["quantity_ton"] = (kg / Decimal("1000")).quantize(Decimal("0.001"))
            normalized_items.append(item)
        attrs["items"] = normalized_items
        return attrs

    def _apply_items(self, receipt, items):
        receipt.items.all().delete()
        total_kg = Decimal("0.00")
        for index, item in enumerate(items, start=1):
            item.pop("id", None)
            item.pop("line_number", None)
            ScaleReceiptItem.objects.create(receipt=receipt, line_number=index, **item)
            total_kg += item["quantity_kg"]
        ScaleReceipt.objects.filter(pk=receipt.pk).update(
            total_quantity_kg=total_kg,
            total_quantity_ton=(total_kg / Decimal("1000")).quantize(Decimal("0.001")),
        )
        receipt.refresh_from_db()
        return receipt

    def create(self, validated_data):
        items = validated_data.pop("items", [])
        receipt = ScaleReceipt.objects.create(**validated_data)
        self._apply_items(receipt, items)
        return receipt

    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if items is not None:
            self._apply_items(instance, items)
        return instance


class ScaleEntryExitPermitItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScaleEntryExitPermitItem
        fields = [
            "id",
            "line_number",
            "item_code",
            "item_name",
            "count",
            "quantity_kg",
            "quantity_ton",
            "notes",
        ]
        read_only_fields = ["id"]


class ScaleEntryExitPermitSerializer(serializers.ModelSerializer):
    items = ScaleEntryExitPermitItemSerializer(many=True, required=False)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)
    permit_type_display = serializers.CharField(source="get_permit_type_display", read_only=True)
    gross_weight_ton = serializers.SerializerMethodField()
    tare_weight_ton = serializers.SerializerMethodField()
    net_weight_ton = serializers.SerializerMethodField()

    class Meta:
        model = ScaleEntryExitPermit
        fields = [
            "id",
            "permit_type",
            "permit_type_display",
            "permit_number",
            "permit_date",
            "supplier_name",
            "buyer_name",
            "driver_name",
            "destination",
            "vehicle_number",
            "inspection_result",
            "gate_writer",
            "inspection_head",
            "gross_weight_kg",
            "tare_weight_kg",
            "net_weight_kg",
            "gross_weight_ton",
            "tare_weight_ton",
            "net_weight_ton",
            "scale_operator",
            "general_manager",
            "responsible_person",
            "department_manager",
            "weight_in_words",
            "notes",
            "gate_writer_signature",
            "inspection_head_signature",
            "scale_operator_signature",
            "general_manager_signature",
            "responsible_signature",
            "department_manager_signature",
            "items",
            "created_by_username",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "permit_number"]

    def get_gross_weight_ton(self, obj):
        if obj.gross_weight_kg is None:
            return None
        return (obj.gross_weight_kg / Decimal("1000")).quantize(Decimal("0.001"))

    def get_tare_weight_ton(self, obj):
        if obj.tare_weight_kg is None:
            return None
        return (obj.tare_weight_kg / Decimal("1000")).quantize(Decimal("0.001"))

    def get_net_weight_ton(self, obj):
        if obj.net_weight_kg is None:
            return None
        return (obj.net_weight_kg / Decimal("1000")).quantize(Decimal("0.001"))

    def validate_items(self, items):
        for item in items:
            if int(item.get("count", 1) or 0) < 0:
                raise serializers.ValidationError("Item count cannot be negative.")
            if item.get("quantity_kg") is not None and item["quantity_kg"] < 0:
                raise serializers.ValidationError("Item quantity cannot be negative.")
        return items

    def validate(self, attrs):
        attrs = super().validate(attrs)

        permit_type = attrs.get("permit_type")
        if not permit_type:
            if self.instance is None:
                raise serializers.ValidationError({"permit_type": "Permit type is required."})
            permit_type = self.instance.permit_type

        if permit_type == "entry":
            for field in ("supplier_name", "driver_name", "vehicle_number"):
                if not str(attrs.get(field) or "").strip():
                    raise serializers.ValidationError({field: "This field is required for an entry permit."})
        elif permit_type == "exit":
            for field in ("buyer_name", "driver_name", "destination", "vehicle_number"):
                if not str(attrs.get(field) or "").strip():
                    raise serializers.ValidationError({field: "This field is required for an exit permit."})

        items = attrs.get("items", [])
        if not items or not any(str(i.get("item_name") or "").strip() or str(i.get("item_code") or "").strip() for i in items):
            raise serializers.ValidationError({"items": "At least one product row is required."})

        gross = attrs.get("gross_weight_kg")
        tare = attrs.get("tare_weight_kg")
        if permit_type == "entry" and (gross is not None or tare is not None):
            gross = Decimal(gross or 0)
            tare = Decimal(tare or 0)
            if gross < tare:
                raise serializers.ValidationError({"net_weight_kg": "Net weight cannot be negative (gross must not be less than tare)."})
            attrs["gross_weight_kg"] = gross
            attrs["tare_weight_kg"] = tare
            attrs["net_weight_kg"] = (gross - tare).quantize(Decimal("0.01"))

        normalized_items = []
        for item in items:
            item = dict(item) if not isinstance(item, dict) else dict(item)
            kg = Decimal(item.get("quantity_kg") or 0)
            item["quantity_kg"] = kg
            item["quantity_ton"] = (kg / Decimal("1000")).quantize(Decimal("0.001"))
            normalized_items.append(item)
        attrs["items"] = normalized_items
        return attrs

    def _apply_items(self, permit, items):
        permit.items.all().delete()
        for index, item in enumerate(items, start=1):
            item.pop("id", None)
            item.pop("line_number", None)
            ScaleEntryExitPermitItem.objects.create(permit=permit, line_number=index, **item)
        return permit

    def create(self, validated_data):
        items = validated_data.pop("items", [])
        permit = ScaleEntryExitPermit.objects.create(**validated_data)
        self._apply_items(permit, items)
        return permit

    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if items is not None:
            self._apply_items(instance, items)
        return instance
