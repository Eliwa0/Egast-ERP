from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/scale/", include("scale.urls")),
    path("scale-management/", include("scale.deployment_urls")),
    path("api/", include("api.urls")),
]
