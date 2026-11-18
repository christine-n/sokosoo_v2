from datetime import timedelta
from decimal import Decimal
from urllib.parse import parse_qs, urlsplit

from django.contrib.auth import get_user_model
from django.db import IntegrityError, OperationalError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from .connections import (
    cleanup_marketplace, dispatch_to_hub, notify_hub_matches, notify_parties,
    notify_reconciliation, receive_stock, reconcile_stock, record_stock, send_enquiry,
)
from .models import Bid, Enquiry, Hub, Listing, Notification, ProduceRequest, SavedCartItem
from .serializers import ListingSerializer, validate_quantity
from .views import paginated_response, require_role


class EnquirySerializer(serializers.ModelSerializer):
    consumer_name = serializers.CharField(source="consumer.first_name", read_only=True)
    farmer_name = serializers.CharField(source="farmer.first_name", read_only=True)
    farm_name = serializers.CharField(source="farmer.profile.farm_name", read_only=True)
    items = serializers.SerializerMethodField()

    class Meta:
        model = Enquiry
        fields = ["id", "consumer", "farmer", "consumer_name", "farmer_name", "farm_name", "message", "contact",
                  "status", "response", "pickup_details", "expires_at", "created_at", "responded_at", "items"]

    def get_items(self, obj):
        return list(obj.items.values("id", "listing_id", "name", "unit", "quantity", "price", "location"))


class EnquiryInput(serializers.Serializer):
    class Item(serializers.Serializer):
        listing = serializers.IntegerField(min_value=1)
        quantity = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))

    items = Item(many=True, allow_empty=False, max_length=100)
    key = serializers.UUIDField()
    message = serializers.CharField(max_length=1000, allow_blank=True, default="")
    contact = serializers.CharField(max_length=200)


def enquiry_response(operation):
    try:
        try:
            enquiry = operation()
        except IntegrityError:
            # A concurrent use of the same key must be validated against its original payload.
            enquiry = operation()
    except OperationalError as exc:
        if "locked" not in str(exc).lower():
            raise
        return Response({"detail": "Stock is being updated. Please retry with the same enquiry key."}, status=503, headers={"Retry-After": "2"})
    return Response(EnquirySerializer(enquiry).data, status=201)


class EnquiriesView(APIView):
    def get(self, request):
        queryset = Enquiry.objects.filter(Q(consumer=request.user) | Q(farmer=request.user))
        params = request.query_params
        if params.get("incoming") == "true":
            queryset = queryset.filter(farmer=request.user)
        if params.get("outgoing") == "true":
            queryset = queryset.filter(consumer=request.user)
        if params.get("id"):
            pk = serializers.UUIDField().run_validation(params["id"])
            queryset = queryset.filter(pk=pk)
        if params.get("status"):
            value = serializers.ChoiceField(choices=["pending", "accepted", "declined", "cancelled", "expired"]).run_validation(params["status"])
            queryset = queryset.filter(status=value)
        if params.get("q"):
            query = params["q"].strip()
            queryset = queryset.filter(Q(consumer__first_name__icontains=query) | Q(consumer__username__icontains=query) | Q(farmer__first_name__icontains=query) | Q(farmer__username__icontains=query) | Q(farmer__profile__farm_name__icontains=query) | Q(items__name__icontains=query)).distinct()
        queryset = queryset.select_related("consumer", "farmer__profile").prefetch_related("items").order_by("-created_at", "-pk")
        if "page" in params:
            return paginated_response(request, queryset, EnquirySerializer)
        return Response(EnquirySerializer(queryset, many=True).data)

    def post(self, request):
        data = EnquiryInput(data=request.data)
        data.is_valid(raise_exception=True)
        return enquiry_response(lambda: send_enquiry(request.user, **data.validated_data))


@api_view(["POST"])
def enquiry_reply(request, pk):
    from .connections import respond_to_enquiry

    class Reply(serializers.Serializer):
        status = serializers.ChoiceField(choices=["accepted", "declined"])
        response = serializers.CharField(max_length=1000)
        pickup_details = serializers.CharField(max_length=500, allow_blank=True, default="")

    data = Reply(data=request.data)
    data.is_valid(raise_exception=True)
    return Response(EnquirySerializer(respond_to_enquiry(request.user, pk, **data.validated_data)).data)


