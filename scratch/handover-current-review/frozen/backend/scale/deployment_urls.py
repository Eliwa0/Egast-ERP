from django.urls import path

from . import deployment_views

urlpatterns = [
    path(
        "deploy/",
        deployment_views.scale_agent_deploy_view,
        name="scale_agent_deploy",
    ),
]