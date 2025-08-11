from __future__ import annotations
from typing import Optional, Literal

from fastapi import Depends, HTTPException, status, Header
from pydantic import BaseModel
import jwt  # PyJWT

from apps.api.app.config import NEXTAUTH_SECRET


class UserPrincipal(BaseModel):
    sub: str
    email: Optional[str] = None
    name: Optional[str] = None
    role: Literal["owner", "admin", "editor", "viewer", "approver"] = "owner"
    orgId: int = 1


def get_current_user(authorization: str | None = Header(default=None)) -> UserPrincipal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, NEXTAUTH_SECRET, algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    return UserPrincipal(
        sub=str(payload.get("sub") or payload.get("email") or "user"),
        email=payload.get("email"),
        name=payload.get("name"),
        role=(payload.get("role") or "owner"),
        orgId=int(payload.get("orgId") or 1),
    )


def require_roles(*allowed: str):
    def _dep(user: UserPrincipal = Depends(get_current_user)) -> UserPrincipal:
        if user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user
    return _dep