@api_view(["POST"])
def enquiry_cancel(request, pk):
    with transaction.atomic():
        enquiry = get_object_or_404(Enquiry.objects.select_for_update(), pk=pk, consumer=request.user)
        if enquiry.status != "pending":
            raise ValidationError("Only an unanswered enquiry can be cancelled.")
        enquiry.status = "cancelled"
        enquiry.save(update_fields=["status"])
        notify_parties(enquiry, "cancelled", "The buyer cancelled this enquiry. Stock remains deducted until reconciled.")
        notify_reconciliation(enquiry)
    return Response(EnquirySerializer(enquiry).data)


@api_view(["POST"])
def accept_offer(request, pk):
    class Input(serializers.Serializer):
        key = serializers.UUIDField()
        contact = serializers.CharField(max_length=200)
        message = serializers.CharField(max_length=1000, allow_blank=True, default="")

    data = Input(data=request.data)
    data.is_valid(raise_exception=True)
    bid = get_object_or_404(Bid.objects.select_related("request", "listing"), pk=pk)
    if bid.request.consumer_id != request.user.pk:
        raise PermissionDenied("Only the request owner can choose this offer.")

    def create():
        with transaction.atomic():
            need = ProduceRequest.objects.select_for_update().get(pk=bid.request_id)
            existing = Enquiry.objects.filter(key=data.validated_data["key"]).exists()
            if not existing and (need.status != "open" or need.deadline < timezone.localdate()):
                raise ValidationError("This request is no longer open.")
            if bid.listing.unit != need.unit:
                raise ValidationError("The offer no longer matches the requested unit.")
            return send_enquiry(
                request.user, [{"listing": bid.listing_id, "quantity": need.quantity}],
                need=need, price=bid.price, **data.validated_data,
            )
    return enquiry_response(create)


@api_view(["POST"])
def inventory_update(request, pk):
    class Update(serializers.Serializer):
        quantity = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
        available_until = serializers.DateTimeField()
        state = serializers.ChoiceField(choices=["active", "archived"])
        reason = serializers.CharField(max_length=500)
        kind = serializers.ChoiceField(choices=["reconcile", "offline_sale", "spoiled", "returned"], default="reconcile")

    data = Update(data=request.data)
    data.is_valid(raise_exception=True)
    listing = reconcile_stock(request.user, pk, **data.validated_data)
    notify_hub_matches()
    return Response(ListingSerializer(listing, context={"request": request}).data)


@api_view(["POST"])
def hub_dispatch(request, pk):
    require_role(request.user, "farmer")

    class Dispatch(serializers.Serializer):
        quantity = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
        hub = serializers.PrimaryKeyRelatedField(queryset=Hub.objects.all())

    data = Dispatch(data=request.data)
    data.is_valid(raise_exception=True)
    listing = dispatch_to_hub(request.user, pk, **data.validated_data)
    return Response(ListingSerializer(listing, context={"request": request}).data, status=201)


@api_view(["POST"])
def hub_receive(request, pk):
    require_role(request.user, "manager")

    class Receipt(serializers.Serializer):
        quantity = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
        note = serializers.CharField(max_length=200)

    data = Receipt(data=request.data)
    data.is_valid(raise_exception=True)
    listing = receive_stock(request.user, pk, **data.validated_data)
    notify_hub_matches()
    return Response(ListingSerializer(listing, context={"request": request}).data)


