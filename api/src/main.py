import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .middleware.rate_limit import SlidingWindowRateLimiter
from .routes import (
    admin_router,
    auth_router,
    backups_router,
    blocks_reports_router,
    calls_router,
    channels_router,
    devices_router,
    groups_router,
    health_router,
    invites_router,
    keys_router,
    media_router,
    passkeys_router,
    presence_router,
    privacy_router,
    push_router,
    two_step_router,
    users_router,
)

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("chatapp.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s in %s mode...", settings.APP_NAME, settings.ENV)
    yield
    logger.info("Shutting down %s...", settings.APP_NAME)


app = FastAPI(
    title="Chatapp API",
    description="Backend REST API, authentication, and signaling server for chatapp",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sliding Window Rate Limiter
app.add_middleware(
    SlidingWindowRateLimiter,
    redis_url=settings.REDIS_URL,
)

# Include Routers
app.include_router(health_router)
app.include_router(invites_router)
app.include_router(auth_router)
app.include_router(two_step_router)
app.include_router(passkeys_router)
app.include_router(blocks_reports_router)
app.include_router(users_router)
app.include_router(keys_router)
app.include_router(privacy_router)
app.include_router(admin_router)
app.include_router(devices_router)
app.include_router(backups_router)
app.include_router(groups_router)
app.include_router(channels_router)
app.include_router(media_router)
app.include_router(calls_router)
app.include_router(presence_router)
app.include_router(push_router)


@app.get("/")
async def root() -> dict:
    return {
        "app": settings.APP_NAME,
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/healthz",
    }


@app.get("/v1/time")
async def get_server_time() -> dict:
    """Return authoritative server time in milliseconds for radio synchronization."""
    import time
    return {"server_time_ms": int(time.time() * 1000)}
