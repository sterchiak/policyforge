import os
from typing import List

# Web origin for CORS (Next dev server)
WEB_ORIGIN = os.environ.get("WEB_ORIGIN", "http://localhost:3000")

# Secret must match apps/web/.env.local -> NEXTAUTH_SECRET
NEXTAUTH_SECRET = os.environ.get("NEXTAUTH_SECRET", "dev-super-secret-change-me")

# You can add others if you like
CORS_ORIGINS: List[str] = [WEB_ORIGIN]
