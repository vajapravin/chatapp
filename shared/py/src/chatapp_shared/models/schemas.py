from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class OtpRequest(BaseModel):
    phone_number: str | None = Field(default=None, description="E.164 phone number, e.g. +1234567890")
    email: str | None = Field(default=None, description="Optional email for notification/backup")


class OtpVerifyRequest(BaseModel):
    phone_number: str | None = Field(default=None, description="E.164 phone number or identifier")
    email: str | None = Field(default=None, description="Optional email address")
    code: str = Field(..., min_length=6, max_length=6, description="6-digit verification code")
    device_name: str | None = Field(default="Web Browser", description="Descriptive device name")


class TokenResponse(BaseModel):
    access_token: str = ""
    refresh_token: str = ""
    token_type: str = "Bearer"
    expires_in: int = 900  # 15 minutes in seconds
    user_id: str
    device_id: int
    two_step_required: bool = False
    temp_token: str | None = None


class TokenRefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: str
    phone_number: str | None = None
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    role: str = "user"
    status: str = "active"
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MqttAuthRequest(BaseModel):
    username: str
    password: str
    clientid: str


class MqttAclRequest(BaseModel):
    username: str
    topic: str
    acc: int  # 1: read/subscribe, 2: write/publish
    clientid: str


class HealthResponse(BaseModel):
    status: str
    details: dict[str, Any] = Field(default_factory=dict)


class SignedPrekeyUpload(BaseModel):
    key_id: int
    public_key: str  # Base64
    signature: str  # Base64


class OneTimePrekeyUpload(BaseModel):
    key_id: int
    public_key: str  # Base64


class KeyInitRequest(BaseModel):
    identity_key: str  # Base64
    signed_prekey: SignedPrekeyUpload
    one_time_prekeys: list[OneTimePrekeyUpload] = Field(default_factory=list)


class PrekeyReplenishRequest(BaseModel):
    one_time_prekeys: list[OneTimePrekeyUpload]


class DevicePrekeyBundle(BaseModel):
    device_id: int
    identity_key: str
    signed_prekey: SignedPrekeyUpload
    one_time_prekey: OneTimePrekeyUpload | None = None


class UserPrekeyBundleResponse(BaseModel):
    user_id: str
    devices: list[DevicePrekeyBundle]


class KeyStatusResponse(BaseModel):
    identity_key_set: bool
    signed_prekey_id: int | None = None
    available_one_time_prekeys: int


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str
