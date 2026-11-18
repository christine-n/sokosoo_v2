import time

from django.core.management.base import BaseCommand

from market.connections import cleanup_marketplace
from market.services import expire_reservations


class Command(BaseCommand):
    help = "Archive expired availability, expire enquiries and private carts, and create deduplicated in-app notifications."

    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true", help="Run every minute until stopped.")

    def handle(self, *args, **options):
        while True:
            expire_reservations()
            cleanup_marketplace()
            self.stdout.write("Marketplace cleanup completed.")
            if not options["loop"]:
                return
            time.sleep(60)
