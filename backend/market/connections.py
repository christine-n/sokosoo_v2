from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import F, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from .models import Enquiry, EnquiryItem, Listing, Notification, ProduceRequest, SavedCartItem, StockMovement
from .serializers import validate_quantity


def notify(user_id, key, message, link, *, title, kind, listing, context=""):
    farmer = listing.farmer
    profile = getattr(farmer, "profile", None)
    farm = (profile.farm_name.strip() if profile else "") or farmer.get_full_name() or farmer.username
    origin = f"{farm} · {listing.hub.name}" if listing.hub_id else farm
    Notification.objects.get_or_create(
        recipient_id=user_id, event_key=key,
        defaults={"message": message, "link": link, "title": f"{title} · {origin}", "kind": kind, "context": context},
    )


def notify_parties(enquiry, event, message):
    title = {
        "sent": "Enquiry sent", "accepted": "Enquiry accepted", "declined": "Enquiry declined",
        "cancelled": "Enquiry cancelled", "expired": "Enquiry expired", "reminder": "Enquiry response due soon",
    }.get(event, "Enquiry availability changed")
    items = list(enquiry.items.select_related("listing__farmer__profile", "listing__hub"))
    context = ", ".join(item.name for item in items)[:240]
    for user_id in {enquiry.consumer_id, enquiry.farmer_id}:
        notify(user_id, f"enquiry:{enquiry.pk}:{event}", message, f"/?view=enquiries&enquiry={enquiry.pk}",
               title=title, kind="enquiry", listing=items[0].listing, context=context)


def record_stock(listing, actor, kind, change, note):
    StockMovement.objects.create(
        listing=listing, actor=actor, kind=kind, change=change, balance=listing.quantity, note=note,
    )


def stock_is_active(listing):
    return listing.state == "active" and listing.available_until > timezone.now() and (
        listing.channel == "direct" or listing.received
    )


def check_inventory_access(user, listing):
    if user.is_staff:
        return
    owner = listing.farmer_id if listing.channel == "direct" else listing.hub.manager_id
    if user.pk != owner:
        raise PermissionDenied("Farmers manage farm stock; the responsible hub manager manages received hub stock.")


def hub_matches(need):
    if not need.hub_id or not need.product_name or not need.category or need.status != "open" or need.deadline < timezone.localdate():
        return Listing.objects.none()
    return Listing.objects.filter(
        channel="hub", received=True, state="active", available_until__gt=timezone.now(),
        hub_id=need.hub_id, category=need.category, unit=need.unit,
        name__icontains=need.product_name, quantity__gte=F("reserved") + need.quantity,
    ).exclude(farmer_id=need.consumer_id)


def notify_hub_matches():
    for need in ProduceRequest.objects.filter(status="open", hub__isnull=False).iterator():
        for listing in hub_matches(need):
            notify(need.consumer_id, f"hub-match:{need.pk}:{listing.pk}",
                   f"{listing.name} is listed at {listing.hub.name} for your request. Availability is checked when you enquire.",
                   f"/?view=product&id={listing.pk}", title="Produce found at your hub", kind="hub",
                   listing=listing, context=listing.name)


