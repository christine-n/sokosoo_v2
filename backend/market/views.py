import math
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import F, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import serializers, status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import Bid, DeliveryEvent, Hub, Listing, LocationPing, Order, ProduceRequest, Profile, Review
from .serializers import BidSerializer, HubSerializer, ListingSerializer, OrderSerializer, RequestSerializer, ReviewSerializer
from .services import create_order, expire_reservations, release_order


def account(user):
    profile, _ = Profile.objects.get_or_create(user=user)
    return {"id": user.pk, "name": user.first_name or user.username, "username": user.username,
            "role": profile.role, "farm_name": profile.farm_name}


def require_role(user, *roles):
    if not user.is_staff and account(user)["role"] not in roles:
        raise PermissionDenied("Your account does not have permission for this action.")


@method_decorator(ensure_csrf_cookie, name="dispatch")
class SessionView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"user": account(request.user) if request.user.is_authenticated else None})


class CredentialsSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=200, trim_whitespace=False)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        data = CredentialsSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = authenticate(request, **data.validated_data)
        if not user:
            raise ValidationError("Incorrect username or password.")
        login(request, user)
        return Response({"user": account(user)})


class DriverTokenView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        data = CredentialsSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        user = authenticate(**data.validated_data)
        if not user:
            raise ValidationError("Incorrect username or password.")
        require_role(user, "driver")
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": account(user)})


class RegisterSerializer(CredentialsSerializer):
    name = serializers.CharField(max_length=100)
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=["consumer", "farmer"])
    farm_name = serializers.CharField(max_length=120, required=False, allow_blank=True)


@method_decorator(csrf_protect, name="dispatch")
class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        data = RegisterSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        if User.objects.filter(username__iexact=values["username"]).exists():
            raise ValidationError("This username is already taken.")
        candidate = User(username=values["username"], first_name=values["name"], email=values["email"])
        try:
            validate_password(values["password"], candidate)
        except DjangoValidationError as exc:
            raise ValidationError({"password": exc.messages}) from exc
        with transaction.atomic():
            candidate.set_password(values["password"])
            candidate.save()
            Profile.objects.create(user=candidate, role=values["role"], farm_name=values.get("farm_name", ""))
        login(request, candidate)
        return Response({"user": account(candidate)}, status=201)


@api_view(["POST"])
def logout_view(request):
    if request.auth:
        request.auth.delete()
    logout(request)
    return Response(status=204)


@api_view(["GET"])
@permission_classes([AllowAny])
def hubs(request):
    queryset = Hub.objects.all()
    query = request.query_params.get("q", "").strip()
    if query:
        queryset = queryset.filter(Q(name__icontains=query) | Q(location__icontains=query))
    return Response(HubSerializer(queryset, many=True).data)


def parse_coordinate(value, maximum):
    try:
        result = float(value)
    except (ValueError, TypeError) as exc:
        raise ValidationError("Enter valid location coordinates.") from exc
    if not math.isfinite(result) or not -maximum <= result <= maximum:
        raise ValidationError("Coordinates are out of range.")
    return result


def km_distance(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(a)))


class ListingsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        expire_reservations()
        queryset = Listing.objects.select_related("farmer__profile", "hub").filter(
            Q(channel="direct") | Q(received=True), quantity__gt=F("reserved")
        ).order_by("-created_at")
        params = request.query_params
        if params.get("mine") == "true":
            if not request.user.is_authenticated:
                raise PermissionDenied("Sign in to view your inventory.")
            queryset = Listing.objects.select_related("farmer__profile", "hub").filter(farmer=request.user).order_by("-created_at")
        if params.get("q"):
            queryset = queryset.filter(Q(name__icontains=params["q"]) | Q(location__icontains=params["q"]) | Q(farmer__profile__farm_name__icontains=params["q"]))
        for field in ["category", "channel", "hub"]:
            if params.get(field):
                if field == "hub" and not params[field].isdigit():
                    raise ValidationError("Select a valid hub.")
                queryset = queryset.filter(**{field: params[field]})
        listings = list(queryset[:500])
        if params.get("lat") is not None and params.get("lng") is not None:
            latitude = parse_coordinate(params["lat"], 90)
            longitude = parse_coordinate(params["lng"], 180)
            for listing in listings:
                origin = listing.hub if listing.channel == "hub" else listing
                listing.distance = round(km_distance(latitude, longitude, origin.latitude, origin.longitude), 1)
            if params.get("radius"):
                radius = parse_coordinate(params["radius"], 20000)
                if radius < 0:
                    raise ValidationError("Distance must be positive.")
                listings = [item for item in listings if item.distance <= radius]
        sort = params.get("sort")
        if sort in ["price_asc", "price_desc"]:
            listings.sort(key=lambda item: item.price, reverse=sort == "price_desc")
        elif sort == "distance" and listings and hasattr(listings[0], "distance"):
            listings.sort(key=lambda item: item.distance)
        return Response(ListingSerializer(listings, many=True).data)

    def post(self, request):
        if not request.user.is_authenticated:
            raise PermissionDenied("Sign in to add produce.")
        require_role(request.user, "farmer")
        serializer = ListingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(farmer=request.user, received=False)
        return Response(serializer.data, status=201)


