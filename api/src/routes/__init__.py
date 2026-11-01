from .admin import router as admin_router
from .auth import router as auth_router
from .backups import router as backups_router
from .blocks_reports import router as blocks_reports_router
from .calls import router as calls_router
from .devices import router as devices_router
from .groups import router as groups_router
from .health import router as health_router
from .keys import router as keys_router
from .media import router as media_router
from .passkeys import router as passkeys_router
from .presence import router as presence_router
from .privacy import router as privacy_router
from .push import router as push_router
from .two_step import router as two_step_router
from .users import router as users_router

__all__ = [
    "admin_router",
    "auth_router",
    "backups_router",
    "blocks_reports_router",
    "calls_router",
    "devices_router",
    "groups_router",
    "health_router",
    "keys_router",
    "media_router",
    "passkeys_router",
    "presence_router",
    "privacy_router",
    "push_router",
    "two_step_router",
    "users_router",
]
