import json
import time
import paho.mqtt.client as mqtt
import pytest
from chatapp_shared.auth import create_access_token
from src.config import settings
import ulid


def test_router_end_to_end_messaging_and_receipts():
    """Verify that router receives message from sender, acks it, delivers to recipient, and routes receipts."""
    alice_id = "01M69QANEHVCK3J86SEVE88DPC"  # Demo user Alice
    bob_id = "01M69QANEK9HAKJ23BQAVE27YJ"    # Demo user Bob

    alice_token = create_access_token(user_id=alice_id, device_id=1, secret_key=settings.JWT_SECRET_KEY)
    bob_token = create_access_token(user_id=bob_id, device_id=1, secret_key=settings.JWT_SECRET_KEY)

    alice_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="test_alice_cli")
    alice_client.username_pw_set(username=alice_id, password=alice_token)

    bob_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="test_bob_cli")
    bob_client.username_pw_set(username=bob_id, password=bob_token)

    alice_server_acked = False
    alice_delivered_receipt = False
    bob_received_message = None

    def on_alice_msg(c, userdata, msg):
        nonlocal alice_server_acked, alice_delivered_receipt
        topic = msg.topic
        payload = json.loads(msg.payload.decode())
        if topic == f"u/{alice_id}/1/ack":
            if payload.get("status") == "server_ack":
                alice_server_acked = True
        elif topic == f"u/{alice_id}/1/inbox":
            if payload.get("type") == 2 and payload.get("receipt_status") == "delivered":
                alice_delivered_receipt = True

    def on_bob_msg(c, userdata, msg):
        nonlocal bob_received_message
        topic = msg.topic
        if topic == f"u/{bob_id}/1/inbox":
            bob_received_message = json.loads(msg.payload.decode())

    alice_client.on_message = on_alice_msg
    bob_client.on_message = on_bob_msg

    alice_client.connect("localhost", 1883, keepalive=10)
    bob_client.connect("localhost", 1883, keepalive=10)

    alice_client.loop_start()
    bob_client.loop_start()

    time.sleep(1)

    # Subscriptions
    alice_client.subscribe(f"u/{alice_id}/1/#", qos=1)
    bob_client.subscribe(f"u/{bob_id}/1/inbox", qos=1)
    time.sleep(1)

    # Alice publishes message to Bob
    message_id = str(ulid.new())
    envelope = {
        "id": message_id,
        "version": 1,
        "sender_user": alice_id,
        "sender_device": 1,
        "recipient_user": bob_id,
        "recipient_device": 1,
        "type": 1,  # MESSAGE
        "ciphertext": "encrypted_ciphertext_sample_base64",
        "timestamp": int(time.time() * 1000),
    }

    pub = alice_client.publish(f"out/{alice_id}/1", payload=json.dumps(envelope), qos=1)
    pub.wait_for_publish(timeout=3)

    time.sleep(1.5)

    assert alice_server_acked, "Alice did not receive server ack"
    assert bob_received_message is not None, "Bob did not receive routed message"
    assert bob_received_message["id"] == message_id
    assert bob_received_message["ciphertext"] == "encrypted_ciphertext_sample_base64"

    # Bob publishes receipt back to Alice
    receipt_envelope = {
        "id": str(ulid.new()),
        "version": 1,
        "sender_user": bob_id,
        "sender_device": 1,
        "recipient_user": alice_id,
        "recipient_device": 1,
        "type": 2,  # RECEIPT
        "receipt_status": "delivered",
        "original_envelope_id": message_id,
        "timestamp": int(time.time() * 1000),
    }

    pub_receipt = bob_client.publish(f"out/{bob_id}/1", payload=json.dumps(receipt_envelope), qos=1)
    pub_receipt.wait_for_publish(timeout=3)

    time.sleep(1.5)

    assert alice_delivered_receipt, "Alice did not receive delivered receipt"

    alice_client.loop_stop()
    bob_client.loop_stop()
    alice_client.disconnect()
    bob_client.disconnect()
