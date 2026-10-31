import asyncio
from datetime import UTC, datetime
import json
import logging
import os
import aiomqtt
import redis.asyncio as aioredis

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("chatapp.presence")

MQTT_HOST = os.getenv("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USER = os.getenv("MQTT_USER", "router")
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-insecure-secret-key-change-in-production-12345678")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")


async def run_presence():
    logger.info("Starting chatapp-presence service...")
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)

    while True:
        try:
            logger.info("Connecting to Mosquitto for presence tracking at %s:%d...", MQTT_HOST, MQTT_PORT)
            async with aiomqtt.Client(
                hostname=MQTT_HOST,
                port=MQTT_PORT,
                username=MQTT_USER,
                password=JWT_SECRET_KEY,
                identifier="chatapp_presence_worker",
            ) as mqtt_client:
                await mqtt_client.subscribe("p/#", qos=0)
                logger.info("Subscribed to presence updates on p/#")

                async for message in mqtt_client.messages:
                    topic = message.topic.value
                    parts = topic.split("/")
                    if len(parts) >= 2:
                        user_id = parts[1]
                        now_ts = int(datetime.now(UTC).timestamp())
                        try:
                            payload = json.loads(message.payload.decode("utf-8"))
                        except Exception:
                            payload = {"online": True}

                        # Check if LWT offline event or online heartbeat
                        is_online = payload.get("online", True)
                        redis_payload = json.dumps({
                            "user_id": user_id,
                            "online": is_online,
                            "last_seen": now_ts,
                        })
                        if is_online:
                            await redis.set(f"presence:{user_id}", redis_payload, ex=60)
                        else:
                            await redis.set(f"presence:{user_id}", redis_payload)

                        logger.debug("Presence updated for user %s: online=%s", user_id, is_online)

        except (aiomqtt.MqttError, Exception) as e:
            logger.warning("Presence service disconnected: %s. Retrying in 3s...", e)
            await asyncio.sleep(3)


def main():
    asyncio.run(run_presence())


if __name__ == "__main__":
    main()
