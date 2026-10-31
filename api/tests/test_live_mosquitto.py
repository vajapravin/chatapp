import time

import paho.mqtt.client as mqtt
from chatapp_shared.auth import create_access_token

from src.config import settings


def test_live_mosquitto_anonymous_rejected():
    """Verify that unauthenticated connections are rejected."""
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="anon_tester")
    conn_result = None

    def on_connect(c, userdata, flags, rc, properties=None):
        nonlocal conn_result
        conn_result = rc

    client.on_connect = on_connect

    try:
        client.connect("localhost", 1883, keepalive=5)
        client.loop_start()
        time.sleep(1)
        client.loop_stop()
    except Exception as e:
        conn_result = e

    # In MQTT v5 or v3.1.1, connection without credentials is refused (rc=4 or rc=5 or error)
    assert conn_result is not None
    # rc for not authorized or bad user/password is non-zero
    if hasattr(conn_result, "is_failure"):
        assert conn_result.is_failure
    elif isinstance(conn_result, int):
        assert conn_result != 0


def test_live_mosquitto_jwt_auth_and_acl():
    """Verify that valid JWT allows connection and enforces topic ACL."""
    user_id = "01M69QD5PHFCXFWFZ0K9JS0STV"
    valid_token = create_access_token(
        user_id=user_id,
        device_id=1,
        secret_key=settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="tester_client_1")
    client.username_pw_set(username=user_id, password=valid_token)

    connected = False
    subscribed = False

    def on_connect(c, userdata, flags, rc, properties=None):
        nonlocal connected
        if not rc.is_failure:
            connected = True

    def on_subscribe(c, userdata, mid, reason_codes, properties=None):
        nonlocal subscribed
        if reason_codes and not reason_codes[0].is_failure:
            subscribed = True

    client.on_connect = on_connect
    client.on_subscribe = on_subscribe

    client.connect("localhost", 1883, keepalive=10)
    client.loop_start()
    time.sleep(1.5)

    assert connected, "Failed to connect to Mosquitto with valid JWT token"

    # Subscribe to authorized mailbox
    client.subscribe(f"u/{user_id}/1/inbox", qos=1)
    time.sleep(1.5)
    assert subscribed, "Failed to subscribe to authorized mailbox topic"

    # Publish to authorized outbox topic
    pub_info = client.publish(f"out/{user_id}/1", payload=b"test-payload", qos=1)
    pub_info.wait_for_publish(timeout=3)
    assert pub_info.is_published()

    # Attempt to subscribe to unauthorized topic (another user's inbox)
    unauthorized_subscribed = False

    def on_unauth_subscribe(c, userdata, mid, reason_codes, properties=None):
        nonlocal unauthorized_subscribed
        # In MQTT v5 / mosquitto-go-auth, unauthorized subscription returns failure code (>= 128)
        if reason_codes and not reason_codes[0].is_failure:
            unauthorized_subscribed = True

    client.on_subscribe = on_unauth_subscribe
    client.subscribe("u/unauthorized_user/1/inbox", qos=1)
    time.sleep(1.5)
    assert not unauthorized_subscribed, "Should not be able to subscribe to another user's inbox"

    client.loop_stop()
    client.disconnect()
