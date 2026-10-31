from abc import ABC, abstractmethod


class BaseOtpProvider(ABC):
    """Abstract interface for OTP delivery providers."""

    @abstractmethod
    async def send_otp(self, destination: str, code: str) -> bool:
        """Send a 6-digit OTP code to the destination (phone or email).
        
        Args:
            destination: Target phone number or email address.
            code: 6-digit numeric verification code.
            
        Returns:
            True if delivered/dispatched successfully, False otherwise.
        """
        raise NotImplementedError