class NotificationsView(APIView):
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.query_params.get("owner") and request.query_params["owner"] != str(request.user.pk):
            raise PermissionDenied("The signed-in account changed. Reload your notifications.")

    def get(self, request):
        class Query(serializers.Serializer):
            summary = serializers.BooleanField(default=False)
            unread = serializers.BooleanField(default=False)
            snapshot = serializers.IntegerField(min_value=0, required=False)
            kind = serializers.ChoiceField(choices=["enquiry", "stock", "hub", "bag", "general"], required=False)
            id = serializers.IntegerField(min_value=1, required=False)

        query = Query(data=request.query_params)
        query.is_valid(raise_exception=True)
        queryset = Notification.objects.filter(recipient=request.user)
        latest_id = queryset.order_by("-pk").values_list("pk", flat=True).first() or 0
        summary = {"unread": queryset.filter(read_at__isnull=True).count(), "latest_id": latest_id}
        if query.validated_data["summary"]:
            return Response(summary)
        snapshot = query.validated_data.get("snapshot", latest_id)
        queryset = queryset.filter(pk__lte=snapshot)
        if query.validated_data["unread"]:
            queryset = queryset.filter(read_at__isnull=True)
        if request.query_params.get("q"):
            text = request.query_params["q"].strip()
            queryset = queryset.filter(Q(title__icontains=text) | Q(context__icontains=text) | Q(message__icontains=text))
        if "kind" in query.validated_data:
            queryset = queryset.filter(kind=query.validated_data["kind"])
        if "id" in query.validated_data:
            queryset = queryset.filter(pk=query.validated_data["id"])
        paginator = CursorPagination()
        paginator.page_size = 20
        paginator.ordering = "-pk"
        count = queryset.count()
        items = paginator.paginate_queryset(queryset, request)

        def cursor(link):
            return parse_qs(urlsplit(link).query)["cursor"][0] if link else None

        return Response({
            **summary, "snapshot": snapshot, "count": count,
            "next_cursor": cursor(paginator.get_next_link()), "previous_cursor": cursor(paginator.get_previous_link()),
            "items": [{
                "id": item.pk, "title": item.title, "kind": item.kind, "context": item.context,
                "message": item.message, "link": item.link, "read_at": item.read_at, "created_at": item.created_at,
            } for item in items],
        })

    def post(self, request):
        class Read(serializers.Serializer):
            id = serializers.IntegerField(min_value=1, required=False)
            ids = serializers.ListField(child=serializers.IntegerField(min_value=1), allow_empty=False, max_length=20, required=False)

            def validate(self, attrs):
                if ("id" in attrs) == ("ids" in attrs):
                    raise serializers.ValidationError("Provide one notification id or up to 20 displayed notification ids.")
                return attrs

        data = Read(data=request.data)
        data.is_valid(raise_exception=True)
        ids = set(data.validated_data.get("ids", [data.validated_data.get("id")]))
        queryset = Notification.objects.filter(recipient=request.user, pk__in=ids)
        if queryset.count() != len(ids):
            raise NotFound("One or more notifications are not available in your inbox.")
        changed = queryset.filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response({"detail": "Notifications marked as read.", "updated": changed})


class CartView(APIView):
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.query_params.get("owner") and request.query_params["owner"] != str(request.user.pk):
            raise PermissionDenied("The signed-in account changed. Reload your private bag.")

    def get(self, request):
        return Response(list(SavedCartItem.objects.filter(consumer=request.user, expires_at__gt=timezone.now()).values("listing_id", "quantity", "expires_at")))

    def put(self, request):
        class Line(serializers.Serializer):
            listing_id = serializers.PrimaryKeyRelatedField(queryset=Listing.objects.all())
            quantity = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
            expires_at = serializers.DateTimeField()

        data = Line(data=request.data, many=True, max_length=100)
        data.is_valid(raise_exception=True)
        for line in data.validated_data:
            validate_quantity(line["listing_id"].unit, line["quantity"])
        ids = [line["listing_id"].pk for line in data.validated_data]
        if len(set(ids)) != len(ids):
            raise ValidationError("Duplicate bag items are not allowed.")
        now = timezone.now()
        with transaction.atomic():
            # Serialize snapshots for one account, including an initially empty cart.
            get_user_model().objects.select_for_update().get(pk=request.user.pk)
            SavedCartItem.objects.filter(consumer=request.user).exclude(listing_id__in=ids).delete()
            for line in data.validated_data:
                listing = line["listing_id"]
                expiry = min(line["expires_at"], now + timedelta(hours=24), listing.available_until)
                if expiry <= now:
                    SavedCartItem.objects.filter(consumer=request.user, listing=listing).delete()
                    continue
                entry, created = SavedCartItem.objects.get_or_create(
                    consumer=request.user, listing=listing,
                    defaults={"quantity": line["quantity"], "expires_at": expiry},
                )
                if not created:
                    entry.quantity, entry.expires_at = line["quantity"], min(expiry, entry.expires_at)
                    entry.save(update_fields=["quantity", "expires_at"])
        return self.get(request)


@api_view(["POST"])
def retired_checkout(request, **kwargs):
    return Response({"detail": "Online payment and managed delivery are unavailable. Send an enquiry to arrange directly with the farmer."}, status=410)