@transaction.atomic
def send_enquiry(user, items, key, message, contact, need=None, price=None):
    merged = {}
    for item in items:
        merged[item["listing"]] = merged.get(item["listing"], Decimal("0")) + item["quantity"]
    existing = Enquiry.objects.filter(key=key).first()
    if existing:
        original = {item.listing_id: item.quantity for item in existing.items.all()}
        if existing.consumer_id != user.pk or original != merged or existing.contact != contact or existing.message != message or existing.request_id != (need.pk if need else None):
            raise ValidationError("This enquiry key was already used for different details. Start a new enquiry.")
        return existing
    if not merged:
        raise ValidationError("Add at least one product.")
    listings = []
    origins = set()
    for listing_id, quantity in sorted(merged.items()):
        listing = get_object_or_404(Listing.objects.select_for_update().select_related("hub"), pk=listing_id)
        validate_quantity(listing.unit, quantity)
        if listing.farmer_id == user.pk:
            raise ValidationError("You cannot enquire about your own produce.")
        if quantity <= 0 or not stock_is_active(listing) or listing.quantity - listing.reserved < quantity:
            raise ValidationError(f"{listing.name}: the requested quantity is no longer available. Update your bag or choose other produce.")
        origins.add((listing.farmer_id, listing.channel, listing.hub_id))
        listings.append((listing, quantity))
    if len(origins) != 1:
        raise ValidationError("Send a separate enquiry for each farmer and farm or hub origin.")
    enquiry = Enquiry.objects.create(
        consumer=user, farmer_id=listings[0][0].farmer_id, key=key, message=message, contact=contact, request=need,
    )
    for listing, quantity in listings:
        changed = Listing.objects.filter(
            pk=listing.pk, state="active", available_until__gt=timezone.now(),
            quantity__gte=F("reserved") + quantity,
        ).update(quantity=F("quantity") - quantity)
        if changed != 1:
            raise ValidationError("Stock changed while sending your enquiry. Refresh and try again.")
        listing.refresh_from_db()
        EnquiryItem.objects.create(
            enquiry=enquiry, listing=listing, name=listing.name, unit=listing.unit, quantity=quantity,
            price=price if price is not None else listing.price,
            location=listing.hub.location if listing.hub_id else listing.location,
        )
        record_stock(listing, user, "enquiry", -quantity, f"Allocated to enquiry {enquiry.pk}. Not proof of a sale.")
        SavedCartItem.objects.filter(consumer=user, listing=listing).delete()
    if need:
        need.status = "enquiry_sent"
        need.save(update_fields=["status"])
    notify_parties(enquiry, "sent",
                   "Enquiry sent. The requested stock is deducted from availability. Payment, collection and delivery are arranged directly with the farmer; SokoSoo does not manage them.")
    return enquiry


@transaction.atomic
def respond_to_enquiry(user, pk, status, response, pickup_details):
    enquiry = get_object_or_404(Enquiry.objects.select_for_update(), pk=pk)
    if enquiry.farmer_id != user.pk:
        raise PermissionDenied("Only the named farmer can respond to this enquiry.")
    if enquiry.status != "pending" or enquiry.expires_at <= timezone.now():
        raise ValidationError("This enquiry is no longer awaiting a response.")
    if status == "accepted" and not pickup_details.strip():
        raise ValidationError({"pickup_details": "Include your contact details and the farm or hub location."})
    enquiry.status, enquiry.response, enquiry.pickup_details = status, response, pickup_details
    enquiry.responded_at = timezone.now()
    enquiry.save(update_fields=["status", "response", "pickup_details", "responded_at"])
    notify_parties(enquiry, status, f"The farmer {status} the enquiry. Stock is not restored automatically. Arrange any next steps directly.")
    if status == "declined":
        notify_reconciliation(enquiry)
    return enquiry


def notify_reconciliation(enquiry):
    for item in enquiry.items.select_related("listing__hub"):
        listing = item.listing
        owner = listing.hub.manager_id if listing.hub_id else listing.farmer_id
        if owner:
            notify(owner, f"reconcile:{enquiry.pk}:{listing.pk}",
                   f"Review {listing.name} stock after an enquiry was {enquiry.status}. Deducted quantities have not been restored.",
                   "/?view=manage" if listing.hub_id else "/?view=farm",
                   title="Stock check needed", kind="stock", listing=listing, context=listing.name)


