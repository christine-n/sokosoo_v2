from django.contrib import admin
from .models import Bid, DeliveryEvent, Hub, Listing, LocationPing, Order, OrderItem, ProduceRequest, Profile, Review

@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ["id", "consumer", "status", "payment_status", "driver", "total"]
    readonly_fields = ["id", "consumer", "request", "idempotency_key", "address", "total", "payment_method", "payment_status", "status", "expires_at", "created_at"]

@admin.register(Listing)
class ListingAdmin(admin.ModelAdmin):
    list_display = ["name", "farmer", "channel", "hub", "quantity", "reserved", "received"]
    readonly_fields = ["quantity", "reserved", "received"]

admin.site.register([Profile, Hub, ProduceRequest, Bid])
for model in [OrderItem, DeliveryEvent, LocationPing, Review]:
    @admin.register(model)
    class ReadOnlyAdmin(admin.ModelAdmin):
        def has_add_permission(self, request):
            return False

        def has_change_permission(self, request, obj=None):
            return False

        def has_delete_permission(self, request, obj=None):
            return False
