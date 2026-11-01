import asyncio
import logging

import ulid
from sqlalchemy import select

from ..config import settings
from ..database import async_session_factory
from ..models.db import Device, User

logger = logging.getLogger("chatapp.seed")


DEMO_USERS = [
    {
        "phone_number": "+10000000001",
        "email": "alice@example.com",
        "display_name": "Alice Dev",
        "device_name": "Alice Chrome Browser",
        "role": "user",
    },
    {
        "phone_number": "+10000000002",
        "email": "bob@example.com",
        "display_name": "Bob Tester",
        "device_name": "Bob Firefox Browser",
        "role": "user",
    },
]


async def seed_demo_users():
    logger.info("Seeding demo users and admin...")
    async with async_session_factory() as session:
        # 1. Seed or ensure Admin User from ADMIN_EMAIL
        admin_email = settings.ADMIN_EMAIL.lower().strip()
        if admin_email:
            stmt_admin = select(User).where(User.email == admin_email)
            res_admin = await session.execute(stmt_admin)
            admin_user = res_admin.scalar_one_or_none()
            if not admin_user:
                admin_id = str(ulid.new())
                admin_user = User(
                    id=admin_id,
                    email=admin_email,
                    display_name="Instance Admin",
                    role="admin",
                    status="active",
                )
                session.add(admin_user)
                await session.flush()

                admin_dev = Device(
                    id=str(ulid.new()),
                    user_id=admin_user.id,
                    device_id=1,
                    device_name="Admin Primary Device",
                )
                session.add(admin_dev)
                logger.info("Created instance admin %s (ID: %s)", admin_email, admin_user.id)
            else:
                admin_user.role = "admin"
                admin_user.status = "active"
                logger.info("Instance admin %s verified (ID: %s)", admin_email, admin_user.id)

        # 2. Seed Demo Users
        for u in DEMO_USERS:
            stmt = select(User).where((User.phone_number == u["phone_number"]) | (User.email == u["email"]))
            res = await session.execute(stmt)
            existing = res.scalar_one_or_none()

            if not existing:
                user_id = str(ulid.new())
                user = User(
                    id=user_id,
                    phone_number=u["phone_number"],
                    email=u["email"],
                    display_name=u["display_name"],
                    role=u["role"],
                    status="active",
                )
                session.add(user)
                await session.flush()

                device = Device(
                    id=str(ulid.new()),
                    user_id=user.id,
                    device_id=1,
                    device_name=u["device_name"],
                )
                session.add(device)
                logger.info("Created demo user %s (%s, ID: %s)", u["display_name"], u["phone_number"], user.id)
            else:
                existing.status = "active"
                logger.info("Demo user %s already exists (%s)", u["display_name"], existing.id)

        await session.commit()
    logger.info("Seeding completed successfully.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(seed_demo_users())