@transaction.atomic
def reconcile_stock(user, pk, quantity, available_until, state, reason, kind="reconcile"):
    listing = get_object_or_404(Listing.objects.select_for_update().select_related("hub"), pk=pk)
    check_inventory_access(user, listing)
    validate_quantity(listing.unit, quantity)
    if listing.channel == "hub" and not listing.received:
        raise ValidationError("Confirm actual receipt before reconciling hub stock.")
    if quantity < listing.reserved:
        raise ValidationError("Quantity cannot be lower than legacy reserved stock.")
    if state == "active" and available_until <= timezone.now():
        raise ValidationError({"available_until": "Choose a future availability deadline."})
    change = quantity - listing.quantity
    if kind in ["spoiled", "returned", "offline_sale"] and change >= 0:
        raise ValidationError("This adjustment must reduce the available quantity.")
    listing.quantity, listing.available_until, listing.state = quantity, available_until, state
    listing.save(update_fields=["quantity", "available_until", "state"])
    record_stock(listing, user, kind, change, reason)
    if listing.hub_id:
        notify(listing.farmer_id, f"movement:{listing.movements.first().pk}",
               f"{listing.hub.name} updated {listing.name}: {reason}", "/?view=farm",
               title="Hub stock updated", kind="stock", listing=listing, context=listing.name)
    return listing


@transaction.atomic
def dispatch_to_hub(user, pk, hub, quantity):
    source = get_object_or_404(Listing.objects.select_for_update(), pk=pk, farmer=user, channel="direct")
    validate_quantity(source.unit, quantity)
    if not stock_is_active(source) or quantity > source.quantity - source.reserved:
        raise ValidationError("Not enough active farm stock for this transfer.")
    changed = Listing.objects.filter(pk=source.pk, quantity__gte=F("reserved") + quantity).update(quantity=F("quantity") - quantity)
    if changed != 1:
        raise ValidationError("Stock changed during dispatch. Please try again.")
    source.refresh_from_db()
    record_stock(source, user, "dispatch", -quantity, f"Dispatched to {hub.name}.")
    drop = Listing.objects.create(
        farmer=user, name=source.name, category=source.category, description=source.description,
        price=source.price, quantity=0, unit=source.unit, channel="hub", hub=hub,
        location=source.location, latitude=source.latitude, longitude=source.longitude,
        harvest_date=source.harvest_date, image=source.image, available_until=source.available_until,
        source=source, dispatched_quantity=quantity,
    )
    record_stock(drop, user, "in_transit", 0, f"{quantity} {source.unit} dispatched; awaiting actual receipt.")
    if hub.manager_id:
        notify(hub.manager_id, f"dispatch:{drop.pk}", f"{quantity} {source.unit} of {drop.name} is awaiting receipt at {hub.name}.", "/?view=manage",
               title="Hub receipt needed", kind="hub", listing=drop, context=drop.name)
    notify(user.pk, f"dispatch:{drop.pk}", f"Your {drop.name} transfer to {hub.name} is recorded. It is not yet available at the hub.", "/?view=farm",
           title="Transfer recorded", kind="hub", listing=drop, context=drop.name)
    return drop


@transaction.atomic
def receive_stock(user, pk, quantity, note):
    listing = get_object_or_404(Listing.objects.select_for_update().select_related("hub"), pk=pk, channel="hub")
    check_inventory_access(user, listing)
    validate_quantity(listing.unit, quantity)
    if listing.received:
        raise ValidationError("This batch has already been received.")
    if quantity > listing.dispatched_quantity:
        raise ValidationError("Receipt cannot exceed the dispatched quantity.")
    listing.received = True
    listing.received_quantity = quantity
    listing.quantity = quantity
    listing.save(update_fields=["received", "received_quantity", "quantity"])
    rejected = listing.dispatched_quantity - quantity
    details = f"Received {quantity}; rejected/not accepted {rejected} {listing.unit}. {note}"
    record_stock(listing, user, "receipt", quantity, details)
    notify(listing.farmer_id, f"receipt:{listing.pk}", f"{listing.hub.name}: {listing.name}. {details}", "/?view=farm",
           title="Hub receipt confirmed", kind="hub", listing=listing, context=listing.name)
    return listing


