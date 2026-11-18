import uuid
from datetime import timedelta
from decimal import Decimal
from importlib import import_module
from types import SimpleNamespace
from unittest.mock import patch

from django.apps import apps
from django.contrib.auth.models import User
from django.db import IntegrityError, OperationalError, connection
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .connections import cleanup_marketplace, send_enquiry
from .models import Bid, Enquiry, Hub, Listing, Notification, Order, ProduceRequest, Profile, SavedCartItem, StockMovement


class MarketplaceTests(TestCase):
    def setUp(self):
        self.consumer = self.person("buyer", "consumer")
        self.farmer = self.person("grower", "farmer")
        self.manager = self.person("hubstaff", "manager")
        self.other = self.person("other", "consumer")
        self.hub = Hub.objects.create(name="Karen Hub", location="Karen", latitude=-1.31, longitude=36.7, manager=self.manager)
        self.listing = Listing.objects.create(
            farmer=self.farmer, name="Fresh tomatoes", category="vegetables", price=100, quantity=10,
            unit="kg", channel="direct", location="Limuru", latitude=-1.16, longitude=36.65,
            harvest_date=timezone.localdate(),
        )
        self.client = APIClient()
        self.client.force_authenticate(self.consumer)

    def person(self, name, role):
        user = User.objects.create_user(name, password="TestPassword2026!")
        Profile.objects.create(user=user, role=role)
        return user

    def test_farmer_stock_filters_summary_and_archived_detail_are_owner_scoped(self):
        self.listing.state = "archived"
        self.listing.save()
        Listing.objects.bulk_create([
            Listing(farmer=self.farmer, name=f"Newer batch {index}", category="fruits", price=50,
                    quantity=3, unit="kg", channel="direct", location="Karen", latitude=0,
                    longitude=0, harvest_date=timezone.localdate())
            for index in range(25)
        ])
        foreign = Listing.objects.create(
            farmer=self.other, name="Private archive", category="vegetables", price=20, quantity=2,
            unit="kg", channel="direct", location="Karen", latitude=0, longitude=0,
            harvest_date=timezone.localdate(), state="archived",
        )
        self.assertEqual(self.client.get("/api/farmer-workspace/").status_code, 403)
        self.client.force_authenticate(self.farmer)
        filtered = self.client.get("/api/listings/", {"mine": "true", "page": 1, "stock_status": "review", "q": "tomatoes"}).data
        self.assertEqual((filtered["count"], filtered["items"][0]["id"]), (1, self.listing.pk))
        fruits = self.client.get("/api/listings/", {"mine": "true", "page": 2, "category": "fruits"}).data
        self.assertEqual((fruits["count"], len(fruits["items"])), (25, 1))
        detail = self.client.get("/api/listings/", {"mine": "true", "ids": self.listing.pk}).data
        self.assertEqual(detail[0]["id"], self.listing.pk)
        self.assertEqual(self.client.get("/api/listings/", {"mine": "true", "ids": foreign.pk}).data, [])
        self.assertEqual(self.client.get("/api/farmer-workspace/").data, {"hidden": 1, "awaiting_receipt": 0, "pending_enquiries": 0})

    def test_farmer_enquiry_table_search_paginates_before_returning_and_scopes_detail(self):
        target = self.enquire(1).data
        Enquiry.objects.bulk_create([
            Enquiry(consumer=self.other, farmer=self.farmer, key=uuid.uuid4(), contact="Other buyer")
            for _ in range(25)
        ])
        outgoing = Enquiry.objects.create(consumer=self.farmer, farmer=self.other, key=uuid.uuid4(), contact="Outgoing")
        self.client.force_authenticate(self.farmer)
        first = self.client.get("/api/enquiries/", {"incoming": "true", "page": 1}).data
        self.assertEqual((first["count"], len(first["items"])), (26, 24))
        found = self.client.get("/api/enquiries/", {"incoming": "true", "page": 1, "q": "tomatoes", "status": "pending"}).data
        self.assertEqual([item["id"] for item in found["items"]], [target["id"]])
        self.assertEqual(self.client.get("/api/enquiries/", {"incoming": "true", "id": target["id"]}).data[0]["id"], target["id"])
        self.assertEqual(self.client.get("/api/enquiries/", {"incoming": "true", "id": outgoing.pk}).data, [])
        sent = self.client.get("/api/enquiries/", {"outgoing": "true", "page": 1, "q": "other"}).data
        self.assertEqual([item["id"] for item in sent["items"]], [str(outgoing.pk)])
        self.assertEqual(self.client.get("/api/enquiries/", {"id": outgoing.pk}).data[0]["id"], str(outgoing.pk))
        self.assertEqual(self.client.get("/api/farmer-workspace/").data["pending_enquiries"], 26)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/enquiries/", {"id": target["id"]}).data, [])

    def test_farmer_request_filters_find_old_offers_and_eligible_stock_before_pagination(self):
        need = self.need()
        Bid.objects.create(request=need, farmer=self.farmer, listing=self.listing, price=80)
        ProduceRequest.objects.bulk_create([
            ProduceRequest(consumer=self.other, name=f"Later request {i}", category="fruits", quantity=1,
                           unit="kg", budget=100, location="Karen", deadline=timezone.localdate())
            for i in range(25)
        ])
        self.client.force_authenticate(self.farmer)
        found = self.client.get("/api/requests/", {"page": 1, "offers": "mine", "q": "tomatoes", "status": "open"}).data
        self.assertEqual((found["count"], found["items"][0]["id"]), (1, need.pk))
        self.assertTrue(found["items"][0]["bids"][0]["is_mine"])
        self.assertEqual(self.client.get("/api/requests/", {"id": need.pk}).data[0]["id"], need.pk)
        self.assertEqual(self.client.get("/api/requests/", {"page": 2, "category": "fruits"}).data["count"], 25)
        eligible = {"mine": "true", "page": 1, "offer_request": need.pk}
        self.assertEqual(self.client.get("/api/listings/", eligible).data["count"], 1)
        self.listing.reserved = 9
        self.listing.save()
        self.assertEqual(self.client.get("/api/listings/", eligible).data["count"], 0)
        self.client.force_authenticate(self.other)
        self.assertFalse(self.client.get("/api/requests/", {"id": need.pk}).data[0]["bids"][0]["is_mine"])

    def test_notification_search_and_type_filters_apply_before_cursor_pagination(self):
        target = Notification.objects.create(recipient=self.consumer, event_key="target", title="Karen receipt", kind="hub", message="Stock accepted", link="/")
        Notification.objects.bulk_create([
            Notification(recipient=self.consumer, event_key=f"later-{i}", title="Stock reminder", kind="stock", message="Check stock", link="/")
            for i in range(25)
        ])
        Notification.objects.create(recipient=self.other, event_key="foreign-target", title="Karen receipt", kind="hub", message="Private", link="/")
        found = self.client.get("/api/notifications/", {"q": "Karen", "kind": "hub"}).data
        self.assertEqual((found["count"], found["items"][0]["id"]), (1, target.pk))
        self.assertEqual(self.client.get("/api/notifications/", {"id": target.pk}).data["items"][0]["id"], target.pk)
        target.refresh_from_db()
        self.assertIsNone(target.read_at)

    def test_consumer_request_tables_filter_owned_records_before_pagination(self):
        need = self.need()
        Bid.objects.create(request=need, farmer=self.farmer, listing=self.listing, price=80)
        ProduceRequest.objects.bulk_create([
            ProduceRequest(consumer=self.consumer, name=f"My fruit request {i}", product_name="fruit",
                           category="fruits", quantity=1, unit="kg", budget=100, location="Karen",
                           deadline=timezone.localdate())
            for i in range(25)
        ])
        foreign = ProduceRequest.objects.create(
            consumer=self.other, name="Another buyer", quantity=1, unit="kg", budget=100,
            location="Karen", deadline=timezone.localdate(),
        )
        page = self.client.get("/api/requests/", {"mine": "true", "page": 2}).data
        self.assertEqual((page["count"], len(page["items"])), (26, 2))
        found = self.client.get("/api/requests/", {
            "mine": "true", "page": 1, "q": "tomatoes", "status": "open", "has_offers": "true",
        }).data
        self.assertEqual([item["id"] for item in found["items"]], [need.pk])
        self.assertEqual(self.client.get("/api/requests/", {"mine": "true", "id": foreign.pk}).data, [])
        self.assertEqual(self.client.get("/api/requests/", {"mine": "true", "id": need.pk}).data[0]["id"], need.pk)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/requests/", {"mine": "true", "page": 1}).status_code, 403)

    def test_consumer_overview_counts_owned_requests_once_and_excludes_expired_activity(self):
        need = self.need()
        Bid.objects.create(request=need, farmer=self.farmer, listing=self.listing, price=80)
        Bid.objects.create(request=need, farmer=self.other, listing=self.listing, price=90)
        foreign = ProduceRequest.objects.create(
            consumer=self.other, name="Another buyer", quantity=1, unit="kg", budget=100,
            location="Karen", deadline=timezone.localdate(),
        )
        Bid.objects.create(request=foreign, farmer=self.farmer, listing=self.listing, price=70)
        for owner, status, expires in [
            (self.consumer, "pending", timezone.now() + timedelta(hours=1)),
            (self.consumer, "pending", timezone.now() - timedelta(hours=1)),
            (self.consumer, "accepted", timezone.now() + timedelta(hours=1)),
            (self.other, "accepted", timezone.now() + timedelta(hours=1)),
        ]:
            Enquiry.objects.create(consumer=owner, farmer=self.farmer, key=uuid.uuid4(), contact="Test", status=status, expires_at=expires)
        self.assertEqual(self.client.get("/api/consumer-workspace/").data, {
            "pending_enquiries": 1, "accepted_enquiries": 1, "requests_with_offers": 1,
        })
        need.deadline = timezone.localdate() - timedelta(days=1)
        need.save()
        self.assertEqual(self.client.get("/api/consumer-workspace/").data["requests_with_offers"], 0)
        self.client.force_authenticate(self.farmer)
        self.assertEqual(self.client.get("/api/consumer-workspace/").status_code, 403)

    def test_paginated_catalog_resolves_old_stock_before_filtering_sorting_and_detail(self):
        self.listing.price = 1
        self.listing.save()
        Listing.objects.bulk_create([
            Listing(farmer=self.farmer, name=f"Later stock {index}", category="vegetables", price=200,
                    quantity=10, unit="kg", channel="direct", location="Far away",
                    latitude=0, longitude=0, harvest_date=timezone.localdate())
            for index in range(500)
        ])
        first = self.client.get("/api/listings/", {"page": 1}).data
        self.assertEqual((first["count"], len(first["items"]), first["pages"]), (501, 24, 21))
        self.assertNotIn(self.listing.pk, [item["id"] for item in first["items"]])
        last = self.client.get("/api/listings/", {"page": 21}).data
        self.assertIn(self.listing.pk, [item["id"] for item in last["items"]])
        self.assertEqual(last["previous_page"], 20)
        self.assertIsNone(last["next_page"])
        self.assertEqual(self.client.get(f"/api/listings/{self.listing.pk}/").data["id"], self.listing.pk)
        resolved = self.client.get("/api/listings/", {"ids": self.listing.pk}).data
        self.assertEqual([item["id"] for item in resolved], [self.listing.pk])
        cheapest = self.client.get("/api/listings/", {"page": 1, "sort": "price_asc"}).data
        self.assertEqual(cheapest["items"][0]["id"], self.listing.pk)
        capped = self.client.get("/api/listings/", {"page": 1, "max_price": 10}).data
        self.assertEqual(capped["count"], 1)
        nearby = self.client.get("/api/listings/", {
            "page": 1, "lat": self.listing.latitude, "lng": self.listing.longitude, "radius": 5, "sort": "distance",
        }).data
        self.assertEqual([item["id"] for item in nearby["items"]], [self.listing.pk])
        self.client.force_authenticate(self.farmer)
        self.assertEqual(self.client.get("/api/listings/", {"page": 21, "mine": "true"}).data["count"], 501)
        self.assertEqual(self.client.get("/api/listings/", {"page": 22}).status_code, 404)
        self.assertEqual(self.client.get("/api/listings/", {"ids": "broken"}).status_code, 400)
        self.listing.state = "archived"
        self.listing.save()
        self.assertEqual(self.client.get(f"/api/listings/{self.listing.pk}/").status_code, 404)
        self.assertEqual(self.client.get("/api/listings/", {"ids": self.listing.pk}).data, [])

    def test_head_quantities_are_whole_across_stock_requests_bags_and_enquiries(self):
        self.listing.unit, self.listing.category = "head", "livestock"
        self.listing.save()
        self.assertEqual(self.enquire("0.5").status_code, 400)
        saved = SavedCartItem.objects.create(consumer=self.consumer, listing=self.listing, quantity=1,
                                            expires_at=timezone.now() + timedelta(hours=1))
        self.assertEqual(self.client.put("/api/cart/", [{
            "listing_id": self.listing.pk, "quantity": "0.5", "expires_at": saved.expires_at.isoformat(),
        }], format="json").status_code, 400)
        saved.refresh_from_db()
        self.assertEqual(saved.quantity, 1)
        self.assertEqual(self.client.post("/api/requests/", {
            "name": "Goats", "product_name": "goats", "category": "livestock", "quantity": "0.5",
            "unit": "head", "budget": 100, "location": "Karen", "deadline": str(timezone.localdate()),
        }, format="json").status_code, 400)
        self.client.force_authenticate(self.farmer)
        payload = {
            "name": "Goats", "category": "livestock", "price": "30", "quantity": "0.5", "unit": "head",
            "channel": "direct", "location": "Limuru", "latitude": -1.16, "longitude": 36.65,
            "harvest_date": str(timezone.localdate()),
        }
        self.assertEqual(self.client.post("/api/listings/", payload, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/listings/", {**payload, "unit": "kg"}, format="json").status_code, 201)
        self.assertEqual(self.stock(quantity="0.5").status_code, 400)
        self.assertEqual(self.dispatch("0.5").status_code, 400)
        drop = self.dispatch(2).data
        self.client.force_authenticate(self.manager)
        receipt = f"/api/hub-drops/{drop['id']}/receive/"
        self.assertEqual(self.client.post(receipt, {"quantity": "0.5", "note": "Checked"}).status_code, 400)
        self.assertEqual(self.client.post(receipt, {"quantity": 1, "note": "Checked"}).status_code, 200)
        self.assertEqual(self.stock(pk=drop["id"], quantity="0.5").status_code, 400)
        self.client.force_authenticate(self.consumer)
        self.assertEqual(self.enquire(1).status_code, 201)

    def test_notification_history_paginates_without_new_arrivals_shifting_pages(self):
        response = self.client.get("/api/notifications/")
        self.assertEqual(response.data["items"], [])
        self.assertEqual(response.data["snapshot"], 0)
        Notification.objects.bulk_create([
            Notification(recipient=self.consumer, event_key=f"test:{i}", title=f"Update {i}",
                         message="Test history", link="/?view=enquiries")
            for i in range(205)
        ])
        foreign = Notification.objects.create(recipient=self.other, event_key="private", message="Not yours", link="/")
        first = self.client.get("/api/notifications/").data
        self.assertEqual(len(first["items"]), 20)
        self.assertEqual(first["count"], 205)
        self.assertIsNone(first["previous_cursor"])
        arrival = Notification.objects.create(recipient=self.consumer, event_key="new", message="Just arrived", link="/")
        seen = [item["id"] for item in first["items"]]
        page = first
        second = None
        while page["next_cursor"]:
            page = self.client.get("/api/notifications/", {
                "cursor": page["next_cursor"], "snapshot": first["snapshot"],
            }).data
            second = second or page
            self.assertLessEqual(len(page["items"]), 20)
            seen.extend(item["id"] for item in page["items"])
        self.assertEqual(len(seen), 205)
        self.assertEqual(len(set(seen)), 205)
        self.assertNotIn(foreign.pk, seen)
        self.assertNotIn(arrival.pk, seen)
        newer = self.client.get("/api/notifications/", {
            "cursor": second["previous_cursor"], "snapshot": first["snapshot"],
        }).data
        self.assertEqual([item["id"] for item in newer["items"]], seen[:20])
        summary = self.client.get("/api/notifications/", {"summary": "true"}).data
        self.assertEqual(summary, {"unread": 206, "latest_id": arrival.pk})

    def test_notification_page_read_is_scoped_and_unread_history_remains_accessible(self):
        for count in (1, 20, 21):
            with self.subTest(count=count):
                Notification.objects.filter(recipient=self.consumer).delete()
                Notification.objects.bulk_create([
                    Notification(recipient=self.consumer, event_key=f"page:{i}", message="Update", link="/")
                    for i in range(count)
                ])
                page = self.client.get("/api/notifications/", {"unread": "true"}).data
                ids = [item["id"] for item in page["items"]]
                arrival = Notification.objects.create(recipient=self.consumer, event_key="arrival", message="New", link="/")
                response = self.client.post("/api/notifications/", {"ids": ids}, format="json")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["updated"], min(count, 20))
                self.assertEqual(self.client.post("/api/notifications/", {"ids": ids}, format="json").data["updated"], 0)
                self.assertFalse(Notification.objects.get(pk=arrival.pk).read_at)
                remaining = self.client.get("/api/notifications/", {"unread": "true"}).data
                self.assertEqual(remaining["count"], max(count - 20, 0) + 1)
                self.assertTrue(all(item["read_at"] is None for item in remaining["items"]))
                history = self.client.get("/api/notifications/").data
                self.assertEqual(history["count"], count + 1)

    def test_notification_read_validation_and_account_isolation(self):
        own = Notification.objects.create(recipient=self.consumer, event_key="own", message="Own", link="/")
        foreign = Notification.objects.create(recipient=self.other, event_key="foreign", message="Private", link="/")
        for payload in ({}, {"ids": []}, {"id": own.pk, "ids": [own.pk]}, {"ids": [own.pk] * 21}):
            self.assertEqual(self.client.post("/api/notifications/", payload, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/notifications/", {"ids": [own.pk, foreign.pk]}, format="json").status_code, 404)
        own.refresh_from_db()
        self.assertIsNone(own.read_at)
        self.assertEqual(self.client.get("/api/notifications/", {"owner": self.other.pk}).status_code, 403)
        self.assertEqual(self.client.post(f"/api/notifications/?owner={self.other.pk}", {"id": own.pk}).status_code, 403)
        for query in ({"snapshot": -1}, {"unread": "wrong"}, {"cursor": "invalid"}):
            self.assertIn(self.client.get("/api/notifications/", query).status_code, (400, 404))
        self.enquire()
        item = self.client.get("/api/notifications/").data["items"][0]
        self.assertEqual((item["title"], item["kind"], item["context"]), ("Enquiry sent · grower", "enquiry", "Fresh tomatoes"))

    def test_notification_subjects_identify_farm_and_hub(self):
        profile = self.farmer.profile
        profile.farm_name = "Wanjiku Family Farm"
        profile.save()
        self.enquire()
        direct = self.client.get("/api/notifications/").data["items"][0]
        self.assertEqual(direct["title"], "Enquiry sent · Wanjiku Family Farm")
        drop = self.dispatch(quantity=4).data
        dispatch = Notification.objects.get(recipient=self.manager, event_key=f"dispatch:{drop['id']}")
        self.assertEqual(dispatch.title, "Hub receipt needed · Wanjiku Family Farm · Karen Hub")
        self.client.force_authenticate(self.manager)
        received = self.client.post(f"/api/hub-drops/{drop['id']}/receive/", {"quantity": 4, "note": "All received."})
        self.assertEqual(received.status_code, 200)
        self.client.force_authenticate(self.consumer)
        response = self.enquire(items=[{"listing": drop["id"], "quantity": 1}])
        self.assertEqual(response.status_code, 201)
        hub = self.client.get("/api/notifications/").data["items"][0]
        self.assertEqual(hub["title"], "Enquiry sent · Wanjiku Family Farm · Karen Hub")
        self.assertEqual(hub["context"], "Fresh tomatoes")

    def test_existing_notification_subjects_are_enriched_without_changing_history(self):
        response = self.enquire()
        enquiry_id = response.data["id"]
        read_at = timezone.now()
        old = Notification.objects.get(recipient=self.consumer, event_key=f"enquiry:{enquiry_id}:sent")
        history = (old.message, old.link, old.created_at)
        Notification.objects.filter(pk=old.pk).update(title="Enquiry sent", context="", read_at=read_at)
        drop = self.dispatch(quantity=4).data
        hub = Notification.objects.get(recipient=self.manager, event_key=f"dispatch:{drop['id']}")
        Notification.objects.filter(pk=hub.pk).update(title="Hub receipt needed", context="")
        missing = Notification.objects.create(
            recipient=self.consumer, event_key="cart:999999:expired", title="Bag item expired",
            message="Historical item no longer exists.", link="/?view=cart",
        )
        backfill = import_module("market.migrations.0006_notification_subject_origins").enrich_subjects
        for _ in range(2):
            backfill(apps, SimpleNamespace(connection=connection))
        old.refresh_from_db()
        hub.refresh_from_db()
        missing.refresh_from_db()
        self.assertEqual(old.title, "Enquiry sent · grower")
        self.assertEqual(old.context, "Fresh tomatoes")
        self.assertEqual(old.read_at, read_at)
        self.assertEqual((old.message, old.link, old.created_at), history)
        self.assertEqual(hub.title, "Hub receipt needed · grower · Karen Hub")
        self.assertEqual(missing.title, "Bag item expired")

    def enquire(self, quantity=2, key=None, **extra):
        return self.client.post("/api/enquiries/", {
            "items": [{"listing": self.listing.pk, "quantity": quantity}],
            "contact": "buyer@example.test", "key": str(key or uuid.uuid4()), **extra,
        }, format="json")

    def dispatch(self, quantity=6):
        self.client.force_authenticate(self.farmer)
        return self.client.post(f"/api/listings/{self.listing.pk}/dispatch/", {"hub": self.hub.pk, "quantity": quantity})

    def stock(self, pk=None, quantity=10, **extra):
        return self.client.post(f"/api/listings/{pk or self.listing.pk}/stock/", {
            "quantity": quantity, "state": "active", "available_until": (timezone.now() + timedelta(days=1)).isoformat(),
            "reason": "Physical stock checked; commitments excluded.", **extra,
        }, format="json")

    def need(self, **extra):
        return ProduceRequest.objects.create(
            consumer=self.consumer, name="Kitchen tomatoes", product_name="tomatoes", category="vegetables",
            quantity=2, unit="kg", budget=300, location="Karen", deadline=timezone.localdate() + timedelta(days=1), **extra,
        )

    def test_enquiry_deducts_once_and_retry_returns_original_without_duplicate_notifications(self):
        key = uuid.uuid4()
        first, retry = self.enquire(key=key), self.enquire(key=key)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.data["id"], retry.data["id"])
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.quantity, 8)
        self.assertEqual(self.listing.reserved, 0)
        self.assertEqual(StockMovement.objects.filter(kind="enquiry").count(), 1)
        self.assertEqual(Notification.objects.count(), 2)
        self.assertFalse(Order.objects.exists())
        self.assertEqual(self.enquire(quantity=3, key=key).status_code, 400)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.enquire(key=key).status_code, 400)

    def test_insufficient_duplicate_and_invalid_quantities_create_no_enquiries_or_notifications(self):
        for quantity in [0, -1, 11]:
            self.assertEqual(self.enquire(quantity).status_code, 400)
        self.assertEqual(self.enquire(items=[
            {"listing": self.listing.pk, "quantity": 6}, {"listing": self.listing.pk, "quantity": 6},
        ]).status_code, 400)
        self.assertFalse(Enquiry.objects.exists())
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(StockMovement.objects.exists())

    def test_distinct_enquiries_cannot_exceed_remaining_stock(self):
        self.assertEqual(self.enquire(8).status_code, 201)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.enquire(3).status_code, 400)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.quantity, 2)
        self.assertEqual(Enquiry.objects.count(), 1)

    def test_ledger_failure_rolls_back_deduction_enquiry_and_cart_removal(self):
        SavedCartItem.objects.create(consumer=self.consumer, listing=self.listing, quantity=2)
        with patch("market.connections.record_stock", side_effect=IntegrityError("Ledger write failed")):
            with self.assertRaises(IntegrityError):
                send_enquiry(self.consumer, [{"listing": self.listing.pk, "quantity": Decimal("2")}],
                             uuid.uuid4(), "", "buyer@example.test")
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.quantity, 10)
        self.assertTrue(SavedCartItem.objects.exists())
        self.assertFalse(Enquiry.objects.exists())
        self.assertFalse(Notification.objects.exists())

    def test_lock_during_idempotency_retry_returns_explicit_retry_response(self):
        with patch("market.connection_views.send_enquiry", side_effect=[IntegrityError(), OperationalError("database is locked")]):
            response = self.enquire()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response["Retry-After"], "2")
        self.assertFalse(Enquiry.objects.exists())

    def test_failure_after_an_earlier_line_rolls_back_all_stock_and_notifications(self):
        second = Listing.objects.create(
            farmer=self.farmer, name="Carrots", category="vegetables", quantity=2, price=50, unit="kg",
            channel="direct", location="Limuru", latitude=-1.16, longitude=36.65, harvest_date=timezone.localdate(),
        )
        response = self.enquire(items=[{"listing": self.listing.pk, "quantity": 2}, {"listing": second.pk, "quantity": 3}])
        self.assertEqual(response.status_code, 400)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.quantity, 10)
        self.assertFalse(Enquiry.objects.exists())
        self.assertFalse(Notification.objects.exists())

    def test_expired_archived_and_unreceived_stock_rejected_at_submission(self):
        for updates in [
            {"available_until": timezone.now() - timedelta(seconds=1)},
            {"state": "archived"},
            {"channel": "hub", "hub": self.hub, "received": False},
        ]:
            with self.subTest(updates=updates):
                Listing.objects.filter(pk=self.listing.pk).update(**updates)
                self.assertEqual(self.enquire().status_code, 400)
                self.assertEqual(self.client.get("/api/listings/").data, [])
                Listing.objects.filter(pk=self.listing.pk).update(
                    state="active", available_until=timezone.now() + timedelta(days=1), channel="direct", hub=None,
                )
        self.assertFalse(Notification.objects.exists())

    def test_enquiry_cannot_mix_origins_or_target_own_stock(self):
        drop = self.dispatch(3).data
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post(f"/api/hub-drops/{drop['id']}/receive/", {"quantity": 3, "note": "Checked"}).status_code, 200)
        self.client.force_authenticate(self.consumer)
        response = self.enquire(items=[{"listing": self.listing.pk, "quantity": 1}, {"listing": drop["id"], "quantity": 1}])
        self.assertEqual(response.status_code, 400)
        self.client.force_authenticate(self.farmer)
        self.assertEqual(self.enquire().status_code, 400)

    def test_only_farmer_can_accept_and_must_share_contact_and_location(self):
        enquiry_id = self.enquire().data["id"]
        url = f"/api/enquiries/{enquiry_id}/reply/"
        reply = {"status": "accepted", "response": "Yes, contact me directly."}
        self.assertEqual(self.client.post(url, reply).status_code, 403)
        self.client.force_authenticate(self.farmer)
        self.assertEqual(self.client.post(url, reply).status_code, 400)
        self.assertEqual(self.client.post(url, {**reply, "pickup_details": "Call my farm office; Limuru market gate."}).status_code, 200)
        self.assertEqual(self.client.post(url, reply).status_code, 400)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.quantity, 8)
        self.assertEqual(Notification.objects.filter(event_key__endswith="accepted").count(), 2)

    def test_decline_and_cancel_keep_stock_deducted_and_request_reconciliation(self):
        for decision in ["declined", "cancelled"]:
            self.client.force_authenticate(self.consumer)
            enquiry_id = self.enquire().data["id"]
            if decision == "declined":
                self.client.force_authenticate(self.farmer)
                response = self.client.post(f"/api/enquiries/{enquiry_id}/reply/", {"status": decision, "response": "Not available."})
            else:
                response = self.client.post(f"/api/enquiries/{enquiry_id}/cancel/")
            self.assertEqual(response.status_code, 200)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.quantity, 6)
        self.assertEqual(Notification.objects.filter(recipient=self.farmer, event_key__startswith="reconcile:").count(), 2)

    def test_enquiries_and_notifications_are_private(self):
        self.enquire()
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/enquiries/").data, [])
        self.assertEqual(self.client.get("/api/notifications/").data["unread"], 0)
        notification = Notification.objects.filter(recipient=self.consumer).first()
        self.assertEqual(self.client.post("/api/notifications/", {"id": notification.pk}).status_code, 404)
        self.client.force_authenticate(self.consumer)
        self.assertEqual(self.client.post("/api/notifications/", {"id": notification.pk}).status_code, 200)
        self.assertEqual(self.client.get("/api/notifications/").data["unread"], 0)

    def test_cleanup_reminds_both_parties_once_and_expires_without_release(self):
        enquiry = Enquiry.objects.get(pk=self.enquire().data["id"])
        enquiry.expires_at = timezone.now() + timedelta(minutes=30)
        enquiry.save()
        cleanup_marketplace()
        cleanup_marketplace()
        self.assertEqual(Notification.objects.filter(event_key__endswith="reminder").count(), 2)
        enquiry.expires_at = timezone.now() - timedelta(seconds=1)
        enquiry.save()
        cleanup_marketplace()
        cleanup_marketplace()
        enquiry.refresh_from_db()
        self.listing.refresh_from_db()
        self.assertEqual(enquiry.status, "expired")
        self.assertEqual(self.listing.quantity, 8)
        self.assertEqual(Notification.objects.filter(event_key__endswith="expired").count(), 2)
        self.client.force_authenticate(self.farmer)
        self.assertEqual(self.client.post(f"/api/enquiries/{enquiry.pk}/reply/", {"status": "declined", "response": "Too late"}).status_code, 400)

    def test_archival_keeps_history_and_notifies_affected_buyers(self):
        enquiry_id = self.enquire().data["id"]
        Listing.objects.filter(pk=self.listing.pk).update(available_until=timezone.now() - timedelta(seconds=1))
        cleanup_marketplace()
        cleanup_marketplace()
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.state, "archived")
        self.assertTrue(Enquiry.objects.filter(pk=enquiry_id).exists())
        self.assertEqual(self.client.get("/api/listings/").data, [])
        self.assertEqual(Notification.objects.filter(recipient=self.consumer, event_key__contains="listing:").count(), 1)
        self.client.force_authenticate(self.farmer)
        self.assertEqual(self.stock(quantity=5).status_code, 200)
        self.assertEqual(len(self.client.get("/api/listings/").data), 1)

    def test_reconciliation_requires_owner_and_records_reason_and_delta(self):
        self.assertEqual(self.stock().status_code, 403)
        self.client.force_authenticate(self.farmer)
        self.assertEqual(self.stock(quantity=7).status_code, 200)
        movement = StockMovement.objects.get(kind="reconcile")
        self.assertEqual(movement.change, -3)
        self.assertEqual(movement.balance, 7)
        self.assertEqual(self.stock(quantity=8, kind="spoiled").status_code, 400)
        self.assertEqual(self.stock(quantity=0, state="archived").status_code, 200)

    def test_dispatch_and_partial_receipt_do_not_duplicate_stock(self):
        response = self.dispatch(6)
        self.assertEqual(response.status_code, 201)
        drop = Listing.objects.get(pk=response.data["id"])
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.quantity, 4)
        self.assertEqual(drop.quantity, 0)
        self.assertEqual(drop.dispatched_quantity, 6)
        self.client.force_authenticate(self.consumer)
        self.assertEqual(self.enquire(items=[{"listing": drop.pk, "quantity": 1}]).status_code, 400)
        self.assertEqual(self.client.post(f"/api/hub-drops/{drop.pk}/receive/", {"quantity": 5, "note": "One rejected"}).status_code, 403)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post(f"/api/hub-drops/{drop.pk}/receive/", {"quantity": 7, "note": "Wrong"}).status_code, 400)
        self.assertEqual(self.client.post(f"/api/hub-drops/{drop.pk}/receive/", {"quantity": 5, "note": "One rejected"}).status_code, 200)
        self.assertEqual(self.client.post(f"/api/hub-drops/{drop.pk}/receive/", {"quantity": 5, "note": "Duplicate"}).status_code, 400)
        drop.refresh_from_db()
        self.assertEqual(drop.quantity + self.listing.quantity, 9)
        self.assertEqual(drop.received_quantity, 5)
        self.assertTrue(Notification.objects.filter(recipient=self.farmer, event_key=f"receipt:{drop.pk}").exists())

    def test_only_responsible_hub_manager_can_reconcile_hub_stock(self):
        drop_id = self.dispatch(3).data["id"]
        self.client.force_authenticate(self.manager)
        self.client.post(f"/api/hub-drops/{drop_id}/receive/", {"quantity": 3, "note": "Checked"})
        self.client.force_authenticate(self.farmer)
        self.assertEqual(self.stock(pk=drop_id, quantity=2).status_code, 403)
        mine = self.client.get("/api/listings/?mine=true").data
        self.assertTrue(next(item for item in mine if item["id"] == drop_id)["movements"])
        self.client.force_authenticate(self.other)
        self.assertEqual(self.stock(pk=drop_id, quantity=2).status_code, 403)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.stock(pk=drop_id, quantity=2, kind="returned").status_code, 200)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.quantity, 7)
        self.assertTrue(Notification.objects.filter(recipient=self.farmer, event_key__startswith="movement:").exists())

    def test_wrong_manager_cannot_receive_another_hubs_stock(self):
        drop_id = self.dispatch(3).data["id"]
        self.hub.manager = self.other
        self.hub.save()
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post(f"/api/hub-drops/{drop_id}/receive/", {"quantity": 3, "note": "No"}).status_code, 403)
        self.assertEqual(self.client.get("/api/hub-drops/").data, [])

    def test_hub_alert_requires_matching_hub_product_category_unit_and_quantity(self):
        need = self.need(hub=self.hub)
        drop_id = self.dispatch(3).data["id"]
        cleanup_marketplace()
        self.assertFalse(Notification.objects.filter(event_key__startswith="hub-match:").exists())
        self.client.force_authenticate(self.manager)
        self.client.post(f"/api/hub-drops/{drop_id}/receive/", {"quantity": 3, "note": "Checked"})
        cleanup_marketplace()
        self.assertEqual(Notification.objects.filter(recipient=self.consumer, event_key__startswith="hub-match:").count(), 1)
        self.client.force_authenticate(self.consumer)
        matches = self.client.get("/api/requests/").data[0]["hub_matches"]
        self.assertEqual(matches[0]["id"], drop_id)
        for field, value in [("unit", "tray"), ("quantity", 5), ("category", "fruits"), ("product_name", "potatoes")]:
            original = getattr(need, field)
            setattr(need, field, value)
            need.save()
            self.assertEqual(self.client.get("/api/requests/").data[0]["hub_matches"], [])
            setattr(need, field, original)
            need.save()

    def test_selecting_hub_alerts_requires_matching_metadata(self):
        payload = {
            "name": "Kitchen order", "quantity": 2, "unit": "kg", "budget": 300,
            "location": "Karen", "deadline": str(timezone.localdate()), "hub": self.hub.pk,
        }
        self.assertEqual(self.client.post("/api/requests/", payload).status_code, 400)
        self.assertEqual(self.client.post("/api/requests/", {**payload, "product_name": "tomatoes", "category": "vegetables"}).status_code, 201)

    def test_selecting_offer_creates_enquiry_at_offer_price_with_no_order(self):
        need = self.need()
        bid = Bid.objects.create(request=need, farmer=self.farmer, listing=self.listing, price=90)
        url = f"/api/bids/{bid.pk}/accept/"
        payload = {"contact": "buyer@example.test", "key": str(uuid.uuid4())}
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(url, payload).status_code, 403)
        self.client.force_authenticate(self.consumer)
        first = self.client.post(url, payload)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(Decimal(first.data["items"][0]["price"]), 90)
        self.assertEqual(self.client.post(url, payload).data["id"], first.data["id"])
        self.assertEqual(self.client.post(url, {**payload, "key": str(uuid.uuid4())}).status_code, 400)
        self.assertFalse(Order.objects.exists())
        need.refresh_from_db()
        self.assertEqual(need.status, "enquiry_sent")

    def test_private_cart_never_notifies_farmer_and_expires_without_stock_change(self):
        expiry = timezone.now() + timedelta(minutes=30)
        payload = [{"listing_id": self.listing.pk, "quantity": 2, "expires_at": expiry.isoformat()}]
        self.assertEqual(self.client.put("/api/cart/", payload, format="json").status_code, 200)
        self.assertFalse(Notification.objects.exists())
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.quantity, 10)
        cleanup_marketplace()
        self.assertEqual(Notification.objects.filter(recipient=self.consumer).count(), 1)
        self.assertFalse(Notification.objects.filter(recipient=self.farmer).exists())
        SavedCartItem.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        cleanup_marketplace()
        self.assertFalse(SavedCartItem.objects.exists())
        self.assertFalse(Notification.objects.filter(recipient=self.farmer).exists())
        self.assertFalse(Enquiry.objects.exists())

    def test_cart_deadline_cannot_extend_and_other_accounts_cannot_access_it(self):
        expiry = timezone.now() + timedelta(hours=2)
        payload = [{"listing_id": self.listing.pk, "quantity": 2, "expires_at": expiry.isoformat()}]
        self.client.put("/api/cart/", payload, format="json")
        payload[0]["expires_at"] = (timezone.now() + timedelta(days=2)).isoformat()
        self.client.put("/api/cart/", payload, format="json")
        self.assertEqual(SavedCartItem.objects.get().expires_at, expiry)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/cart/").data, [])
        self.assertEqual(self.client.put(f"/api/cart/?owner={self.consumer.pk}", [], format="json").status_code, 403)

    def test_listing_expiry_cleans_private_cart_early_and_alerts_hub_manager(self):
        drop_id = self.dispatch(3).data["id"]
        self.client.force_authenticate(self.manager)
        self.client.post(f"/api/hub-drops/{drop_id}/receive/", {"quantity": 3, "note": "Checked"})
        Notification.objects.all().delete()
        expiry = timezone.now() + timedelta(minutes=30)
        Listing.objects.filter(pk=drop_id).update(available_until=expiry)
        cleanup_marketplace()
        self.assertTrue(Notification.objects.filter(recipient=self.manager, event_key__startswith="availability-reminder:").exists())
        self.client.force_authenticate(self.consumer)
        self.client.put("/api/cart/", [{"listing_id": drop_id, "quantity": 2, "expires_at": (expiry + timedelta(hours=2)).isoformat()}], format="json")
        self.assertEqual(SavedCartItem.objects.get().expires_at, expiry)
        Listing.objects.filter(pk=drop_id).update(available_until=timezone.now() - timedelta(seconds=1))
        cleanup_marketplace()
        cleanup_marketplace()
        self.assertFalse(SavedCartItem.objects.exists())
        self.assertEqual(Notification.objects.filter(recipient=self.consumer, event_key__endswith="unavailable").count(), 1)
        self.assertTrue(Notification.objects.filter(recipient=self.manager, event_key__startswith="listing:").exists())
        self.assertFalse(Enquiry.objects.exists())

    def test_new_listings_must_start_at_farm_and_opening_movement_is_recorded(self):
        self.client.force_authenticate(self.farmer)
        payload = {
            "name": "Carrots", "category": "vegetables", "price": "30", "quantity": "5", "unit": "kg",
            "channel": "direct", "hub": None, "location": "Limuru", "latitude": -1.16, "longitude": 36.65,
            "harvest_date": str(timezone.localdate()),
        }
        response = self.client.post("/api/listings/", payload, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(StockMovement.objects.filter(listing_id=response.data["id"], kind="opening").exists())
        self.assertEqual(response.data["movements"][0]["kind"], "opening")
        self.assertEqual(self.client.post("/api/listings/", {**payload, "channel": "hub", "hub": self.hub.pk}, format="json").status_code, 400)
        with patch("market.views.record_stock", side_effect=IntegrityError("Opening movement failed")):
            with self.assertRaises(IntegrityError):
                self.client.post("/api/listings/", payload, format="json")
        self.assertEqual(Listing.objects.filter(name="Carrots").count(), 1)

    def test_payment_and_fulfilment_writes_are_explicitly_retired(self):
        self.assertEqual(self.client.post("/api/checkout/", {}).status_code, 410)
        for action in ["payment", "transition", "cancel", "review", "tracking"]:
            self.assertEqual(self.client.post(f"/api/orders/{uuid.uuid4()}/{action}/", {}).status_code, 410)

    def test_hub_and_request_search_remain_contextual(self):
        need = self.need()
        need.notes = "Community kitchen"
        need.save()
        self.assertEqual(len(self.client.get("/api/hubs/?q=karen").data), 1)
        self.assertEqual(self.client.get("/api/hubs/?q=missing").data, [])
        for query in ["tomatoes", "karen", "community"]:
            self.assertEqual(self.client.get("/api/requests/", {"q": query}).data[0]["id"], need.pk)
        self.assertEqual(self.client.get("/api/requests/?q=missing").data, [])
        self.assertEqual(self.client.get("/api/listings/?lat=nan&lng=36").status_code, 400)

    def test_registration_cannot_grant_privileged_roles_and_login_requires_csrf(self):
        self.client.force_authenticate(None)
        response = self.client.post("/api/register/", {
            "name": "Invalid manager", "username": "badrole", "email": "test@example.com",
            "password": "SafeTestPassword2026!", "role": "manager",
        })
        self.assertEqual(response.status_code, 400)
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.post("/api/login/", {"username": "buyer", "password": "TestPassword2026!"}).status_code, 403)
        client.get("/api/session/")
        csrf = client.cookies["sokosoo_csrftoken"].value
        self.assertEqual(client.post("/api/login/", {"username": "buyer", "password": "TestPassword2026!"}, HTTP_X_CSRFTOKEN=csrf).status_code, 200)
        csrf = client.cookies["sokosoo_csrftoken"].value
        response = client.put("/api/cart/", [{
            "listing_id": self.listing.pk, "quantity": 2,
            "expires_at": (timezone.now() + timedelta(hours=1)).isoformat(),
        }], format="json", HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(response.status_code, 200)
