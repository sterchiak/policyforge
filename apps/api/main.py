# apps/api/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.app.db import engine
from apps.api.app.models import Base
from apps.api.app.config import CORS_ORIGINS  # env-driven, e.g. WEB_ORIGIN

# Routers
from apps.api.routes.health import router as health_router
from apps.api.routes.policies import router as policies_router
from apps.api.routes.documents import router as documents_router
from apps.api.routes.notifications import router as notifications_router  # new

# Build the final allowlist (env + common localhosts), de-duped
_default_dev_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
allowlist = list(dict.fromkeys([*CORS_ORIGINS, *_default_dev_origins]))

# Create the FastAPI app first
app = FastAPI(title="PolicyForge API")

# Ensure tables exist even if startup hooks don’t fire (safe / idempotent)
Base.metadata.create_all(bind=engine)

# CORS for Next.js dev and configured origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowlist,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Needed so browser can read filename from downloads
    expose_headers=["Content-Disposition"],
)

@app.on_event("startup")
def _create_tables_on_startup():
    # Safe to call again; no-op if already created
    Base.metadata.create_all(bind=engine)

# Routers
# Health router likely defines @router.get("") so we keep the prefix to expose GET /health
app.include_router(health_router, prefix="/health")
app.include_router(policies_router)
app.include_router(documents_router)
app.include_router(notifications_router)  # adds /v1/notifications/*

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("apps.api.main:app", host="127.0.0.1", port=8000, reload=False)
