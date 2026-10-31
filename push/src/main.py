import asyncio
import json
import logging
import os
import nats
from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("chatapp.push")

NATS_URL = os.getenv("NATS_URL", "nats://nats:4222")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://chatapp:chatapp_secret@postgres:5432/chatapp")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_CLAIMS = {
    "sub": os.getenv("VAPID_SUB", "mailto:admin@vajapravin.me"),
}

engine = create_async_engine(DATABASE_URL, pool_size=3, max_overflow=5)
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def send_web_push(sub: dict, sender_user: str):
    """Dispatch VAPID Web Push notification with ZERO message plaintext."""
    if not VAPID_PRIVATE_KEY:
        logger.debug("VAPID_PRIVATE_KEY not configured; skipping push dispatch")
        return

    payload = json.dumps({
        "title": "Chatapp",
        "body": "You have a new end-to-end encrypted message",
        "sender": sender_user,
    })

    try:
        webpush(
            subscription_info=sub,
            data=payload,
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=VAPID_CLAIMS,
        )
        logger.info("Sent Web Push notification to %s", sub.get("endpoint", "")[:30])
    except WebPushException as ex:
        logger.warning("Web Push delivery failed: %s", ex)


async def run_push():
    logger.info("Starting chatapp-push service...")

    while True:
        try:
            logger.info("Connecting to NATS at %s...", NATS_URL)
            nc = await nats.connect(NATS_URL)
            logger.info("Connected to NATS. Subscribing to events.push.notify...")

            async def message_handler(msg):
                try:
                    data = json.loads(msg.data.decode())
                    recipient_user = data.get("recipient_user")
                    recipient_device = data.get("recipient_device", 1)
                    sender_user = data.get("sender_user", "Someone")

                    from sqlalchemy import text

                    async with async_session() as session:
                        stmt = text(
                            """
                            SELECT endpoint, p256dh, auth
                            FROM push_subscriptions
                            WHERE user_id = :u AND device_id = :d
                            """
                        )
                        res = await session.execute(stmt, {"u": recipient_user, "d": recipient_device})
                        row = res.fetchone()
                        if row:
                            sub_info = {
                                "endpoint": row[0],
                                "keys": {
                                    "p256dh": row[1],
                                    "auth": row[2],
                                },
                            }
                            await send_web_push(sub_info, sender_user)
                except Exception as e:
                    logger.error("Error processing push event: %s", e)

            await nc.subscribe("events.push.notify", cb=message_handler)

            while True:
                await asyncio.sleep(1)

        except Exception as e:
            logger.warning("NATS connection error: %s. Retrying in 3s...", e)
            await asyncio.sleep(3)


def main():
    asyncio.run(run_push())


if __name__ == "__main__":
    main()
