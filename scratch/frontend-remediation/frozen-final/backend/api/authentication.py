from rest_framework.authentication import SessionAuthentication


class CsrfExemptSessionAuthentication(SessionAuthentication):
    """Session auth without CSRF enforcement — safe for API-only endpoints
    that are consumed by a separate frontend (Vite dev server, mobile app, etc.)."""

    def enforce_csrf(self, request):
        pass
