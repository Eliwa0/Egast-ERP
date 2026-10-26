import os
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent.parent

from dotenv import load_dotenv

load_dotenv(BASE_DIR / ".env")


def _env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name, default=""):
    raw = os.getenv(name, default)
    if raw.strip() == "*":
        return ["*"]
    return [item.strip() for item in raw.split(",") if item.strip()]


SECRET_KEY = os.getenv("SECRET_KEY", "django-insecure-your-secret-key")
DEBUG = _env_bool("DEBUG", False)
ALLOWED_HOSTS = _env_list("ALLOWED_HOSTS", "")
SCALE_AGENT_AUTH_TOKEN = os.getenv("SCALE_AGENT_AUTH_TOKEN", "").strip()

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "api",
    "scale",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "api.performance.PerformanceMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Detailed timing is opt-in; correlation IDs are always returned. No request data
# or SQL text is collected. Configure egast.performance INFO logging to persist it.
PERFORMANCE_METRICS_ENABLED = _env_bool("PERFORMANCE_METRICS_ENABLED", False)
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"performance_console": {"class": "logging.StreamHandler"}},
    "loggers": {"egast.performance": {"handlers": ["performance_console"], "level": "INFO", "propagate": False}},
}

from corsheaders.defaults import default_headers
CORS_ALLOW_HEADERS = (*default_headers, "x-request-id")
CORS_EXPOSE_HEADERS = ["X-Request-ID", "Server-Timing"]

ROOT_URLCONF = "receipt_project.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "receipt_project.wsgi.application"

DB_ENGINE = os.getenv("DB_ENGINE", "sqlite")
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if DATABASE_URL:
    parsed_db = urlparse(DATABASE_URL)
    if parsed_db.scheme not in {"postgres", "postgresql"}:
        raise ValueError("DATABASE_URL currently supports postgres/postgresql URLs only")
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": parsed_db.path.lstrip("/"),
            "USER": parsed_db.username or "",
            "PASSWORD": parsed_db.password or "",
            "HOST": parsed_db.hostname or "localhost",
            "PORT": str(parsed_db.port or 5432),
        }
    }
elif DB_ENGINE == "postgres":
    DATABASES = {
         "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("DB_NAME"),
            "USER": os.getenv("DB_USER"),
            "PASSWORD": os.getenv("DB_PASSWORD"),
            "HOST": os.getenv("DB_HOST", "localhost"),
            "PORT": os.getenv("DB_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
            "OPTIONS": {"timeout": 20},
        }
    }

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REDIS_URL = os.getenv("REDIS_URL", "").strip()
CACHE_KEY_PREFIX = os.getenv("CACHE_KEY_PREFIX", "receipt_from_production")
CACHE_DEFAULT_TIMEOUT = int(os.getenv("CACHE_DEFAULT_TIMEOUT", "300"))
APP_CACHE_TIMEOUTS = {
    "sap_item_groups": int(os.getenv("CACHE_TIMEOUT_SAP_ITEM_GROUPS", "3600")),
    "sap_items": int(os.getenv("CACHE_TIMEOUT_SAP_ITEMS", "900")),
    "sap_farms": int(os.getenv("CACHE_TIMEOUT_SAP_FARMS", "1800")),
    "sap_contractors": int(os.getenv("CACHE_TIMEOUT_SAP_CONTRACTORS", "1800")),
    "batch_udf_metadata": int(os.getenv("CACHE_TIMEOUT_BATCH_UDF_METADATA", "1800")),
    "quality_categories": int(os.getenv("CACHE_TIMEOUT_QUALITY_CATEGORIES", "300")),
    "inspection_stages": int(os.getenv("CACHE_TIMEOUT_INSPECTION_STAGES", "300")),
    "quality_criteria": int(os.getenv("CACHE_TIMEOUT_QUALITY_CRITERIA", "300")),
    "inspection_quality_criteria": int(os.getenv("CACHE_TIMEOUT_INSPECTION_QUALITY_CRITERIA", "300")),
    "item_quality_criteria": int(os.getenv("CACHE_TIMEOUT_ITEM_QUALITY_CRITERIA", "300")),
    "sap_warehouses": int(os.getenv("CACHE_TIMEOUT_SAP_WAREHOUSES", "600")),
    "sap_bin_locations": int(os.getenv("CACHE_TIMEOUT_SAP_BIN_LOCATIONS", "600")),
    "sap_uoms": int(os.getenv("CACHE_TIMEOUT_SAP_UOMS", "600")),
    "sap_uom_options": int(os.getenv("CACHE_TIMEOUT_SAP_UOM_OPTIONS", "600")),
    "sap_company_options": int(os.getenv("CACHE_TIMEOUT_SAP_COMPANY_OPTIONS", "600")),
    "sap_currencies": int(os.getenv("CACHE_TIMEOUT_SAP_CURRENCIES", "600")),
    "sap_warehouse_locations": int(os.getenv("CACHE_TIMEOUT_SAP_WAREHOUSE_LOCATIONS", "600")),
    "sap_tax_codes": int(os.getenv("CACHE_TIMEOUT_SAP_TAX_CODES", "600")),
    "sap_cost_centers": int(os.getenv("CACHE_TIMEOUT_SAP_COST_CENTERS", "3600")),
    "sap_quotation_metadata": int(os.getenv("CACHE_TIMEOUT_SAP_QUOTATION_METADATA", "3600")),
    "sap_customers": int(os.getenv("CACHE_TIMEOUT_SAP_CUSTOMERS", "1800")),
}