@api_view(["GET"])
def hub_drops(request):
    require_role(request.user, "manager")
    queryset = Listing.objects.filter(channel="hub").select_related("farmer__profile", "hub")
    if not request.user.is_staff:
        queryset = queryset.filter(hub__manager=request.user)
    return Response(ListingSerializer(queryset, many=True).data)


@api_view(["POST"])
def receive_drop(request, pk):
    require_role(request.user, "manager")
    with transaction.atomic():
        listing = get_object_or_404(Listing.objects.select_for_update(), pk=pk, channel="hub")
        if not request.user.is_staff and listing.hub.manager_id != request.user.pk:
            raise PermissionDenied("This drop belongs to another hub.")
        if listing.received:
            raise ValidationError("This drop has already been received.")
        listing.received = True
        listing.save(update_fields=["received"])
    return Response(ListingSerializer(listing).data)


class RequestsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        queryset = ProduceRequest.objects.select_related("consumer").prefetch_related("bids__farmer__profile", "bids__listing").order_by("-created_at")
        query = request.query_params.get("q", "").strip()
        if query:
            queryset = queryset.filter(Q(name__icontains=query) | Q(notes__icontains=query) | Q(location__icontains=query))
        return Response(RequestSerializer(queryset[:100], many=True, context={"request": request}).data)

    def post(self, request):
        if not request.user.is_authenticated:
            raise PermissionDenied("Sign in to post a request.")
        serializer = RequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(consumer=request.user)
        return Response(serializer.data, status=201)


@api_view(["POST"])
def submit_bid(request, pk):
    require_role(request.user, "farmer")
    serializer = BidSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        need = get_object_or_404(ProduceRequest.objects.select_for_update(), pk=pk)
        listing = serializer.validated_data["listing"]
        if need.status != "open" or need.deadline < timezone.localdate():
            raise ValidationError("This request is closed or expired.")
        if need.consumer_id == request.user.pk:
            raise ValidationError("You cannot bid on your own request.")
        if listing.farmer_id != request.user.pk or listing.unit != need.unit:
            raise ValidationError("Choose your own listing with the requested unit.")
        if listing.quantity - listing.reserved < need.quantity or (listing.channel == "hub" and not listing.received):
            raise ValidationError("Your listing does not have enough available stock.")
        if Bid.objects.filter(request=need, farmer=request.user).exists():
            raise ValidationError("You have already submitted a bid.")
        serializer.save(request=need, farmer=request.user)
    return Response(serializer.data, status=201)


class CheckoutSerializer(serializers.Serializer):
    class Item(serializers.Serializer):
        listing = serializers.IntegerField(min_value=1)
        quantity = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))

    items = Item(many=True, allow_empty=False)
    address = serializers.CharField(max_length=300)
    method = serializers.ChoiceField(choices=["mpesa", "card"])
    key = serializers.UUIDField()


@api_view(["POST"])
def checkout(request):
    expire_reservations()
    serializer = CheckoutSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    order = create_order(request.user, data["items"], data["address"], data["method"], data["key"])
    return Response(OrderSerializer(order).data, status=201)


@api_view(["POST"])
def accept_bid(request, pk):
    class Acceptance(serializers.Serializer):
        address = serializers.CharField(max_length=300)
        key = serializers.UUIDField()

    serializer = Acceptance(data=request.data)
    serializer.is_valid(raise_exception=True)
    expire_reservations()
    with transaction.atomic():
        bid = get_object_or_404(Bid.objects.select_related("listing"), pk=pk)
        need = ProduceRequest.objects.select_for_update().get(pk=bid.request_id)
        if need.consumer_id != request.user.pk:
            raise PermissionDenied("Only the request owner can accept a bid.")
        existing = Order.objects.filter(request=need, idempotency_key=serializer.validated_data["key"]).first()
        if existing:
            order = create_order(request.user, [{"listing": bid.listing_id, "quantity": need.quantity}],
                                 serializer.validated_data["address"], "mpesa", serializer.validated_data["key"],
                                 produce_request=need, bid_price=bid.price)
            return Response(OrderSerializer(order).data)
        if need.status != "open" or need.deadline < timezone.localdate():
            raise ValidationError("This request is no longer open.")
        if bid.listing.unit != need.unit:
            raise ValidationError("The bid no longer matches the requested unit.")
        order = create_order(request.user, [{"listing": bid.listing_id, "quantity": need.quantity}],
                             serializer.validated_data["address"], "mpesa", serializer.validated_data["key"],
                             produce_request=need, bid_price=bid.price)
        need.status = "award_pending_payment"
        need.save(update_fields=["status"])
    return Response(OrderSerializer(order).data, status=201)


