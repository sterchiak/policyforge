# apps/api/routes/documents.py
from __future__ import annotations

from datetime import datetime
import json
from typing import List, Optional, Literal, Dict

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from apps.api.app.db import get_db
from apps.api.app.models import (
    PolicyDocument,
    PolicyVersion,
    PolicyComment,
    PolicyApproval,
)
from apps.api.routes.policies import DraftRequest, render_html, TEMPLATES
from apps.api.app.auth import get_current_user, require_roles, UserPrincipal

# Email helper (no-op if EMAIL_ENABLED=false)
from apps.api.app.email import send_email
from apps.api.app.models import PolicyNotification

from apps.api.app.models import PolicyUser, PolicyDocumentOwner

router = APIRouter(prefix="/v1/documents", tags=["documents"])


# -----------------------
# Pydantic response models
# -----------------------
class DocumentOut(BaseModel):
    id: int
    title: str
    template_key: str
    status: str
    created_at: str
    updated_at: str
    latest_version: int


class VersionOut(BaseModel):
    id: int
    version: int
    created_at: str


class DocumentDetailOut(DocumentOut):
    versions: List[VersionOut]


class VersionDetailOut(BaseModel):
    id: int
    version: int
    created_at: str
    html: str
    params: DraftRequest


class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[Literal["draft", "in_review", "approved", "published", "rejected"]] = None


# Comments I/O
class CommentIn(BaseModel):
    body: str
    author: str = "User"
    version: Optional[int] = None


class CommentOut(BaseModel):
    id: int
    document_id: int
    version: Optional[int]
    author: str
    body: str
    created_at: str


# Approvals I/O
class NotifyPayload(BaseModel):
    to: List[EmailStr] = []
    cc: Optional[List[EmailStr]] = None
    bcc: Optional[List[EmailStr]] = None


class ApprovalIn(BaseModel):
    reviewer: str
    version: Optional[int] = None
    note: Optional[str] = None
    # NEW: optional email notification
    notify: Optional[NotifyPayload] = None


class ApprovalOut(BaseModel):
    id: int
    document_id: int
    version: Optional[int]
    reviewer: str
    status: Literal["pending", "approved", "rejected"]
    note: Optional[str]
    requested_at: str
    decided_at: Optional[str]


class ApprovalUpdate(BaseModel):
    status: Literal["approved", "rejected"]
    note: Optional[str] = None
    reviewer: Optional[str] = None  # allow updating display name/email
    # NEW: optional email notification to inform stakeholders of the decision
    notify: Optional[NotifyPayload] = None

class DocOwnerIn(BaseModel):
    email: EmailStr
    role: str = "owner"  # owner|editor|viewer|approver

class DocOwnerOut(BaseModel):
    id: int
    user_id: int
    email: str
    name: str | None
    role: str

# -----------------------
# Helpers
# -----------------------
def _latest_version(db: Session, doc_id: int) -> int:
    v = (
        db.query(PolicyVersion)
        .filter(PolicyVersion.document_id == doc_id)
        .order_by(PolicyVersion.version.desc())
        .first()
    )
    return v.version if v else 0


def _doc_to_out(db: Session, d: PolicyDocument) -> DocumentOut:
    return DocumentOut(
        id=d.id,
        title=d.title,
        template_key=d.template_key,
        status=d.status,
        created_at=d.created_at.isoformat(),
        updated_at=d.updated_at.isoformat(),
        latest_version=_latest_version(db, d.id),
    )

def _notify_user(
    db: Session,
    target_email: str,
    ntype: str,
    message: str,
    document_id: int | None = None,
    version: int | None = None,
    approval_id: int | None = None,
) -> None:
    if not target_email:
        return
    n = PolicyNotification(
        target_email=target_email.strip().lower(),
        type=ntype,
        message=message.strip(),
        document_id=document_id,
        version=version,
        approval_id=approval_id,
    )
    db.add(n)

def _get_or_create_user_by_email(db: Session, email: str) -> PolicyUser:
    e = email.strip().lower()
    u = db.query(PolicyUser).filter(PolicyUser.email == e).first()
    if u: return u
    u = PolicyUser(email=e, role="viewer")
    db.add(u); db.flush()
    return u

def _owner_emails(db: Session, doc_id: int, roles: tuple[str,...] = ("owner","approver")) -> list[str]:
    rows = (
        db.query(PolicyUser.email)
        .join(PolicyDocumentOwner, PolicyDocumentOwner.user_id == PolicyUser.id)
        .filter(PolicyDocumentOwner.document_id == doc_id, PolicyDocumentOwner.role.in_(roles))
        .all()
    )
    return [r[0].strip().lower() for r in rows]

