import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.utils import timezone


def availability_deadline():
    return timezone.now() + timedelta(hours=24)


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=16, choices=[
        ("consumer", "Consumer"), ("farmer", "Farmer"), ("manager", "Hub manager"), ("driver", "Driver"),
    ], default="consumer")
    farm_name = models.CharField(max_length=120, blank=True)


class Hub(models.Model):
    name = models.CharField(max_length=120)
    location = models.CharField(max_length=120)
    latitude = models.FloatField()
    longitude = models.FloatField()
    manager = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

    def __str__(self):
        return self.name


class Listing(models.Model):
    CATEGORY_CHOICES = [
        ("vegetables", "Vegetables"), ("fruits", "Fruits"), ("dairy", "Dairy & eggs"),
        ("grains", "Grains & pulses"), ("livestock", "Livestock"), ("byproducts", "Byproducts"),
    ]
    farmer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    name = models.CharField(max_length=120)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    reserved = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit = models.CharField(max_length=12, choices=[("kg", "kg"), ("litre", "litre"), ("tray", "tray"), ("head", "head"), ("piece", "piece")])
    channel = models.CharField(max_length=10, choices=[("direct", "Direct"), ("hub", "Hub")])
    hub = models.ForeignKey(Hub, null=True, blank=True, on_delete=models.PROTECT)
    location = models.CharField(max_length=120)
    latitude = models.FloatField()
    longitude = models.FloatField()
    harvest_date = models.DateField()
    image = models.URLField(blank=True)
    received = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    state = models.CharField(max_length=12, default="active", choices=[("active", "Active"), ("archived", "Archived")])
    available_until = models.DateTimeField(default=availability_deadline)
    source = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="hub_transfers")
    dispatched_quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    received_quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(price__gt=0), name="listing_price_positive"),
            models.CheckConstraint(condition=Q(quantity__gte=0), name="listing_quantity_nonnegative"),
            models.CheckConstraint(condition=Q(reserved__gte=0) & Q(reserved__lte=F("quantity")), name="listing_reservation_valid"),
            models.CheckConstraint(condition=Q(channel="direct", hub__isnull=True) | Q(channel="hub", hub__isnull=False), name="listing_source_valid"),
        ]


class ProduceRequest(models.Model):
    consumer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=120)
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    unit = models.CharField(max_length=12)
    budget = models.DecimalField(max_digits=12, decimal_places=2)
    location = models.CharField(max_length=120)
    notes = models.TextField(blank=True)
    deadline = models.DateField()
    status = models.CharField(max_length=24, default="open")
    created_at = models.DateTimeField(auto_now_add=True)
    product_name = models.CharField(max_length=120, blank=True)
    category = models.CharField(max_length=20, blank=True, choices=Listing.CATEGORY_CHOICES)
    hub = models.ForeignKey(Hub, null=True, blank=True, on_delete=models.PROTECT)


class Bid(models.Model):
    request = models.ForeignKey(ProduceRequest, on_delete=models.CASCADE, related_name="bids")
    farmer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    message = models.CharField(max_length=400, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["request", "farmer"], name="one_bid_per_farmer")]


class Order(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    consumer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="purchases")
    driver = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="deliveries")
    request = models.ForeignKey(ProduceRequest, null=True, blank=True, on_delete=models.PROTECT)
    idempotency_key = models.UUIDField(unique=True, default=uuid.uuid4)
    address = models.CharField(max_length=300)
    total = models.DecimalField(max_digits=12, decimal_places=2)
    payment_method = models.CharField(max_length=12, default="mpesa")
    payment_status = models.CharField(max_length=24, default="not_initiated")
    status = models.CharField(max_length=24, default="pending_payment")
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["request"],
                condition=Q(status__in=["pending_payment", "processing", "picked", "en_route", "delivered"]),
                name="one_live_award_per_request",
            ),
        ]


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    price = models.DecimalField(max_digits=10, decimal_places=2)


class DeliveryEvent(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="events")
    status = models.CharField(max_length=24)
    created_at = models.DateTimeField(auto_now_add=True)


class LocationPing(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="pings")
    latitude = models.FloatField()
    longitude = models.FloatField()
    accuracy = models.FloatField()
    recorded_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-recorded_at"]


class Review(models.Model):
    order = models.OneToOneField(Order, on_delete=models.CASCADE, related_name="review")
    produce_rating = models.PositiveSmallIntegerField()
    delivery_rating = models.PositiveSmallIntegerField()
    comment = models.CharField(max_length=1000, blank=True)


class Enquiry(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    consumer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="enquiries_sent")
    farmer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="enquiries_received")
    request = models.OneToOneField(ProduceRequest, null=True, blank=True, on_delete=models.PROTECT)
    key = models.UUIDField(unique=True)
    message = models.CharField(max_length=1000, blank=True)
    contact = models.CharField(max_length=200)
    status = models.CharField(max_length=12, default="pending", choices=[
        ("pending", "Awaiting farmer"), ("accepted", "Accepted"), ("declined", "Declined"),
        ("cancelled", "Cancelled"), ("expired", "Expired"),
    ])
    response = models.CharField(max_length=1000, blank=True)
    pickup_details = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(default=availability_deadline)
    responded_at = models.DateTimeField(null=True, blank=True)


class EnquiryItem(models.Model):
    enquiry = models.ForeignKey(Enquiry, on_delete=models.CASCADE, related_name="items")
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT)
    name = models.CharField(max_length=120)
    unit = models.CharField(max_length=12)
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    location = models.CharField(max_length=120)


class StockMovement(models.Model):
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT, related_name="movements")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    kind = models.CharField(max_length=24)
    change = models.DecimalField(max_digits=12, decimal_places=2)
    balance = models.DecimalField(max_digits=12, decimal_places=2)
    note = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-pk"]


class Notification(models.Model):
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    event_key = models.CharField(max_length=180)
    message = models.CharField(max_length=1000)
    title = models.CharField(max_length=400, default="Update")
    kind = models.CharField(max_length=16, default="general", choices=[
        ("enquiry", "Enquiry"), ("stock", "Stock"), ("hub", "Hub"), ("bag", "Bag"), ("general", "General"),
    ])
    context = models.CharField(max_length=240, blank=True)
    link = models.CharField(max_length=300)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-pk"]
        constraints = [models.UniqueConstraint(fields=["recipient", "event_key"], name="notification_once_per_recipient")]


class SavedCartItem(models.Model):
    consumer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=12, decimal_places=2)
    expires_at = models.DateTimeField(default=availability_deadline)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["consumer", "listing"], name="one_private_cart_line"),
            models.CheckConstraint(condition=Q(quantity__gt=0), name="cart_quantity_positive"),
        ]
