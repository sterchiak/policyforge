# apps/api/routes/users.py
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy.orm import Session

from apps.api.app.db import get_db
from apps.api.app.models import PolicyUser
from apps.api.app.auth import require_roles, get_current_user, UserPrincipal

router = APIRouter(prefix="/v1/users", tags=["users"])

class UserIn(BaseModel):
    email: EmailStr
    name: str | None = None
    role: str = "viewer"  # owner|admin|editor|viewer|approver

    @field_validator("email", mode="before")
    @classmethod
    def _strip_email(cls, v):
        return v.strip() if isinstance(v, str) else v

class UserOut(BaseModel):
    id: int
    email: str
    name: str | None
    role: str
    created_at: str

@router.get(
    "",
    response_model=list[UserOut],
    dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))],
)
def list_users(
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    rows = db.query(PolicyUser).order_by(PolicyUser.email.asc()).all()
    return [
        UserOut(
            id=r.id, email=r.email, name=r.name, role=r.role,
            created_at=r.created_at.isoformat()
        ) for r in rows
    ]

@router.post(
    "",
    response_model=UserOut,
    status_code=201,
    dependencies=[Depends(require_roles("owner","admin"))],  # tighten after testing if needed
)
def create_user(
    payload: UserIn,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    email = payload.email.strip().lower()
    exists = db.query(PolicyUser).filter(PolicyUser.email == email).first()
    if exists:
        raise HTTPException(status_code=400, detail="Email already exists")
    u = PolicyUser(email=email, name=(payload.name or None), role=payload.role)
    db.add(u); db.commit(); db.refresh(u)
    return UserOut(
        id=u.id, email=u.email, name=u.name, role=u.role,
        created_at=u.created_at.isoformat()
    )

@router.patch(
    "/{user_id}",
    response_model=UserOut,
    dependencies=[Depends(require_roles("owner","admin"))],
)
def update_user(
    user_id: int,
    payload: UserIn,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    u = db.get(PolicyUser, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.email = payload.email.strip().lower()
    u.name = payload.name or None
    u.role = payload.role
    db.commit(); db.refresh(u)
    return UserOut(
        id=u.id, email=u.email, name=u.name, role=u.role,
        created_at=u.created_at.isoformat()
    )

@router.delete(
    "/{user_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner","admin"))],
)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    u = db.get(PolicyUser, user_id)
    if not u:
        return None
    db.delete(u); db.commit()
    return None