def _get_or_create_user_by_email(db: Session, email: str) -> PolicyUser:
    e = (email or "").strip().lower()
    u = db.query(PolicyUser).filter(PolicyUser.email == e).first()
    if u:
        return u
    u = PolicyUser(email=e, role="viewer")
    db.add(u)
    db.flush()  # assigns u.id
    return u
# -----------------------
# Document & Version routes
# -----------------------
@router.post(
    "",
    response_model=DocumentOut,
    dependencies=[Depends(require_roles("owner", "admin", "editor"))],
)
def create_document(
    req: DraftRequest,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    # (Optional) org scoping:
    # org_id = user.orgId

    if req.template_key not in {t.key for t in TEMPLATES}:
        raise HTTPException(status_code=400, detail="Unknown template_key")

    html = render_html(req)
    title = next(
        (t.title for t in TEMPLATES if t.key == req.template_key),
        req.template_key.replace("_", " ").title(),
    )

    doc = PolicyDocument(
        template_key=req.template_key,
        title=title,
        status="draft",
        # org_id=org_id,
    )
    db.add(doc)
    db.flush()  # assigns doc.id

    ver = PolicyVersion(
        document_id=doc.id,
        version=1,
        html=html,
        params_json=json.dumps(req.model_dump()),
    )
    db.add(ver)
    
    if user and getattr(user, "email", None):
        creator = _get_or_create_user_by_email(db, user.email)
        exists = (
            db.query(PolicyDocumentOwner)
            .filter(
                PolicyDocumentOwner.document_id == doc.id,
                PolicyDocumentOwner.user_id == creator.id,
            )
            .first()
        )
        if not exists:
            db.add(PolicyDocumentOwner(document_id=doc.id, user_id=creator.id, role="owner"))

    doc.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(doc)

    return _doc_to_out(db, doc)


@router.get("", response_model=List[DocumentOut])
def list_documents(limit: int = 50, db: Session = Depends(get_db)):
    docs = (
        db.query(PolicyDocument)
        .order_by(PolicyDocument.updated_at.desc())
        .limit(limit)
        .all()
    )
    return [_doc_to_out(db, d) for d in docs]


@router.get("/{doc_id}", response_model=DocumentDetailOut)
def get_document(doc_id: int, db: Session = Depends(get_db)):
    d = db.get(PolicyDocument, doc_id)
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")

    versions = (
        db.query(PolicyVersion)
        .filter(PolicyVersion.document_id == doc_id)
        .order_by(PolicyVersion.version.asc())
        .all()
    )

    return DocumentDetailOut(
        **_doc_to_out(db, d).model_dump(),
        versions=[
            VersionOut(
                id=v.id, version=v.version, created_at=v.created_at.isoformat()
            )
            for v in versions
        ],
    )


@router.get("/{doc_id}/versions", response_model=List[VersionOut])
def list_versions(doc_id: int, db: Session = Depends(get_db)):
    vs = (
        db.query(PolicyVersion)
        .filter(PolicyVersion.document_id == doc_id)
        .order_by(PolicyVersion.version.asc())
        .all()
    )
    return [
        VersionOut(id=v.id, version=v.version, created_at=v.created_at.isoformat())
        for v in vs
    ]


@router.get("/{doc_id}/versions/latest", response_model=VersionDetailOut)
def get_latest_version(doc_id: int, db: Session = Depends(get_db)):
    v = (
        db.query(PolicyVersion)
        .filter(PolicyVersion.document_id == doc_id)
        .order_by(PolicyVersion.version.desc())
        .first()
    )
    if not v:
        raise HTTPException(status_code=404, detail="No versions found")

    try:
        payload = json.loads(v.params_json)
        params = DraftRequest.model_validate(payload)
    except Exception:
        params = DraftRequest(
            template_key="access_control_policy",
            org_name="Unknown",
            password_min_length=14,
            mfa_required_roles=["Admin"],
            log_retention_days=90,
        )

    return VersionDetailOut(
        id=v.id,
        version=v.version,
        created_at=v.created_at.isoformat(),
        html=v.html,
        params=params,
    )


@router.get("/{doc_id}/versions/{version}", response_model=VersionDetailOut)
def get_version(doc_id: int, version: int, db: Session = Depends(get_db)):
    v = (
        db.query(PolicyVersion)
        .filter(PolicyVersion.document_id == doc_id, PolicyVersion.version == version)
        .first()
    )
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")

    try:
        payload = json.loads(v.params_json)
        params = DraftRequest.model_validate(payload)
    except Exception:
        params = DraftRequest(
            template_key="access_control_policy",
            org_name="Unknown",
            password_min_length=14,
            mfa_required_roles=["Admin"],
            log_retention_days=90,
        )

    return VersionDetailOut(
        id=v.id,
        version=v.version,
        created_at=v.created_at.isoformat(),
        html=v.html,
        params=params,
    )


@router.post(
    "/{doc_id}/versions",
    response_model=VersionOut,
    dependencies=[Depends(require_roles("owner", "admin", "editor"))],
)
def create_version(
    doc_id: int,
    req: DraftRequest,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    d = db.get(PolicyDocument, doc_id)
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    # Optional org check:
    # if d.org_id and d.org_id != user.orgId:
    #     raise HTTPException(status_code=403, detail="Document belongs to another org")

    if req.template_key != d.template_key:
        raise HTTPException(
            status_code=400,
            detail="template_key must match the document's template",
        )

    latest = _latest_version(db, doc_id)
    html = render_html(req)

    v = PolicyVersion(
        document_id=doc_id,
        version=latest + 1,
        html=html,
        params_json=json.dumps(req.model_dump()),
    )
    db.add(v)
    d.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(v)

    return VersionOut(
        id=v.id, version=v.version, created_at=v.created_at.isoformat()
    )


@router.post(
    "/{doc_id}/versions/{version}/rollback",
    response_model=VersionOut,
    dependencies=[Depends(require_roles("owner", "admin", "editor"))],
)
def rollback_to_version(
    doc_id: int,
    version: int,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    base = (
        db.query(PolicyVersion)
        .filter(PolicyVersion.document_id == doc_id, PolicyVersion.version == version)
        .first()
    )
    if not base:
        raise HTTPException(status_code=404, detail="Version not found")

    d = db.get(PolicyDocument, doc_id)
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")

    try:
        payload = json.loads(base.params_json)
        params = DraftRequest.model_validate(payload)
    except Exception:
        raise HTTPException(status_code=400, detail="Stored params are invalid")

    latest = _latest_version(db, doc_id)
    html = render_html(params)

    v = PolicyVersion(
        document_id=doc_id,
        version=latest + 1,
        html=html,
        params_json=base.params_json,
    )
    db.add(v)
    d.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(v)

    return VersionOut(id=v.id, version=v.version, created_at=v.created_at.isoformat())


@router.patch(
    "/{doc_id}",
    response_model=DocumentOut,
    dependencies=[Depends(require_roles("owner", "admin", "editor"))],
)
def update_document(
    doc_id: int,
    payload: DocumentUpdate,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    d = db.get(PolicyDocument, doc_id)
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")

    if payload.title is not None:
        d.title = payload.title.strip() or d.title
    if payload.status is not None:
        d.status = payload.status

    d.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(d)
    return _doc_to_out(db, d)


@router.delete(
    "/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("owner", "admin"))],
)
def delete_document(
    doc_id: int,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    d = db.get(PolicyDocument, doc_id)
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    # If your FK is not ON DELETE CASCADE, manually delete versions/comments/approvals here.
    db.delete(d)
    db.commit()
    return None


@router.delete(
    "/{doc_id}/versions/{version}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles("owner", "admin"))],
)
def delete_version(
    doc_id: int,
    version: int,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    v = (
        db.query(PolicyVersion)
        .filter(PolicyVersion.document_id == doc_id, PolicyVersion.version == version)
        .first()
    )
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")
    db.delete(v)

    d = db.get(PolicyDocument, doc_id)
    if d:
        d.updated_at = datetime.utcnow()
    db.commit()
    return None


# -----------------------
# Comment routes
# -----------------------
@router.get("/{doc_id}/comments", response_model=List[CommentOut])
def list_comments(doc_id: int, version: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(PolicyComment).filter(PolicyComment.document_id == doc_id)
    if version is not None:
        q = q.filter(PolicyComment.version == version)
    rows = q.order_by(PolicyComment.created_at.asc()).all()
    return [
        CommentOut(
            id=r.id,
            document_id=r.document_id,
            version=r.version,
            author=r.author,
            body=r.body,
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]


@router.post(
    "/{doc_id}/comments",
    response_model=CommentOut,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "admin", "editor", "viewer", "approver"))],
)
def create_comment(
    doc_id: int,
    payload: CommentIn,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    d = db.get(PolicyDocument, doc_id)
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")

    if payload.version is not None:
        exists = (
            db.query(PolicyVersion)
            .filter(
                PolicyVersion.document_id == doc_id,
                PolicyVersion.version == payload.version,
            )
            .first()
        )
        if not exists:
            raise HTTPException(status_code=400, detail="Version not found")

    c = PolicyComment(
        document_id=doc_id,
        version=payload.version,
        author=(payload.author or "User").strip(),
        body=payload.body.strip(),
    )
    db.add(c)
    db.commit()
    db.refresh(c)

    return CommentOut(
        id=c.id,
        document_id=c.document_id,
        version=c.version,
        author=c.author,
        body=c.body,
        created_at=c.created_at.isoformat(),
    )


# -----------------------
# Approvals routes
# -----------------------
@router.get("/{doc_id}/approvals", response_model=List[ApprovalOut])
def list_approvals(doc_id: int, version: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(PolicyApproval).filter(PolicyApproval.document_id == doc_id)
    if version is not None:
        q = q.filter(PolicyApproval.version == version)
    rows = q.order_by(PolicyApproval.requested_at.asc()).all()
    return [
        ApprovalOut(
            id=r.id,
            document_id=r.document_id,
            version=r.version,
            reviewer=r.reviewer,
            status=r.status,  # type: ignore
            note=r.note,
            requested_at=r.requested_at.isoformat(),
            decided_at=r.decided_at.isoformat() if r.decided_at else None,
        )
        for r in rows
    ]


@router.post(
    "/{doc_id}/approvals",
    response_model=ApprovalOut,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "admin", "editor"))],
)

def create_approval(
    doc_id: int,
    payload: ApprovalIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    d = db.get(PolicyDocument, doc_id)
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")

    if payload.version is not None:
        exists = (
            db.query(PolicyVersion)
            .filter(PolicyVersion.document_id == doc_id, PolicyVersion.version == payload.version)
            .first()
        )
        if not exists:
            raise HTTPException(status_code=400, detail="Version not found")

    a = PolicyApproval(
        document_id=doc_id,
        version=payload.version,
        reviewer=payload.reviewer.strip(),
        status="pending",
        note=(payload.note or "").strip() or None,
    )
    db.add(a)

    # In-app notifications (reviewer + requester + owners), committed with the approval
    ver_label = payload.version if payload.version is not None else _latest_version(db, doc_id)
    reviewer_email = (payload.reviewer or "").strip().lower()
    actor_email = (user.email or "").strip().lower()

    _notify_user(
        db,
        target_email=reviewer_email,
        ntype="approval_requested",
        message=f"Approval requested for '{d.title}' v{ver_label}",
        document_id=doc_id,
        version=payload.version,
        approval_id=a.id if a.id else None,
    )
    _notify_user(
        db,
        target_email=actor_email,
        ntype="approval_requested",
        message=f"You requested approval for '{d.title}' v{ver_label}",
        document_id=doc_id,
        version=payload.version,
        approval_id=a.id if a.id else None,
    )

    # Owners (owner/approver roles), de-duped
    for em in set(_owner_emails(db, doc_id)) - {reviewer_email, actor_email}:
        _notify_user(
            db, em, "approval_requested",
            f"Approval requested for '{d.title}' v{ver_label}",
            document_id=doc_id, version=payload.version, approval_id=a.id if a.id else None
        )

    db.commit()
    db.refresh(a)

    return ApprovalOut(
        id=a.id,
        document_id=a.document_id,
        version=a.version,
        reviewer=a.reviewer,
        status=a.status,  # type: ignore
        note=a.note,
        requested_at=a.requested_at.isoformat(),
        decided_at=None,
    )
    # ---- Email notification (optional) ----
    if payload.notify and payload.notify.to:
        target_version = payload.version if payload.version is not None else _latest_version(db, doc_id)
        subject = f"[PolicyForge] Approval requested: {d.title} v{target_version}"
        notes_html = f"<p><em>Notes:</em> {payload.note}</p>" if payload.note else ""
        html = f"""
        <div style="font-family:Inter,system-ui,-apple-system,sans-serif">
          <h2>Approval Requested</h2>
          <p><strong>{d.title}</strong> (v{target_version}) requires review.</p>
          <p><strong>Reviewer:</strong> {a.reviewer}</p>
          {notes_html}
          <p>Open the application to approve or reject.</p>
          <hr/>
          <small>Doc ID: {doc_id} • Approval ID: {a.id}</small>
        </div>
        """
        send_email(
            background_tasks,
            subject,
            html,
            payload.notify.to,
            cc=payload.notify.cc,
            bcc=payload.notify.bcc,
        )
    # ---------------------------------------

    return ApprovalOut(
        id=a.id,
        document_id=a.document_id,
        version=a.version,
        reviewer=a.reviewer,
        status=a.status,  # type: ignore
        note=a.note,
        requested_at=a.requested_at.isoformat(),
        decided_at=None,
    )


@router.patch(
    "/{doc_id}/approvals/{approval_id}",
    response_model=ApprovalOut,
    dependencies=[Depends(require_roles("owner", "admin", "approver"))],
)
def decide_approval(
    doc_id: int,
    approval_id: int,
    payload: ApprovalUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    a = db.get(PolicyApproval, approval_id)
    if not a or a.document_id != doc_id:
        raise HTTPException(status_code=404, detail="Approval not found")

    a.status = payload.status  # "approved" / "rejected"
    if payload.note is not None:
        a.note = payload.note.strip() or None
    if payload.reviewer:
        a.reviewer = payload.reviewer.strip()
    a.decided_at = datetime.utcnow()

    d = db.get(PolicyDocument, doc_id)
    ver_label = a.version if a.version is not None else _latest_version(db, doc_id)
    reviewer_email = (a.reviewer or "").strip().lower()
    actor_email = (user.email or "").strip().lower()

    _notify_user(
        db,
        target_email=reviewer_email,
        ntype="approval_decided",
        message=f"'{d.title}' v{ver_label} was {a.status}",
        document_id=doc_id,
        version=a.version,
        approval_id=a.id,
    )
    _notify_user(
        db,
        target_email=actor_email,
        ntype="approval_decided",
        message=f"You {a.status} '{d.title}' v{ver_label}",
        document_id=doc_id,
        version=a.version,
        approval_id=a.id,
    )

    for em in set(_owner_emails(db, doc_id)) - {reviewer_email, actor_email}:
        _notify_user(
            db, em, "approval_decided",
            f"'{d.title}' v{ver_label} was {a.status}",
            document_id=doc_id, version=a.version, approval_id=a.id
        )

    db.commit()
    db.refresh(a)

    return ApprovalOut(
        id=a.id,
        document_id=a.document_id,
        version=a.version,
        reviewer=a.reviewer,
        status=a.status,  # type: ignore
        note=a.note,
        requested_at=a.requested_at.isoformat(),
        decided_at=a.decided_at.isoformat() if a.decided_at else None,
    )
    # ---- Email notification (optional) ----
    if payload.notify and payload.notify.to:
        d = db.get(PolicyDocument, doc_id)
        subject = f"[PolicyForge] {a.status.title()}: {d.title} v{a.version if a.version is not None else _latest_version(db, doc_id)}"
        notes_html = f"<p><em>Notes:</em> {payload.note}</p>" if payload.note else ""
        html = f"""
        <div style="font-family:Inter,system-ui,-apple-system,sans-serif">
          <h2>Approval {a.status.title()}</h2>
          <p><strong>{d.title}</strong> (v{a.version if a.version is not None else 'latest'}) was {a.status}.</p>
          <p><strong>Reviewer:</strong> {a.reviewer}</p>
          {notes_html}
          <hr/>
          <small>Doc ID: {doc_id} • Approval ID: {approval_id}</small>
        </div>
        """
        send_email(
            background_tasks,
            subject,
            html,
            payload.notify.to,
            cc=payload.notify.cc,
            bcc=payload.notify.bcc,
        )
    # ---------------------------------------

    return ApprovalOut(
        id=a.id,
        document_id=a.document_id,
        version=a.version,
        reviewer=a.reviewer,
        status=a.status,  # type: ignore
        note=a.note,
        requested_at=a.requested_at.isoformat(),
        decided_at=a.decided_at.isoformat() if a.decided_at else None,
    )


# -----------------------
# Approvals summaries
# -----------------------
@router.get("/approvals/summary_by_doc")
def approvals_summary_by_doc(scope: str = "any", db: Session = Depends(get_db)):
    """
    Return counts of approvals by document.

    scope="any"   → counts across all versions (existing behavior)
    scope="latest"→ counts only for each document's latest version
    """
    if scope not in ("any", "latest"):
        raise HTTPException(status_code=400, detail="Invalid scope")

    base = db.query(
        PolicyApproval.document_id,
        PolicyApproval.status,
        func.count(PolicyApproval.id),
    )

    if scope == "latest":
        latest_subq = (
            db.query(
                PolicyVersion.document_id,
                func.max(PolicyVersion.version).label("latest_version"),
            )
            .group_by(PolicyVersion.document_id)
            .subquery()
        )
        base = (
            base.join(latest_subq, PolicyApproval.document_id == latest_subq.c.document_id)
            .filter(PolicyApproval.version == latest_subq.c.latest_version)
        )

    rows = base.group_by(PolicyApproval.document_id, PolicyApproval.status).all()

    by_doc: Dict[int, Dict[str, int]] = {}
    for doc_id, st, count in rows:
        rec = by_doc.setdefault(doc_id, {"pending": 0, "approved": 0, "rejected": 0})
        rec[st] = count

    return [
        {
            "document_id": doc_id,
            "pending": v["pending"],
            "approved": v["approved"],
            "rejected": v["rejected"],
        }
        for doc_id, v in by_doc.items()
    ]


@router.get("/approvals/summary_all")
def approvals_summary_all(scope: str = "any", db: Session = Depends(get_db)):
    """
    Return total counts of approvals by status.

    scope="any"    → counts across ALL versions (legacy behavior)
    scope="latest" → counts only for each document's latest version, but also
                      includes versionless (global) approvals.
    """
    if scope not in ("any", "latest"):
        raise HTTPException(status_code=400, detail="Invalid scope")

    base = db.query(PolicyApproval.status, func.count(PolicyApproval.id))

    if scope == "latest":
        latest_subq = (
            db.query(
                PolicyVersion.document_id,
                func.max(PolicyVersion.version).label("latest_version"),
            )
            .group_by(PolicyVersion.document_id)
            .subquery()
        )
        base = (
            base.join(latest_subq, PolicyApproval.document_id == latest_subq.c.document_id)
            .filter(
                or_(
                    PolicyApproval.version == latest_subq.c.latest_version,
                    PolicyApproval.version.is_(None),  # count global approvals too
                )
            )
        )

    rows = base.group_by(PolicyApproval.status).all()
    d = {st: count for st, count in rows}
    return {
        "pending": int(d.get("pending", 0)),
        "approved": int(d.get("approved", 0)),
        "rejected": int(d.get("rejected", 0)),
    }

@router.get("/{doc_id}/owners", response_model=list[DocOwnerOut], dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
def list_doc_owners(doc_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(PolicyDocumentOwner, PolicyUser)
        .join(PolicyUser, PolicyUser.id == PolicyDocumentOwner.user_id)
        .filter(PolicyDocumentOwner.document_id == doc_id)
        .order_by(PolicyUser.email.asc())
        .all()
    )
    out: list[DocOwnerOut] = []
    for o,u in rows:
        out.append(DocOwnerOut(id=o.id, user_id=u.id, email=u.email, name=u.name, role=o.role))
    return out

@router.post("/{doc_id}/owners", response_model=DocOwnerOut, status_code=201, dependencies=[Depends(require_roles("owner","admin","editor"))])
def add_doc_owner(doc_id: int, payload: DocOwnerIn, db: Session = Depends(get_db)):
    d = db.get(PolicyDocument, doc_id)
    if not d: raise HTTPException(status_code=404, detail="Document not found")
    u = _get_or_create_user_by_email(db, payload.email)
    exists = db.query(PolicyDocumentOwner).filter(PolicyDocumentOwner.document_id==doc_id, PolicyDocumentOwner.user_id==u.id).first()
    if exists:
        exists.role = payload.role
        db.commit(); db.refresh(exists)
        return DocOwnerOut(id=exists.id, user_id=u.id, email=u.email, name=u.name, role=exists.role)
    o = PolicyDocumentOwner(document_id=doc_id, user_id=u.id, role=payload.role)
    db.add(o); db.commit(); db.refresh(o)
    return DocOwnerOut(id=o.id, user_id=u.id, email=u.email, name=u.name, role=o.role)

@router.delete("/{doc_id}/owners/{user_id}", status_code=204, dependencies=[Depends(require_roles("owner","admin","editor"))])
def remove_doc_owner(doc_id: int, user_id: int, db: Session = Depends(get_db)):
    o = db.query(PolicyDocumentOwner).filter(PolicyDocumentOwner.document_id==doc_id, PolicyDocumentOwner.user_id==user_id).first()
    if not o: return None
    db.delete(o); db.commit()
    return None