def cleanup_marketplace():
    now = timezone.now()
    for pk in Enquiry.objects.filter(status="pending", expires_at__lte=now).values_list("pk", flat=True):
        with transaction.atomic():
            enquiry = Enquiry.objects.select_for_update().get(pk=pk)
            if enquiry.status != "pending":
                continue
            enquiry.status = "expired"
            enquiry.save(update_fields=["status"])
            notify_parties(enquiry, "expired", "The enquiry expired without a farmer response. Stock remains deducted pending reconciliation.")
            notify_reconciliation(enquiry)
    for enquiry in Enquiry.objects.filter(status="pending", expires_at__gt=now, expires_at__lte=now + timedelta(hours=1)):
        notify_parties(enquiry, "reminder", "Your enquiry awaits a farmer response and expires within one hour.")
    for listing in Listing.objects.filter(state="active", available_until__gt=now, available_until__lte=now + timedelta(hours=1)).select_related("hub"):
        notify(listing.farmer_id, f"availability-reminder:{listing.pk}:{listing.available_until.isoformat()}",
               f"{listing.name} will be archived within one hour. Reconfirm actual stock if it remains available.", "/?view=farm",
               title="Listing expires soon", kind="stock", listing=listing, context=listing.name)
        if listing.hub_id and listing.hub.manager_id:
            notify(listing.hub.manager_id, f"availability-reminder:{listing.pk}:{listing.available_until.isoformat()}",
                   f"{listing.name} at your hub will be archived within one hour. Reconfirm actual stock if still available.", "/?view=manage",
                   title="Listing expires soon", kind="stock", listing=listing, context=listing.name)
    for pk in Listing.objects.filter(state="active", available_until__lte=now).values_list("pk", flat=True):
        with transaction.atomic():
            listing = Listing.objects.select_for_update().get(pk=pk)
            if listing.state != "active" or listing.available_until > now:
                continue
            listing.state = "archived"
            listing.save(update_fields=["state"])
            event = f"listing:{pk}:{listing.available_until.isoformat()}"
            notify(listing.farmer_id, event, f"{listing.name} was archived. Review actual stock before relisting.", "/?view=farm",
                   title="Listing archived", kind="stock", listing=listing, context=listing.name)
            if listing.hub_id and listing.hub.manager_id:
                notify(listing.hub.manager_id, event, f"{listing.name} at your hub was archived. Reconcile availability before relisting.", "/?view=manage",
                       title="Listing archived", kind="stock", listing=listing, context=listing.name)
            for enquiry in Enquiry.objects.filter(items__listing=listing, status__in=["pending", "accepted"]).distinct():
                notify_parties(enquiry, event, f"The listing for {listing.name} expired. Contact the farmer to reconfirm availability.")
    unavailable_carts = SavedCartItem.objects.filter(
        Q(listing__state="archived") | Q(listing__available_until__lte=now) |
        Q(listing__quantity__lte=F("listing__reserved")) | Q(listing__channel="hub", listing__received=False)
    )
    for item in unavailable_carts.select_related("listing"):
        notify(item.consumer_id, f"cart:{item.pk}:unavailable",
               f"{item.listing.name} was removed from your private bag because the listing is unavailable. No enquiry was sent.",
               "/?view=cart", title="Unavailable item removed", kind="bag", listing=item.listing, context=item.listing.name)
    unavailable_carts.delete()
    for item in SavedCartItem.objects.filter(expires_at__lte=now + timedelta(hours=1)).select_related("listing"):
        expired = item.expires_at <= now
        notify(item.consumer_id, f"cart:{item.pk}:{'expired' if expired else 'reminder'}",
               f"{item.listing.name} {'was removed from your private bag at its deadline' if expired else 'will leave your private bag within one hour'}. No enquiry was sent.",
               "/?view=cart", title="Bag item expired" if expired else "Bag item expires soon", kind="bag", listing=item.listing, context=item.listing.name)
    SavedCartItem.objects.filter(expires_at__lte=now).delete()
    ProduceRequest.objects.filter(status="open", deadline__lt=timezone.localdate()).update(status="expired")
    notify_hub_matches()
