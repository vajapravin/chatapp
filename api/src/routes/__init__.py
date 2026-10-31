from .auth import router as auth_router
from .groups import router as groups_router
from .health import router as health_router
from .keys import router as keys_router
from .presence import router as presence_router
from .push import router as push_router
from .users import router as users_router

__all__ = [
    "auth_router",
    "groups_router",
    "health_router",
    "keys_router",
    "presence_router",
    "push_router",
    "users_router",
]
