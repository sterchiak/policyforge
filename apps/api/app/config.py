import os
from typing import List

# Web origin for CORS (Next dev server)
WEB_ORIGIN = os.environ.get("WEB_ORIGIN", "http://localhost:3000")

# Secret must match apps/web/.env.local -> NEXTAUTH_SECRET
NEXTAUTH_SECRET = os.environ.get("NEXTAUTH_SECRET", "dev-super-secret-change-me")

# You can add others if you like
CORS_ORIGINS: List[str] = [WEB_ORIGIN]

EMAIL_ENABLED: bool = os.getenv("EMAIL_ENABLED", "false").lower() == "true"
SMTP_HOST: str | None = os.getenv("SMTP_HOST")
SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER: str | None = os.getenv("SMTP_USER")
SMTP_PASSWORD: str | None = os.getenv("SMTP_PASSWORD")
SMTP_FROM: str = os.getenv("SMTP_FROM", "no-reply@policyforge.local")
SMTP_STARTTLS: bool = os.getenv("SMTP_STARTTLS", "true").lower() == "true"