if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
            "KEY_PREFIX": CACHE_KEY_PREFIX,
            "TIMEOUT": CACHE_DEFAULT_TIMEOUT,
            "OPTIONS": {
                "socket_connect_timeout": float(os.getenv("REDIS_SOCKET_CONNECT_TIMEOUT", "1")),
                "socket_timeout": float(os.getenv("REDIS_SOCKET_TIMEOUT", "1")),
            },
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": CACHE_KEY_PREFIX,
            "TIMEOUT": CACHE_DEFAULT_TIMEOUT,
        }
    }

CORS_ALLOW_ALL_ORIGINS = _env_bool("CORS_ALLOW_ALL_ORIGINS", False)
CORS_ALLOWED_ORIGINS = _env_list("CORS_ALLOWED_ORIGINS", "")
CORS_ALLOW_CREDENTIALS = _env_bool("CORS_ALLOW_CREDENTIALS", True)
CSRF_TRUSTED_ORIGINS = _env_list(
    "CSRF_TRUSTED_ORIGINS",
    "",
)

# ── Scale Agent deployment ────────────────────────────────────────────────────
# The Scale Agent runs on a separate Windows PC (next to the physical scale) and
# pushes weight readings back to the ERP server over HTTP. It needs a URL it can
# actually reach (LAN IP or public domain), so it MUST NOT be derived from a
# localhost/development value. Configure it explicitly in the environment.
SCALE_AGENT_SERVER_URL = os.getenv("SCALE_AGENT_SERVER_URL", "").strip()

# Path to the current build (PyInstaller output). The deployment endpoint
# refuses to package a non-existent executable. Override in tests/environments.
SCALE_AGENT_EXE_PATH = os.getenv(
    "SCALE_AGENT_EXE_PATH",
    str(BASE_DIR.parent / "scale_agent" / "dist" / "current" / "ScaleAgent.exe"),
)

# ── Transfer stage warehouse configuration ───────────────────────────────────
# Replace placeholder values with actual SAP WarehouseCodes once confirmed.
# Override via environment variables:
#   TRANSFER_INTERMEDIATE_WAREHOUSES=WH-INT1,WH-INT2
#   TRANSFER_FRIDGE_WAREHOUSES=WH-FRG1,WH-FRG2
def _wh_list(env_key, default):
    raw = os.environ.get(env_key, default)
    return [c.strip() for c in raw.split(",") if c.strip()]

# Set TRANSFER_INTERMEDIATE_WAREHOUSES to the real SAP warehouse code(s),
# comma-separated.  When not set the backend auto-detects candidates from OWHS
# using keyword search (TRANSIT, TEMP, WIP, QC, وسيط) and the frontend shows
# all warehouses in that dropdown.
TRANSFER_INTERMEDIATE_WAREHOUSES = _wh_list(
    "TRANSFER_INTERMEDIATE_WAREHOUSES", ""
)
# Set TRANSFER_FRIDGE_WAREHOUSES to the real SAP warehouse code(s),
# comma-separated.  When not set all warehouses are shown in the dropdown.
TRANSFER_FRIDGE_WAREHOUSES = _wh_list(
    "TRANSFER_FRIDGE_WAREHOUSES", ""
)

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "api.authentication.CsrfExemptSessionAuthentication",
    ],
}
