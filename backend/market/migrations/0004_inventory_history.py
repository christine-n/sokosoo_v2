from datetime import timedelta

from django.db import migrations
from django.utils import timezone


def preserve_inventory(apps, schema_editor):
    Listing = apps.get_model("market", "Listing")
    Movement = apps.get_model("market", "StockMovement")
    now = timezone.now()
    for listing in Listing.objects.all().iterator():
        listing.available_until = listing.created_at + timedelta(hours=24)
        if listing.available_until <= now:
            listing.state = "archived"
        if listing.channel == "hub":
            listing.dispatched_quantity = listing.quantity
            listing.received_quantity = listing.quantity if listing.received else 0
            if not listing.received:
                listing.quantity = listing.reserved
        listing.save()
        Movement.objects.create(
            listing=listing, actor_id=None, kind="opening", change=listing.quantity,
            balance=listing.quantity,
            note="Opening balance from the previous marketplace. Historical orders remain unchanged.",
        )


class Migration(migrations.Migration):
    dependencies = [("market", "0003_listing_available_until_listing_dispatched_quantity_and_more")]
    operations = [migrations.RunPython(preserve_inventory, migrations.RunPython.noop)]
