import logging
from email.message import EmailMessage

import aiosmtplib

from .base import BaseOtpProvider

logger = logging.getLogger("chatapp.otp.email")


class EmailOtpProvider(BaseOtpProvider):
    """SMTP-based OTP provider for sending verification codes via email."""

    def __init__(
        self,
        smtp_host: str = "smtp.gmail.com",
        smtp_port: int = 587,
        smtp_user: str = "",
        smtp_password: str = "",
        smtp_from: str = "noreply@vajapravin.me",
        use_tls: bool = False,
        starttls: bool = True,
    ):
        self.smtp_host = smtp_host
        self.smtp_port = smtp_port
        self.smtp_user = smtp_user
        self.smtp_password = smtp_password
        self.smtp_from = smtp_from or smtp_user
        self.use_tls = use_tls
        self.starttls = starttls

    async def send_otp(self, destination: str, code: str) -> bool:
        if "@" not in destination:
            logger.warning("Destination '%s' is not an email address", destination)
            return False

        message = EmailMessage()
        message["From"] = self.smtp_from
        message["To"] = destination
        message["Subject"] = f"Your Verification Code: {code}"
        body = (
            f"Hello,\n\nYour chatapp verification code is: {code}\n\n"
            "This code will expire in 5 minutes. If you did not request it, ignore this email.\n"
        )
        message.set_content(body)

        try:
            await aiosmtplib.send(
                message,
                hostname=self.smtp_host,
                port=self.smtp_port,
                username=self.smtp_user if self.smtp_user else None,
                password=self.smtp_password if self.smtp_password else None,
                use_tls=self.use_tls,
                start_tls=self.starttls,
            )
            logger.info("Successfully dispatched OTP email to %s", destination)
            return True
        except Exception as e:
            logger.error("Failed to send OTP email via SMTP to %s: %s", destination, e)
            return False
