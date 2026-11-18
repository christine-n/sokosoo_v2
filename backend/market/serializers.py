from datetime import date
from decimal import Decimal

from rest_framework import serializers
from django.utils import timezone

from .models import Bid, Hub, Listing, Order, ProduceRequest, Review


def display_name(user):
    return user.first_name or user.username


def validate_quantity(unit, quantity):
    if unit == "head" and quantity % 1:
        raise serializers.ValidationError({"quantity": "Enter a whole number of animals (head)."})


class HubSerializer(serializers.ModelSerializer):
    class Meta:
        model = Hub
        fields = ["id", "name", "location", "latitude", "longitude"]


class ListingSerializer(serializers.ModelSerializer):
    farmer_name = serializers.SerializerMethodField()
    farm_name = serializers.CharField(source="farmer.profile.farm_name", read_only=True)
    available = serializers.SerializerMethodField()
    hub_name = serializers.CharField(source="hub.name", read_only=True, default=None)
    distance = serializers.FloatField(read_only=True, required=False)
    movements = serializers.SerializerMethodField()

    class Meta:
        model = Listing
        fields = [
            "id", "farmer", "farmer_name", "farm_name", "name", "category", "description",
            "price", "quantity", "available", "unit", "channel", "hub", "hub_name",
            "location", "latitude", "longitude", "harvest_date", "image", "received", "distance",
            "state", "available_until", "source", "dispatched_quantity", "received_quantity", "movements",
        ]
        read_only_fields = ["farmer", "received", "state", "source", "dispatched_quantity", "received_quantity"]

    def get_movements(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return []
        if request.user.pk != obj.farmer_id and not request.user.is_staff and not (obj.hub_id and obj.hub.manager_id == request.user.pk):
            return []
        return list(obj.movements.values("id", "kind", "change", "balance", "note", "created_at")[:100])

    def validate_available_until(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError("Choose a future availability deadline.")
        return value

    def get_farmer_name(self, obj):
        return display_name(obj.farmer)

    def get_available(self, obj):
        return str(obj.quantity - obj.reserved)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.channel == "hub" and instance.hub:
            data["location"] = instance.hub.location
        return data

    def validate(self, attrs):
        validate_quantity(attrs["unit"], attrs["quantity"])
        if attrs["price"] <= 0 or attrs["quantity"] <= 0:
            raise serializers.ValidationError("Price and quantity must be greater than zero.")
        if not -90 <= attrs["latitude"] <= 90 or not -180 <= attrs["longitude"] <= 180:
            raise serializers.ValidationError("Enter valid coordinates.")
        if attrs["harvest_date"] > date.today():
            raise serializers.ValidationError("The harvest, production or slaughter date cannot be in the future.")
        if attrs["channel"] == "hub" and not attrs.get("hub"):
            raise serializers.ValidationError("Select a hub for this stock.")
        if attrs["channel"] == "hub":
            raise serializers.ValidationError("List stock at the farm first, then dispatch a quantity to a hub from your inventory.")
        if attrs["channel"] == "direct" and attrs.get("hub"):
            raise serializers.ValidationError("Direct stock must use the farm pickup location.")
        return attrs


class BidSerializer(serializers.ModelSerializer):
    farmer_name = serializers.CharField(source="farmer.first_name", read_only=True)
    farm_name = serializers.CharField(source="farmer.profile.farm_name", read_only=True)
    listing_name = serializers.CharField(source="listing.name", read_only=True)
    is_mine = serializers.SerializerMethodField()

    def get_is_mine(self, obj):
        request = self.context.get("request")
        return bool(request and request.user.pk == obj.farmer_id)

    class Meta:
        model = Bid
        fields = ["id", "farmer_name", "farm_name", "listing", "listing_name", "price", "message", "is_mine"]
        read_only_fields = ["id"]
        extra_kwargs = {"price": {"min_value": Decimal("0.01")}}


class RequestSerializer(serializers.ModelSerializer):
    consumer_name = serializers.CharField(source="consumer.first_name", read_only=True)
    bids = BidSerializer(many=True, read_only=True)
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = ProduceRequest
        fields = ["id", "consumer_name", "name", "product_name", "category", "hub", "quantity", "unit", "budget", "location", "notes", "deadline", "status", "bids", "is_owner", "hub_matches"]
        read_only_fields = ["status"]
        extra_kwargs = {
            "quantity": {"min_value": Decimal("0.01")},
            "budget": {"min_value": Decimal("0.01")},
            "unit": {"validators": []},
        }

    def get_is_owner(self, obj):
        return self.context["request"].user.pk == obj.consumer_id

    hub_matches = serializers.SerializerMethodField()

    def get_hub_matches(self, obj):
        from .connections import hub_matches
        return list(hub_matches(obj).values("id", "name", "hub_id")[:10])

    def validate_deadline(self, value):
        if value < date.today():
            raise serializers.ValidationError("Choose today or a future date.")
        return value

    def validate_unit(self, value):
        if value not in dict(Listing._meta.get_field("unit").choices):
            raise serializers.ValidationError("Choose a supported unit.")
        return value

    def validate(self, attrs):
        validate_quantity(attrs["unit"], attrs["quantity"])
        if attrs.get("hub") and (not attrs.get("product_name") or not attrs.get("category")):
            raise serializers.ValidationError("Hub alerts need a produce name and category to match reliably.")
        return attrs


class ReviewSerializer(serializers.ModelSerializer):
    class Meta:
        model = Review
        fields = ["produce_rating", "delivery_rating", "comment"]
        extra_kwargs = {
            "produce_rating": {"min_value": 1, "max_value": 5},
            "delivery_rating": {"min_value": 1, "max_value": 5},
        }


class OrderSerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()
    events = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    review = ReviewSerializer(read_only=True)

    class Meta:
        model = Order
        fields = ["id", "address", "total", "payment_method", "payment_status", "status", "created_at", "expires_at", "items", "events", "location", "review"]

    def get_items(self, obj):
        return [{
            "id": item.id, "name": item.listing.name, "quantity": str(item.quantity),
            "unit": item.listing.unit, "price": str(item.price), "image": item.listing.image,
            "farmer_name": display_name(item.listing.farmer), "location": item.listing.location,
        } for item in obj.items.select_related("listing__farmer")]

    def get_events(self, obj):
        return list(obj.events.order_by("created_at").values("status", "created_at"))

    def get_location(self, obj):
        request = self.context.get("request")
        if not request or obj.status not in ["picked", "en_route"]:
            return None
        user = request.user
        if not (
            user.is_staff or user.pk in [obj.consumer_id, obj.driver_id]
            or obj.items.filter(listing__hub__manager=user).exists()
        ):
            return None
        return obj.pings.values("latitude", "longitude", "accuracy", "recorded_at").first()
