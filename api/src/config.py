from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "chatapp"
    ENV: Literal["development", "production", "test"] = "development"
    DEBUG: bool = False

    # Database & Cache
    DATABASE_URL: str = "postgresql+asyncpg://chatapp:chatapp_secret@postgres:5435/chatapp"
    REDIS_URL: str = "redis://redis:6380/0"
    NATS_URL: str = "nats://nats:4222"

    # Security & Tokens
    JWT_SECRET_KEY: str = "dev-insecure-secret-key-change-in-production-12345678"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # OTP
    OTP_PROVIDER: Literal["console", "email"] = "console"
    OTP_EXPIRE_SECONDS: int = 300

    # SMTP for email OTP
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "noreply@vajapravin.me"
    SMTP_USE_TLS: bool = False
    SMTP_STARTTLS: bool = True

    # S3 Object Storage (MinIO / AWS S3)
    S3_ENDPOINT: str = ""
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_BUCKET: str = "chatapp-media"
    MEDIA_STORAGE_DIR: str = "./data/media"
    MAX_MEDIA_SIZE_BYTES: int = 2 * 1024 * 1024 * 1024  # 2 GB

    # WebRTC Calling & TURN Providers
    TURN_PROVIDER: Literal["cloudflare", "coturn", "stun_only"] = "stun_only"
    CF_TURN_KEY_ID: str = ""
    CF_TURN_API_TOKEN: str = ""
    COTURN_SHARED_SECRET: str = ""
    COTURN_HOST: str = ""
    COTURN_PORT: int = 3478
    COTURN_TLS_PORT: int = 5349

    # LiveKit SFU Profile
    LIVEKIT_URL: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""

    # CORS
    CORS_ORIGINS: list[str] = [
        "http://localhost:5174",
        "http://localhost:3001",
        "https://chat.vajapravin.me",
    ]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
