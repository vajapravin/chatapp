import asyncio
import logging

import ulid
from sqlalchemy import select

from ..database import async_session_factory
from ..models.db import Device, User

logger = logging.getLogger("chatapp.seed")


DEMO_USERS = [
    {
        "phone_number": "+10000000001",
        "email": "alice@example.com",
        "display_name": "Alice Dev",
        "device_name": "Alice Chrome Browser",
    },
    {
        "phone_number": "+10000000002",
        "email": "bob@example.com",
        "display_name": "Bob Tester",
        "device_name": "Bob Firefox Browser",
    },
]


async def seed_demo_users():
    logger.info("Seeding demo users...")
    async with async_session_factory() as session:
        for u in DEMO_USERS:
            stmt = select(User).where(User.phone_number == u["phone_number"])
            res = await session.execute(stmt)
            existing = res.scalar_one_or_none()

            if not existing:
                user_id = str(ulid.new())
                user = User(
                    id=user_id,
                    phone_number=u["phone_number"],
                    email=u["email"],
                    display_name=u["display_name"],
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
                logger.info("Demo user %s already exists (%s)", u["display_name"], existing.id)

        await session.commit()
    logger.info("Seeding completed successfully.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(seed_demo_users())
