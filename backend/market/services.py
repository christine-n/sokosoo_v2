from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import DeliveryEvent, Listing, Order, OrderItem, ProduceRequest


@transaction.atomic
def release_order(order, status):
    order = Order.objects.select_for_update().get(pk=order.pk)
    if order.status != "pending_payment":
        return
    for item in order.items.all():
        Listing.objects.filter(pk=item.listing_id).update(reserved=F("reserved") - item.quantity)
    order.status = status
    order.save(update_fields=["status"])
    if order.request_id:
        ProduceRequest.objects.filter(pk=order.request_id).update(status="open")
    DeliveryEvent.objects.create(order=order, status=status)


def expire_reservations():
    for order in Order.objects.filter(status="pending_payment", expires_at__lte=timezone.now()):
        release_order(order, "expired")


@transaction.atomic
def create_order(user, items, address, method, key, produce_request=None, bid_price=None):
    if not items:
        raise ValidationError("Add at least one product.")
    if method not in ["mpesa", "card"]:
        raise ValidationError("Choose M-Pesa or card.")
    if not address.strip():
        raise ValidationError("Enter a delivery address.")
    merged = {}
    for item in items:
        listing_id = item["listing"]
        merged[listing_id] = merged.get(listing_id, Decimal("0")) + item["quantity"]
    existing = Order.objects.filter(idempotency_key=key).first()
    if existing:
        if existing.consumer_id != user.pk:
            raise ValidationError("This checkout key is already in use.")
        original_items = {item.listing_id: item.quantity for item in existing.items.all()}
        if (
            original_items != merged or existing.address != address.strip()
            or existing.payment_method != method
            or existing.request_id != (produce_request.pk if produce_request else None)
        ):
            raise ValidationError("This checkout key was used for different details. Start a new checkout.")
        return existing
    lines = []
    total = Decimal("0")
    origins = set()
    for listing_id, quantity in sorted(merged.items()):
        listing = Listing.objects.select_for_update().filter(pk=listing_id).first()
        if not listing or (listing.channel == "hub" and not listing.received):
            raise ValidationError("A product is no longer available.")
        if listing.farmer_id == user.pk:
            raise ValidationError("You cannot purchase your own produce.")
        if quantity <= 0 or quantity > listing.quantity - listing.reserved:
            raise ValidationError(f"Not enough {listing.name} available.")
        price = bid_price if bid_price is not None else listing.price
        origins.add((listing.farmer_id, listing.channel, listing.hub_id))
        lines.append((listing, quantity, price))
        total += quantity * price
    # The first slice deliberately keeps one seller/pickup per order.
    if len(origins) > 1:
        raise ValidationError("Check out each farm or hub pickup separately.")
    order = Order.objects.create(
        consumer=user, address=address.strip(), payment_method=method,
        idempotency_key=key, total=total.quantize(Decimal("0.01")),
        expires_at=timezone.now() + timedelta(minutes=15), request=produce_request,
    )
    for listing, quantity, price in lines:
        changed = Listing.objects.filter(pk=listing.pk, quantity__gte=F("reserved") + quantity).update(
            reserved=F("reserved") + quantity
        )
        if changed != 1:
            raise ValidationError("Stock changed during checkout. Please try again.")
        OrderItem.objects.create(order=order, listing=listing, quantity=quantity, price=price)
    DeliveryEvent.objects.create(order=order, status="pending_payment")
    return order
