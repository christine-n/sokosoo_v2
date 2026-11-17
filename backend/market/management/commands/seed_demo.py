from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from market.models import DeliveryEvent, Hub, Listing, Order, OrderItem, ProduceRequest, Profile


class Command(BaseCommand):
    help = "Create clearly labeled local demo accounts, catalog, and delivery. Never use on production data."

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Demo seed is disabled outside DEBUG mode.")
        people = [
            ("consumer", "Amani", "consumer", ""),
            ("farmer", "Grace Wanjiku", "farmer", "Wanjiku Family Farm"),
            ("farmer2", "James Mwangi", "farmer", "Green Valley Farm"),
            ("manager", "Faith", "manager", ""),
            ("driver", "Daniel", "driver", ""),
        ]
        users = {}
        for username, name, role, farm in people:
            user, created = User.objects.get_or_create(username=username, defaults={"first_name": name})
            if created:
                user.set_password("SokoDemo2026!")
                user.save()
            Profile.objects.get_or_create(user=user, defaults={"role": role, "farm_name": farm})
            users[username] = user
        hub, _ = Hub.objects.get_or_create(name="Karen Harvest Hub", defaults={
            "location": "Karen, Nairobi", "latitude": -1.319, "longitude": 36.708, "manager": users["manager"],
        })
        Hub.objects.get_or_create(name="Kilimani Community Hub", defaults={
            "location": "Kilimani, Nairobi", "latitude": -1.292, "longitude": 36.783, "manager": users["manager"],
        })
        photos = {
            "tomatoes": "photo-1546094096-0df4bcaaa337",
            "avocado": "photo-1523049673857-eb18f1d7b578",
            "carrots": "photo-1447175008436-054170c2e979",
            "eggs": "photo-1518569656558-1f25e69d93d7",
            "bananas": "photo-1571771894821-ce9b6c11b08e",
            "milk": "photo-1563636619-e9143da7973b",
            "spinach": "photo-1576045057995-568f588f82fb",
            "potatoes": "photo-1518977676601-b53f82aba655",
        }
        products = [
            ("Vine-ripened tomatoes", "vegetables", "tomatoes", "120", "kg", "direct", "farmer", "Limuru, Kiambu"),
            ("Creamy Hass avocados", "fruits", "avocado", "180", "kg", "hub", "farmer2", "Karen, Nairobi"),
            ("Fresh garden carrots", "vegetables", "carrots", "90", "kg", "direct", "farmer2", "Kikuyu, Kiambu"),
            ("Free-range eggs", "dairy", "eggs", "450", "tray", "hub", "farmer", "Karen, Nairobi"),
            ("Sweet ripe bananas", "fruits", "bananas", "110", "kg", "direct", "farmer", "Limuru, Kiambu"),
            ("Fresh whole milk", "dairy", "milk", "80", "litre", "hub", "farmer2", "Karen, Nairobi"),
            ("Tender baby spinach", "vegetables", "spinach", "70", "kg", "direct", "farmer2", "Kikuyu, Kiambu"),
            ("Farm-fresh potatoes", "vegetables", "potatoes", "85", "kg", "hub", "farmer", "Karen, Nairobi"),
        ]
        for name, category, photo, price, unit, channel, farmer, location in products:
            Listing.objects.get_or_create(name=name, farmer=users[farmer], defaults={
                "category": category, "price": price, "quantity": 100, "unit": unit,
                "channel": channel, "hub": hub if channel == "hub" else None, "received": channel == "hub",
                "location": location, "latitude": -1.16 if farmer == "farmer" else -1.24, "longitude": 36.65,
                "harvest_date": timezone.localdate() - timedelta(days=1),
                "description": "Locally grown and carefully selected. Demo produce for exploring SokoSoo.",
                "image": f"https://images.unsplash.com/{photos[photo]}?auto=format&fit=crop&w=800&q=85",
            })
        ProduceRequest.objects.get_or_create(consumer=users["consumer"], name="Tomatoes for our community kitchen", defaults={
            "quantity": 10, "unit": "kg", "budget": 1500, "location": "Kilimani, Nairobi",
            "notes": "Firm, ripe tomatoes. Delivery this week, please.", "deadline": timezone.localdate() + timedelta(days=7),
        })
        if not Order.objects.filter(consumer=users["consumer"]).exists():
            listing = Listing.objects.get(name="Vine-ripened tomatoes")
            order = Order.objects.create(
                consumer=users["consumer"], driver=users["driver"], address="Demo delivery: Kilimani, Nairobi",
                total=Decimal("360"), status="processing", payment_status="demo",
                expires_at=timezone.now(), payment_method="mpesa",
            )
            OrderItem.objects.create(order=order, listing=listing, quantity=3, price=listing.price)
            DeliveryEvent.objects.create(order=order, status="processing")
        self.stdout.write(self.style.SUCCESS("Local demo ready. Accounts: consumer, farmer, farmer2, manager, driver. Password: SokoDemo2026!"))
