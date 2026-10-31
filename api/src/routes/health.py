import redis.asyncio as aioredis
from fastapi import APIRouter, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, generate_latest
from sqlalchemy import text

from ..config import settings
from ..database import async_session_factory

router = APIRouter(tags=["Health & Metrics"])

HEALTH_REQUEST_COUNT = Counter("chatapp_health_requests_total", "Total /healthz requests")


@router.get("/healthz")
async def health_check() -> dict:
    """Comprehensive health check checking Postgres, Redis, and service state."""
    HEALTH_REQUEST_COUNT.inc()
    details: dict[str, str] = {}
    is_healthy = True

    # Check Postgres
    try:
        async with async_session_factory() as session:
            await session.execute(text("SELECT 1"))
            details["postgres"] = "healthy"
    except Exception as e:
        details["postgres"] = f"unhealthy: {e}"
        is_healthy = False

    # Check Redis
    try:
        r = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        await r.ping()
        await r.aclose()
        details["redis"] = "healthy"
    except Exception as e:
        details["redis"] = f"unhealthy: {e}"
        is_healthy = False

    return {
        "status": "healthy" if is_healthy else "degraded",
        "service": settings.APP_NAME,
        "details": details,
    }


@router.get("/metrics")
async def metrics() -> Response:
    """Expose Prometheus formatted metrics."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
