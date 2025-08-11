# apps/api/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.routes.health import router as health_router
from apps.api.routes.policies import router as policies_router

# 1) create the app FIRST
app = FastAPI(title="PolicyForge API")

# 2) then add middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],  # for download filename
)

# 3) then include routers
app.include_router(health_router, prefix="/health")
app.include_router(policies_router)

# (optional) run directly: python apps/api/main.py
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("apps.api.main:app", host="127.0.0.1", port=8000, reload=True)
