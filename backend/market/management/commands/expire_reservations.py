from django.core.management.base import BaseCommand
from market.services import expire_reservations


class Command(BaseCommand):
    help = "Release expired unpaid reservations. Schedule this at least once per minute."

    def handle(self, *args, **options):
        expire_reservations()
        self.stdout.write(self.style.SUCCESS("Expired reservations processed."))
