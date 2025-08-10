# re-export routers here so main.py can import one symbol cleanly
from .health import router as health_router

__all__ = ["health_router"]