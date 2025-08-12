# apps/api/routes/notifications.py
from __future__ import annotations
from datetime import datetime
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from apps.api.app.db import get_db
from apps.api.app.models import PolicyNotification
from apps.api.app.auth import get_current_user, UserPrincipal, require_roles

router = APIRouter(prefix="/v1/notifications", tags=["notifications"])

class NotificationOut(BaseModel):
    id: int
    type: str
    message: str
    document_id: Optional[int] = None
    version: Optional[int] = None
    approval_id: Optional[int] = None
    created_at: str
    read_at: Optional[str] = None

class MarkReadIn(BaseModel):
    ids: List[int]

@router.get("", response_model=List[NotificationOut], dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
def list_notifications(
    status: Literal["all","unread"] = "unread",
    limit: int = 50,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    q = db.query(PolicyNotification).filter(PolicyNotification.target_email == user.email)
    if status == "unread":
        q = q.filter(PolicyNotification.read_at.is_(None))
    rows = q.order_by(PolicyNotification.created_at.desc()).limit(limit).all()
    return [
        NotificationOut(
            id=r.id,
            type=r.type,
            message=r.message,
            document_id=r.document_id,
            version=r.version,
            approval_id=r.approval_id,
            created_at=r.created_at.isoformat(),
            read_at=r.read_at.isoformat() if r.read_at else None,
        )
        for r in rows
    ]

@router.post("/mark_read", status_code=204, dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
def mark_read(
    payload: MarkReadIn,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    if not payload.ids:
        return
    q = db.query(PolicyNotification).filter(
        PolicyNotification.id.in_(payload.ids),
        PolicyNotification.target_email == user.email,
        PolicyNotification.read_at.is_(None),
    )
    now = datetime.utcnow()
    for row in q.all():
        row.read_at = now
    db.commit()
    return None

@router.post("/mark_all_read", status_code=204, dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
def mark_all_read(
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    q = db.query(PolicyNotification).filter(
        PolicyNotification.target_email == user.email,
        PolicyNotification.read_at.is_(None),
    )
    now = datetime.utcnow()
    for row in q.all():
        row.read_at = now
    db.commit()
    return None
