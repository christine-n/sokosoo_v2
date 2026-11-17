from django.urls import path
from . import views

urlpatterns = [
    path("session/", views.SessionView.as_view()),
    path("login/", views.LoginView.as_view()),
    path("register/", views.RegisterView.as_view()),
    path("logout/", views.logout_view),
    path("driver-token/", views.DriverTokenView.as_view()),
    path("listings/", views.ListingsView.as_view()),
    path("hubs/", views.hubs),
    path("hub-drops/", views.hub_drops),
    path("hub-drops/<int:pk>/receive/", views.receive_drop),
    path("requests/", views.RequestsView.as_view()),
    path("requests/<int:pk>/bids/", views.submit_bid),
    path("bids/<int:pk>/accept/", views.accept_bid),
    path("checkout/", views.checkout),
    path("orders/", views.orders),
    path("orders/<uuid:pk>/cancel/", views.cancel_order),
    path("orders/<uuid:pk>/payment/", views.initiate_payment),
    path("orders/<uuid:pk>/review/", views.review_order),
    path("orders/<uuid:pk>/transition/", views.transition_delivery),
    path("orders/<uuid:pk>/tracking/", views.tracking),
]
