import uuid
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Bid, Hub, Listing, LocationPing, Order, ProduceRequest, Profile
from .services import expire_reservations


class MarketplaceTests(TestCase):
    def setUp(self):
        self.consumer = self.person("buyer", "consumer")
        self.farmer = self.person("grower", "farmer")
        self.manager = self.person("hubstaff", "manager")
        self.driver = self.person("courier", "driver")
        self.other = self.person("other", "consumer")
        self.hub = Hub.objects.create(name="Test hub", location="Karen", latitude=-1.31, longitude=36.7, manager=self.manager)
        self.listing = Listing.objects.create(
            farmer=self.farmer, name="Tomatoes", category="vegetables", price=100, quantity=10,
            unit="kg", channel="direct", location="Limuru", latitude=-1.16, longitude=36.65,
            harvest_date=timezone.localdate(),
        )
        self.client = APIClient()
        self.client.force_authenticate(self.consumer)

    def person(self, name, role):
        user = User.objects.create_user(name, password="TestPassword2026!")
        Profile.objects.create(user=user, role=role)
        return user

    def checkout(self, quantity=2, key=None):
        return self.client.post("/api/checkout/", {
            "items": [{"listing": self.listing.pk, "quantity": quantity}],
            "address": "Kilimani", "method": "mpesa", "key": str(key or uuid.uuid4()),
        }, format="json")

    def need_and_bid(self):
        need = ProduceRequest.objects.create(
            consumer=self.consumer, name="Tomatoes", quantity=2, unit="kg", budget=300,
            location="Karen", deadline=timezone.localdate() + timedelta(days=1),
        )
        bid = Bid.objects.create(request=need, farmer=self.farmer, listing=self.listing, price=90)
        return need, bid

    def test_checkout_reserves_stock_and_retries_are_idempotent(self):
        key = uuid.uuid4()
        first = self.checkout(key=key)
        second = self.checkout(key=key)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.data["id"], second.data["id"])
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.reserved, Decimal("2"))
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(first.data["payment_status"], "not_initiated")

    def test_hub_search_matches_name_or_location_without_affecting_unfiltered_results(self):
        second = Hub.objects.create(name="Harvest depot", location="Limuru", latitude=-1.16, longitude=36.65, manager=self.manager)
        self.client.force_authenticate(None)
        for query, expected in [(" TEST ", [self.hub.pk]), ("limuru", [second.pk]), ("missing", []), ("   ", [self.hub.pk, second.pk])]:
            with self.subTest(query=query):
                response = self.client.get("/api/hubs/", {"q": query})
                self.assertEqual(response.status_code, 200)
                self.assertCountEqual([item["id"] for item in response.data], expected)
        self.assertEqual(len(self.client.get("/api/hubs/").data), 2)

    def test_request_search_matches_name_notes_and_location_before_result_limit(self):
        need, _ = self.need_and_bid()
        need.notes = "Firm and ripe for a community kitchen"
        need.save()
        ProduceRequest.objects.bulk_create([
            ProduceRequest(consumer=self.other, name="Carrots", quantity=1, unit="kg", budget=100,
                           location="Nakuru", deadline=timezone.localdate() + timedelta(days=1))
            for _ in range(101)
        ])
        self.client.force_authenticate(None)
        for query, expected in [(" TOMATOES ", [need.pk]), ("community kitchen", [need.pk]), ("karen", [need.pk]), ("missing", [])]:
            with self.subTest(query=query):
                response = self.client.get("/api/requests/", {"q": query})
                self.assertEqual(response.status_code, 200)
                self.assertEqual([item["id"] for item in response.data], expected)
        self.assertEqual(len(self.client.get("/api/requests/", {"q": "   "}).data), 100)

    def test_oversell_and_zero_quantity_rejected(self):
        self.assertEqual(self.checkout(8).status_code, 201)
        self.assertEqual(self.checkout(3).status_code, 400)
        self.assertEqual(self.checkout(0).status_code, 400)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.reserved, 8)

    def test_checkout_key_cannot_be_reused_for_different_stock_or_award(self):
        key = uuid.uuid4()
        self.assertEqual(self.checkout(key=key).status_code, 201)
        self.assertEqual(self.checkout(quantity=3, key=key).status_code, 400)
        need, bid = self.need_and_bid()
        response = self.client.post(f"/api/bids/{bid.pk}/accept/", {"address": "Kilimani", "key": str(key)})
        self.assertEqual(response.status_code, 400)
        need.refresh_from_db()
        self.assertEqual(need.status, "open")
        self.assertEqual(Order.objects.count(), 1)

    def test_duplicate_cart_lines_cannot_oversell(self):
        response = self.client.post("/api/checkout/", {
            "items": [{"listing": self.listing.pk, "quantity": 6}, {"listing": self.listing.pk, "quantity": 6}],
            "address": "Karen", "method": "mpesa", "key": str(uuid.uuid4()),
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Order.objects.exists())

    def test_cancel_releases_stock_once(self):
        order_id = self.checkout().data["id"]
        self.assertEqual(self.client.post(f"/api/orders/{order_id}/cancel/").status_code, 200)
        self.assertEqual(self.client.post(f"/api/orders/{order_id}/cancel/").status_code, 400)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.reserved, 0)

    def test_expired_reservations_release_and_reopen_request(self):
        need, bid = self.need_and_bid()
        response = self.client.post(f"/api/bids/{bid.pk}/accept/", {"address": "Karen", "key": str(uuid.uuid4())})
        self.assertEqual(response.status_code, 201)
        Order.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        expire_reservations()
        need.refresh_from_db()
        self.assertEqual(need.status, "open")
        again = self.client.post(f"/api/bids/{bid.pk}/accept/", {"address": "Karen", "key": str(uuid.uuid4())})
        self.assertEqual(again.status_code, 201)
        self.assertEqual(Order.objects.filter(status="pending_payment").count(), 1)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.reserved, 2)

    def test_pending_hub_drop_is_hidden_and_unsellable(self):
        self.listing.channel = "hub"
        self.listing.hub = self.hub
        self.listing.save()
        self.assertEqual(self.client.get("/api/listings/").data, [])
        self.assertEqual(self.checkout().status_code, 400)
        self.assertEqual(self.client.post(f"/api/hub-drops/{self.listing.pk}/receive/").status_code, 403)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post(f"/api/hub-drops/{self.listing.pk}/receive/").status_code, 200)
        self.assertEqual(len(self.client.get("/api/listings/").data), 1)
        self.assertEqual(self.client.get("/api/listings/").data[0]["location"], "Karen")

    def test_manager_cannot_receive_another_hubs_stock(self):
        self.hub.manager = self.farmer
        self.hub.save()
        self.listing.channel, self.listing.hub = "hub", self.hub
        self.listing.save()
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post(f"/api/hub-drops/{self.listing.pk}/receive/").status_code, 403)

    def test_only_owner_can_accept_bid_and_only_one_award(self):
        need, bid = self.need_and_bid()
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(f"/api/bids/{bid.pk}/accept/", {"address": "Karen", "key": str(uuid.uuid4())}).status_code, 403)
        self.client.force_authenticate(self.consumer)
        first = self.client.post(f"/api/bids/{bid.pk}/accept/", {"address": "Karen", "key": str(uuid.uuid4())})
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.data["total"], "180.00")
        self.assertEqual(self.client.post(f"/api/bids/{bid.pk}/accept/", {"address": "Karen", "key": str(uuid.uuid4())}).status_code, 400)

    def test_payment_endpoint_never_simulates_success(self):
        order_id = self.checkout().data["id"]
        self.assertEqual(self.client.post(f"/api/orders/{order_id}/payment/").status_code, 503)
        order = Order.objects.get(pk=order_id)
        self.assertEqual(order.payment_status, "not_initiated")
        self.assertEqual(order.status, "pending_payment")

    def test_orders_and_tracking_are_private(self):
        order_id = self.checkout().data["id"]
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/orders/").data, [])
        self.assertEqual(self.client.get(f"/api/orders/{order_id}/tracking/").status_code, 404)

    def test_tracking_validates_driver_state_and_timestamp(self):
        order = Order.objects.get(pk=self.checkout().data["id"])
        order.driver = self.driver
        order.status, order.payment_status = "picked", "succeeded"
        order.save()
        now = timezone.now()
        ping = {"latitude": -1.3, "longitude": 36.7, "accuracy": 10, "recorded_at": now.isoformat()}
        url = f"/api/orders/{order.pk}/tracking/"
        self.assertEqual(self.client.post(url, ping).status_code, 403)
        self.client.force_authenticate(self.driver)
        self.assertEqual(self.client.post(url, ping).status_code, 201)
        self.assertIsNotNone(self.client.get(url).data["location"])
        self.assertEqual(self.client.post(url, ping).status_code, 400)
        ping["recorded_at"] = (now - timedelta(minutes=10)).isoformat()
        self.assertEqual(self.client.post(url, ping).status_code, 400)
        self.assertEqual(LocationPing.objects.count(), 1)
        self.assertEqual(self.client.post(f"/api/orders/{order.pk}/transition/", {"status": "delivered"}).status_code, 400)
        self.client.force_authenticate(self.farmer)
        self.assertEqual(self.client.get(url).status_code, 403)
        self.assertIsNone(self.client.get("/api/orders/").data[0]["location"])

    def test_unpaid_order_cannot_be_dispatched(self):
        order = Order.objects.get(pk=self.checkout().data["id"])
        order.driver = self.driver
        order.status = "processing"
        order.save()
        self.client.force_authenticate(self.driver)
        self.assertEqual(self.client.post(f"/api/orders/{order.pk}/transition/", {"status": "picked"}).status_code, 400)

    def test_verified_pickup_commits_reserved_stock_once(self):
        order = Order.objects.get(pk=self.checkout().data["id"])
        order.driver = self.driver
        order.status, order.payment_status = "processing", "succeeded"
        order.save()
        self.client.force_authenticate(self.driver)
        url = f"/api/orders/{order.pk}/transition/"
        self.assertEqual(self.client.post(url, {"status": "picked"}).status_code, 200)
        self.assertEqual(self.client.post(url, {"status": "picked"}).status_code, 400)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.quantity, 8)
        self.assertEqual(self.listing.reserved, 0)
        self.assertEqual(self.client.post(url, {"status": "en_route"}).status_code, 200)
        self.assertEqual(self.client.post(url, {"status": "delivered"}).status_code, 200)

    def test_review_requires_delivery_and_valid_ratings(self):
        order = Order.objects.get(pk=self.checkout().data["id"])
        url = f"/api/orders/{order.pk}/review/"
        review = {"produce_rating": 5, "delivery_rating": 4, "comment": "Fresh produce."}
        self.assertEqual(self.client.post(url, review).status_code, 400)
        order.status = "delivered"
        order.save()
        self.assertEqual(self.client.post(url, {**review, "produce_rating": 6}).status_code, 400)
        self.assertEqual(self.client.post(url, review).status_code, 201)
        self.assertEqual(self.client.post(url, review).status_code, 400)

    def test_registration_cannot_grant_privileged_roles(self):
        self.client.force_authenticate(user=None)
        response = self.client.post("/api/register/", {
            "name": "Invalid manager", "username": "badrole", "email": "test@example.com",
            "password": "SafeTestPassword2026!", "role": "manager",
        })
        self.assertEqual(response.status_code, 400)
        self.assertFalse(User.objects.filter(username="badrole").exists())

    def test_login_requires_csrf_even_before_authentication(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.post("/api/login/", {"username": "buyer", "password": "TestPassword2026!"}).status_code, 403)
        client.get("/api/session/")
        csrf = client.cookies["sokosoo_csrftoken"].value
        response = client.post("/api/login/", {"username": "buyer", "password": "TestPassword2026!"}, HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(response.status_code, 200)

    def test_distance_search_rejects_bad_coordinates(self):
        self.assertEqual(self.client.get("/api/listings/?lat=nan&lng=36").status_code, 400)
        self.assertEqual(self.client.get("/api/listings/?lat=-1.16&lng=36.65&radius=1").status_code, 200)
        self.assertEqual(len(self.client.get("/api/listings/?lat=-1.16&lng=36.65&radius=1").data), 1)
