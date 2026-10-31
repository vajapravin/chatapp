import { useAuthStore } from "../store/authStore";

const API_BASE = "";

export async function requestOtp(phoneNumber: string, email?: string) {
  const res = await fetch(`${API_BASE}/v1/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone_number: phoneNumber, email: email || null }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Failed to request OTP" }));
    throw new Error(error.detail || "Failed to request OTP");
  }

  return res.json();
}

export async function verifyOtp(phoneNumber: string, code: string, deviceName = "Web Browser") {
  const res = await fetch(`${API_BASE}/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone_number: phoneNumber,
      code,
      device_name: deviceName,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Verification failed" }));
    throw new Error(error.detail || "Verification failed");
  }

  return res.json();
}

export async function fetchCurrentUser() {
  const token = useAuthStore.getState().accessToken;
  if (!token) return null;

  const res = await fetch(`${API_BASE}/v1/users/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      useAuthStore.getState().logout();
    }
    return null;
  }

  return res.json();
}
