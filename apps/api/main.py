from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apps.api.routes.health import router as health_router  # <-- updated path

app = FastAPI(title="PolicyForge API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/health")