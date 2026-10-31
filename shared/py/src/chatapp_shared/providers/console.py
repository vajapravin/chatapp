import logging

from .base import BaseOtpProvider

logger = logging.getLogger("chatapp.otp.console")


class ConsoleOtpProvider(BaseOtpProvider):
    """Dev OTP provider that logs the OTP code to standard output/logs."""

    async def send_otp(self, destination: str, code: str) -> bool:
        sep = "=" * 40
        msg = f"{sep}\n[CONSOLE OTP] Target: {destination} | Code: {code}\n{sep}"
        print(msg, flush=True)
        logger.info("[CONSOLE OTP] Target: %s | Code: %s", destination, code)
        return True
