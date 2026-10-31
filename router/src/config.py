from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "chatapp-router"
    DEBUG: bool = False

    # MQTT Broker
    MQTT_HOST: str = "mosquitto"
    MQTT_PORT: int = 1883
    MQTT_USER: str = "router"
    JWT_SECRET_KEY: str = "dev-insecure-secret-key-change-in-production-12345678"

    # NATS JetStream
    NATS_URL: str = "nats://nats:4222"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://chatapp:chatapp_secret@postgres:5435/chatapp"

    # Redis for presence checks
    REDIS_URL: str = "redis://redis:6380/0"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
