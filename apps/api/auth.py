from __future__ import annotations

from typing import Optional, Literal

from fastapi import Depends, Header, HTTPException, status
from pydantic import BaseModel
import jwt  # PyJWT
from jwt import InvalidTokenError

from apps.api.app.config import NEXTAUTH_SECRET


class UserPrincipal(BaseModel):
    sub: str
    email: Optional[str] = None
    name: Optional[str] = None
    # keep roles simple for MVP
    role: Literal["owner", "admin", "editor", "viewer", "approver"] = "owner"
    orgId: int = 1


def _decode_nextauth_token(token: str) -> dict:
    """
    Accept HS256/384/512 (NextAuth often uses HS512; our web re-signs HS256).
    """
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")
        if alg not in ("HS256", "HS384", "HS512"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unsupported JWT algorithm",
            )
        return jwt.decode(token, NEXTAUTH_SECRET, algorithms=[alg])
    except InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def get_current_user(authorization: str | None = Header(default=None)) -> UserPrincipal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    payload = _decode_nextauth_token(token)
    return UserPrincipal(
        sub=str(payload.get("sub") or payload.get("email") or "user"),
        email=payload.get("email"),
        name=payload.get("name"),
        role=(payload.get("role") or "owner"),
        orgId=int(payload.get("orgId") or 1),
    )


def require_roles(*allowed: str):
    """
    Usage on write endpoints:
      dependencies=[Depends(require_roles("owner","admin","editor"))]
    """
    def _dep(user: UserPrincipal = Depends(get_current_user)) -> UserPrincipal:
        if user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user
    return _dep
