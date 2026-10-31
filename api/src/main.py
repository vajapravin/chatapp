import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routes import (
    auth_router,
    groups_router,
    health_router,
    keys_router,
    presence_router,
    push_router,
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

# Include Routers
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(keys_router)
app.include_router(groups_router)
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
