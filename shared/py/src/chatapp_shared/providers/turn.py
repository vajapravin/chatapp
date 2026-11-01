import asyncio
import base64
from abc import ABC, abstractmethod
import hashlib
import hmac
import json
import logging
import time
from typing import Any
import urllib.request
import urllib.error

logger = logging.getLogger("chatapp.turn")


class BaseTurnProvider(ABC):
    """Abstract interface for WebRTC ICE server and TURN credential generation."""

    @abstractmethod
    async def get_ice_servers(self, user_id: str, ttl_seconds: int = 86400) -> list[dict[str, Any]]:
        """Return a list of RTCIceServer dictionaries compatible with RTCPeerConnection."""
        raise NotImplementedError


class StunOnlyTurnProvider(BaseTurnProvider):
    """Zero-configuration STUN-only provider using public Google and Cloudflare STUN servers.
    
    Guarantees out-of-the-box local development, testing, and direct P2P connectivity.
    """

    def __init__(self, stun_urls: list[str] | None = None):
        self.stun_urls = stun_urls or [
            "stun:stun.cloudflare.com:3478",
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302",
        ]

    async def get_ice_servers(self, user_id: str, ttl_seconds: int = 86400) -> list[dict[str, Any]]:
        return [
            {
                "urls": self.stun_urls,
            }
        ]


class CloudflareTurnProvider(BaseTurnProvider):
    """Cloudflare Realtime TURN (Cloudflare Calls) ephemeral credential generator.
    
    Calls Cloudflare's TURN credential generation REST API.
    """

    def __init__(self, key_id: str, api_token: str):
        self.key_id = key_id
        self.api_token = api_token
        self.api_url = f"https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate"

    async def get_ice_servers(self, user_id: str, ttl_seconds: int = 86400) -> list[dict[str, Any]]:
        if not self.key_id or not self.api_token:
            logger.warning("Cloudflare TURN requested but CF_TURN_KEY_ID or CF_TURN_API_TOKEN is missing. Falling back to public STUN.")
            return await StunOnlyTurnProvider().get_ice_servers(user_id, ttl_seconds)

        def _fetch_cf_turn() -> list[dict[str, Any]]:
            req = urllib.request.Request(
                self.api_url,
                data=json.dumps({"ttl": ttl_seconds}).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {self.api_token}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    ice_servers = data.get("iceServers", {})
                    if isinstance(ice_servers, list):
                        return ice_servers
                    return [ice_servers]
            return []

        try:
            res = await asyncio.to_thread(_fetch_cf_turn)
            if res:
                return res
        except Exception as e:
            logger.error("Error generating Cloudflare TURN credentials: %s", e)

        # Fallback to STUN if network or credentials fail
        return await StunOnlyTurnProvider().get_ice_servers(user_id, ttl_seconds)


class CoturnTurnProvider(BaseTurnProvider):
    """Coturn HMAC-SHA1 REST API shared-secret credential generator.
    
    Generates time-limited credentials without external API calls when self-hosting Coturn.
    """

    def __init__(
        self,
        shared_secret: str,
        host: str,
        port: int = 3478,
        tls_port: int = 5349,
    ):
        self.shared_secret = shared_secret
        self.host = host
        self.port = port
        self.tls_port = tls_port

    async def get_ice_servers(self, user_id: str, ttl_seconds: int = 86400) -> list[dict[str, Any]]:
        if not self.shared_secret or not self.host:
            logger.warning("Coturn requested but COTURN_SHARED_SECRET or COTURN_HOST is missing. Falling back to public STUN.")
            return await StunOnlyTurnProvider().get_ice_servers(user_id, ttl_seconds)

        expiry_timestamp = int(time.time()) + ttl_seconds
        username = f"{expiry_timestamp}:{user_id}"

        # Compute HMAC-SHA1 of username with shared_secret
        digest = hmac.new(
            self.shared_secret.encode("utf-8"),
            username.encode("utf-8"),
            hashlib.sha1,
        ).digest()
        credential = base64.b64encode(digest).decode("utf-8")

        return [
            {
                "urls": [
                    f"stun:{self.host}:{self.port}",
                    "stun:stun.cloudflare.com:3478",
                ],
            },
            {
                "urls": [
                    f"turn:{self.host}:{self.port}?transport=udp",
                    f"turn:{self.host}:{self.port}?transport=tcp",
                    f"turns:{self.host}:{self.tls_port}?transport=tcp",
                ],
                "username": username,
                "credential": credential,
            },
        ]


def get_turn_provider(
    provider_type: str = "stun_only",
    cf_key_id: str = "",
    cf_api_token: str = "",
    coturn_shared_secret: str = "",
    coturn_host: str = "",
    coturn_port: int = 3478,
) -> BaseTurnProvider:
    """Factory creating the configured BaseTurnProvider."""
    normalized = (provider_type or "stun_only").lower().strip()
    if normalized == "cloudflare":
        return CloudflareTurnProvider(key_id=cf_key_id, api_token=cf_api_token)
    elif normalized == "coturn":
        return CoturnTurnProvider(
            shared_secret=coturn_shared_secret,
            host=coturn_host,
            port=coturn_port,
        )
    return StunOnlyTurnProvider()