def visible_orders(user):
    queryset = Order.objects.all()
    if user.is_staff:
        return queryset
    role = account(user)["role"]
    if role == "driver":
        return queryset.filter(driver=user)
    if role == "manager":
        return queryset.filter(items__listing__hub__manager=user).distinct()
    return queryset.filter(Q(consumer=user) | Q(items__listing__farmer=user)).distinct()


@api_view(["GET"])
def orders(request):
    expire_reservations()
    return Response(OrderSerializer(visible_orders(request.user).order_by("-created_at")[:100], many=True).data)


@api_view(["POST"])
def cancel_order(request, pk):
    order = get_object_or_404(Order, pk=pk, consumer=request.user)
    if order.status != "pending_payment":
        raise ValidationError("Only unpaid orders can be cancelled here. Contact support for a refund.")
    release_order(order, "cancelled")
    return Response({"detail": "Order cancelled and stock released."})


@api_view(["POST"])
def initiate_payment(request, pk):
    get_object_or_404(Order, pk=pk, consumer=request.user)
    return Response(
        {"detail": "Live payments are not configured. This order is unpaid; no money has been collected. Contact the platform administrator."},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


@api_view(["POST"])
def review_order(request, pk):
    order = get_object_or_404(Order, pk=pk, consumer=request.user)
    if order.status != "delivered":
        raise ValidationError("You can review an order after delivery.")
    if Review.objects.filter(order=order).exists():
        raise ValidationError("You have already reviewed this order.")
    serializer = ReviewSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save(order=order)
    return Response(serializer.data, status=201)


@api_view(["POST"])
def transition_delivery(request, pk):
    require_role(request.user, "driver")
    with transaction.atomic():
        order = get_object_or_404(Order.objects.select_for_update(), pk=pk, driver=request.user)
        if order.payment_status != "succeeded":
            raise ValidationError("An unpaid order cannot be dispatched.")
        transitions = {"processing": "picked", "picked": "en_route", "en_route": "delivered"}
        target = request.data.get("status")
        if transitions.get(order.status) != target:
            raise ValidationError("This delivery transition is not allowed.")
        if target == "picked":
            for item in order.items.order_by("listing_id"):
                changed = Listing.objects.filter(
                    pk=item.listing_id, reserved__gte=item.quantity, quantity__gte=item.quantity,
                ).update(quantity=F("quantity") - item.quantity, reserved=F("reserved") - item.quantity)
                if changed != 1:
                    raise ValidationError("Reserved stock is inconsistent. Contact operations before pickup.")
        order.status = target
        order.save(update_fields=["status"])
        DeliveryEvent.objects.create(order=order, status=target)
    return Response(OrderSerializer(order).data)


class PingSerializer(serializers.Serializer):
    latitude = serializers.FloatField(min_value=-90, max_value=90)
    longitude = serializers.FloatField(min_value=-180, max_value=180)
    accuracy = serializers.FloatField(min_value=0, max_value=100000)
    recorded_at = serializers.DateTimeField()

    def validate(self, attrs):
        if not all(math.isfinite(attrs[key]) for key in ["latitude", "longitude", "accuracy"]):
            raise serializers.ValidationError("Location values must be finite.")
        now = timezone.now()
        if not now - timedelta(minutes=5) <= attrs["recorded_at"] <= now + timedelta(seconds=30):
            raise serializers.ValidationError("Location update is too old or in the future.")
        return attrs


@api_view(["GET", "POST"])
def tracking(request, pk):
    order = get_object_or_404(visible_orders(request.user), pk=pk)
    if request.method == "GET":
        if not (
            request.user.is_staff or request.user.pk in [order.consumer_id, order.driver_id]
            or order.items.filter(listing__hub__manager=request.user).exists()
        ):
            raise PermissionDenied("Live driver location is only available to the buyer and assigned delivery team.")
        return Response(OrderSerializer(order, context={"request": request}).data)
    if order.driver_id != request.user.pk or order.status not in ["picked", "en_route"]:
        raise PermissionDenied("Only the assigned driver can update an active delivery.")
    serializer = PingSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        order = Order.objects.select_for_update().get(pk=order.pk)
        if order.driver_id != request.user.pk or order.status not in ["picked", "en_route"]:
            raise PermissionDenied("This assignment is no longer active.")
        last = order.pings.first()
        if last and serializer.validated_data["recorded_at"] <= last.recorded_at:
            raise ValidationError("An older location cannot replace the latest update.")
        LocationPing.objects.create(order=order, **serializer.validated_data)
    return Response({"detail": "Location received."}, status=201)
