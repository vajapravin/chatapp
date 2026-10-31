import asyncio
import json
import logging
import signal
import sys
import aiomqtt
import nats
from sqlalchemy import delete, insert, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
import ulid

from .config import settings

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("chatapp.router")

# Database Engine
engine = create_async_engine(settings.DATABASE_URL, pool_size=5, max_overflow=10)
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def persist_envelope(session, env_data: dict) -> None:
    """Store unacknowledged incoming envelope in Postgres envelopes table."""
    from sqlalchemy import text

    stmt = text(
        """
        INSERT INTO envelopes (id, version, sender_user, sender_device, recipient_user, recipient_device, type, ciphertext, timestamp, delivered, acked, created_at)
        VALUES (:id, :version, :sender_user, :sender_device, :recipient_user, :recipient_device, :type, :ciphertext, :timestamp, false, false, NOW())
        ON CONFLICT (id) DO NOTHING
        """
    )
    await session.execute(
        stmt,
        {
            "id": env_data["id"],
            "version": env_data.get("version", 1),
            "sender_user": env_data["sender_user"],
            "sender_device": env_data.get("sender_device", 1),
            "recipient_user": env_data["recipient_user"],
            "recipient_device": env_data.get("recipient_device", 1),
            "type": env_data.get("type", 1),
            "ciphertext": env_data.get("ciphertext", ""),
            "timestamp": env_data.get("timestamp", 0),
        },
    )
    await session.commit()


async def mark_delivered_or_delete(session, envelope_id: str, is_read: bool = False) -> None:
    """Update delivery status or delete acknowledged envelope from storage."""
    from sqlalchemy import text

    if is_read:
        stmt = text("DELETE FROM envelopes WHERE id = :id")
        await session.execute(stmt, {"id": envelope_id})
    else:
        stmt = text("UPDATE envelopes SET delivered = true, acked = true WHERE id = :id")
        await session.execute(stmt, {"id": envelope_id})
    await session.commit()


async def run_router():
    logger.info("Initializing chatapp-router service...")

    # Connect to NATS
    nc = None
    try:
        nc = await nats.connect(settings.NATS_URL)
        logger.info("Connected to NATS bus at %s", settings.NATS_URL)
    except Exception as e:
        logger.warning("Could not immediately connect to NATS (%s); running in MQTT-direct mode", e)

    # Reconnect loop for Mosquitto
    while True:
        try:
            logger.info("Connecting to Mosquitto at %s:%d...", settings.MQTT_HOST, settings.MQTT_PORT)
            async with aiomqtt.Client(
                hostname=settings.MQTT_HOST,
                port=settings.MQTT_PORT,
                username=settings.MQTT_USER,
                password=settings.JWT_SECRET_KEY,
                identifier="chatapp_router_worker",
                clean_session=False,
            ) as mqtt_client:
                logger.info("Connected to Mosquitto. Subscribing to out/#...")
                await mqtt_client.subscribe("out/#", qos=1)

                async for message in mqtt_client.messages:
                    topic = message.topic.value
                    payload_bytes = message.payload

                    try:
                        env_data = json.loads(payload_bytes.decode("utf-8"))
                    except Exception as e:
                        logger.warning("Failed to decode JSON envelope on topic %s: %s", topic, e)
                        continue

                    env_id = env_data.get("id") or str(ulid.new())
                    env_data["id"] = env_id
                    env_type = env_data.get("type", 1)
                    sender_user = env_data.get("sender_user", "")
                    sender_device = env_data.get("sender_device", 1)
                    recipient_user = env_data.get("recipient_user", "")
                    recipient_device = env_data.get("recipient_device", 1)

                    # 1. MESSAGE / EDIT / DELETE / REACTION (type 1, 6, 7, 8)
                    if env_type in (1, 6, 7, 8):
                        # Stage in Postgres
                        try:
                            async with async_session() as session:
                                await persist_envelope(session, env_data)
                        except Exception as e:
                            logger.error("Failed to persist envelope %s: %s", env_id, e)

                        # Server Ack back to sender: u/{sender}/{dev}/ack
                        ack_topic = f"u/{sender_user}/{sender_device}/ack"
                        ack_payload = json.dumps({
                            "id": env_id,
                            "status": "server_ack",
                            "timestamp": env_data.get("timestamp"),
                        })
                        await mqtt_client.publish(ack_topic, payload=ack_payload.encode(), qos=1)

                        # Forward to recipient inbox: u/{recipient}/{dev}/inbox
                        inbox_topic = f"u/{recipient_user}/{recipient_device}/inbox"
                        await mqtt_client.publish(inbox_topic, payload=payload_bytes, qos=1)
                        logger.info(
                            "Routed envelope %s (type %d) from %s:%d to %s:%d",
                            env_id,
                            env_type,
                            sender_user,
                            sender_device,
                            recipient_user,
                            recipient_device,
                        )

                        # Publish to NATS for push notification if offline
                        if nc:
                            event_data = {
                                "id": env_id,
                                "sender_user": sender_user,
                                "recipient_user": recipient_user,
                                "recipient_device": recipient_device,
                                "timestamp": env_data.get("timestamp"),
                            }
                            await nc.publish("events.push.notify", json.dumps(event_data).encode())

                    # 2. RECEIPT (type 2)
                    elif env_type == 2:
                        receipt_status = env_data.get("receipt_status", "delivered")
                        original_id = env_data.get("original_envelope_id", "")

                        # Update DB
                        try:
                            async with async_session() as session:
                                await mark_delivered_or_delete(
                                    session,
                                    original_id,
                                    is_read=(receipt_status == "read"),
                                )
                        except Exception as e:
                            logger.error("Failed to update receipt for %s: %s", original_id, e)

                        # Forward receipt to original sender's inbox: u/{recipient_user}/{recipient_device}/inbox
                        # (In receipt envelope, recipient_user is the original message sender)
                        receipt_topic = f"u/{recipient_user}/{recipient_device}/inbox"
                        await mqtt_client.publish(receipt_topic, payload=payload_bytes, qos=1)
                        logger.info("Forwarded receipt %s for message %s to %s", receipt_status, original_id, recipient_user)

                    # 3. TYPING indicator (type 3)
                    elif env_type == 3:
                        typing_topic = f"u/{recipient_user}/{recipient_device}/inbox"
                        await mqtt_client.publish(typing_topic, payload=payload_bytes, qos=0)

        except (aiomqtt.MqttError, Exception) as e:
            logger.warning("MQTT connection lost: %s. Retrying in 3 seconds...", e)
            await asyncio.sleep(3)


def main():
    asyncio.run(run_router())


if __name__ == "__main__":
    main()
