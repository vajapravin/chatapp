import logging
import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
import redis.asyncio as aioredis
from ..config import settings

logger = logging.getLogger("chatapp.api.rate_limit")


class SlidingWindowRateLimiter(BaseHTTPMiddleware):
    def __init__(self, app, redis_url: str):
        super().__init__(app)
        self.redis_url = redis_url
        self._redis: aioredis.Redis | None = None

    async def get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(self.redis_url, decode_responses=True)
        return self._redis

    async def dispatch(self, request: Request, call_next):
        # Exclude healthz, metrics, and static documentation
        path = request.url.path
        if path in ("/healthz", "/metrics", "/docs", "/openapi.json", "/redoc"):
            return await call_next(request)

        try:
            r = await self.get_redis()
            client_ip = request.client.host if request.client else "127.0.0.1"
            now = time.time()

            # 1. Strict IP Rate Limit on OTP Request: max 5 requests per 15 minutes (100 in dev)
            if path == "/v1/auth/otp/request" and request.method == "POST":
                key = f"ratelimit:ip_otp:{client_ip}"
                window = 900  # 15 minutes
                max_reqs = 100 if settings.ENV == "development" else 5

                # Sliding window via sorted set
                async with r.pipeline(transaction=True) as pipe:
                    pipe.zremrangebyscore(key, 0, now - window)
                    pipe.zadd(key, {f"{now}:{time.time_ns()}": now})
                    pipe.zcard(key)
                    pipe.expire(key, window)
                    _, _, count, _ = await pipe.execute()

                if count > max_reqs:
                    logger.warning("Rate limit exceeded for IP %s on %s (count: %d)", client_ip, path, count)
                    return JSONResponse(
                        status_code=429,
                        content={"detail": "Too many requests. Please try again in 15 minutes."},
                        headers={"Retry-After": "900"},
                    )

            # 2. General endpoint velocity protection
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                # User rate limit key based on authorization header token hash
                token_snip = auth_header[-16:]
                user_key = f"ratelimit:user:{token_snip}"
                window = 60
                max_reqs = 180  # 180 reqs / min

                async with r.pipeline(transaction=True) as pipe:
                    pipe.zremrangebyscore(user_key, 0, now - window)
                    pipe.zadd(user_key, {f"{now}:{time.time_ns()}": now})
                    pipe.zcard(user_key)
                    pipe.expire(user_key, window)
                    _, _, user_count, _ = await pipe.execute()

                if user_count > max_reqs:
                    return JSONResponse(
                        status_code=429,
                        content={"detail": "API rate limit exceeded. Please slow down."},
                        headers={"Retry-After": "60"},
                    )

        except Exception as e:
            # Non-blocking if Redis is briefly busy
            logger.debug("Rate limiter check error: %s", e)

        return await call_next(request)
