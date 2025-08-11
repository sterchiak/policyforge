# apps/api/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.routes.health import router as health_router
from apps.api.routes.policies import router as policies_router
from apps.api.routes.documents import router as documents_router

from apps.api.app.db import engine
from apps.api.app.models import Base

app = FastAPI(title="PolicyForge API")

# Ensure tables exist even if startup events don’t fire for some reason
Base.metadata.create_all(bind=engine)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

@app.on_event("startup")
def _create_tables_on_startup():
    Base.metadata.create_all(bind=engine)

app.include_router(health_router, prefix="/health")
app.include_router(policies_router)
app.include_router(documents_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("apps.api.main:app", host="127.0.0.1", port=8000)
