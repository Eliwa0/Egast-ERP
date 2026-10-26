import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "receipt_project.settings")

django.setup()

from django.db.models.signals import post_save
from django.contrib.auth.models import User
from api.models import UserProfile

post_save.disconnect(sender=User, dispatch_uid="create_user_profile")
post_save.disconnect(sender=User, dispatch_uid="save_user_profile")

from django.core.management import call_command

call_command("loaddata", "sqlite_backup_data.json")