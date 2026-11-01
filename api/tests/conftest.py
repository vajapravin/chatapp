from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from src.database import Base, get_db
from src.main import app
from src.routes.auth import get_redis_client

# In-memory SQLite async engine for tests
TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DB_URL, echo=False)
test_session_factory = async_sessionmaker(
    test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class MockPipeline:
    def __init__(self, redis):
        self.redis = redis
        self.results = []

    def zremrangebyscore(self, key, min_s, max_s):
        self.results.append(0)
        return self

    def zadd(self, key, mapping):
        self.results.append(1)
        return self

    def zcard(self, key):
        self.results.append(1)
        return self

    def expire(self, key, ttl):
        self.results.append(True)
        return self

    async def execute(self):
        return self.results

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass


class MockRedis:
    def __init__(self):
        self.store = {}
        self.sets = {}
        self.hashes = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None):
        self.store[key] = value
        return True

    async def delete(self, key: str):
        self.store.pop(key, None)
        self.sets.pop(key, None)
        self.hashes.pop(key, None)
        return 1

    async def ping(self):
        return True

    async def sadd(self, key: str, *members):
        if key not in self.sets:
            self.sets[key] = set()
        for m in members:
            self.sets[key].add(str(m))
        return len(members)

    async def srem(self, key: str, *members):
        if key in self.sets:
            for m in members:
                self.sets[key].discard(str(m))
        return 1

    async def sismember(self, key: str, member: str):
        return member in self.sets.get(key, set())

    async def hset(self, key: str, mapping: dict | None = None, **kwargs):
        if key not in self.hashes:
            self.hashes[key] = {}
        if mapping:
            self.hashes[key].update(mapping)
        if kwargs:
            self.hashes[key].update(kwargs)
        return True

    async def hget(self, key: str, field: str):
        return self.hashes.get(key, {}).get(field)

    def pipeline(self, transaction=True):
        return MockPipeline(self)

    async def aclose(self):
        pass


@pytest.fixture
def mock_redis():
    return MockRedis()


@pytest.fixture(autouse=True)
async def setup_test_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with test_session_factory() as session:
        yield session


@pytest.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async with test_session_factory() as session:
        yield session


@pytest.fixture
async def client(mock_redis) -> AsyncGenerator[AsyncClient, None]:
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_redis_client] = lambda: mock_redis

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
