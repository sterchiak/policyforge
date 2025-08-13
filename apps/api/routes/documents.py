# apps/api/routes/documents.py
from __future__ import annotations

from datetime import datetime
import json
from typing import List, Optional, Literal, Dict, Tuple

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_, exists

from apps.api.app.db import get_db
from apps.api.app.models import (
    PolicyDocument,
    PolicyVersion,
    PolicyComment,
    PolicyApproval,
    PolicyNotification,
    PolicyUser,
    PolicyDocumentOwner,
)
from apps.api.routes.policies import DraftRequest, render_html, TEMPLATES
from apps.api.app.auth import get_current_user, require_roles, UserPrincipal

router = APIRouter(prefix="/v1/documents", tags=["documents"])

# =========================================================
# Pydantic I/O models
# =========================================================
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
class ApprovalIn(BaseModel):
    reviewer: str
    version: Optional[int] = None
    note: Optional[str] = None


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


# Owners I/O
class DocOwnerIn(BaseModel):
    email: EmailStr
    role: Literal["owner", "editor", "viewer", "approver"] = "owner"


class DocOwnerOut(BaseModel):
    id: int  # PolicyDocumentOwner.id
    user_id: int
    email: EmailStr
    name: Optional[str] = None
    role: Literal["owner", "editor", "viewer", "approver"]


# Ownership coverage I/O (for dashboard)
class CoverageDocOut(BaseModel):
    document_id: int
    title: str
    updated_at: str


class OwnershipCoverageOut(BaseModel):
    no_owner: List[CoverageDocOut]
    no_approver: List[CoverageDocOut]
    totals: Dict[str, int]


# =========================================================
# Helpers
# =========================================================
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


def _get_or_create_user_by_email(db: Session, email: str) -> PolicyUser:
    email_n = email.strip().lower()
    u = db.query(PolicyUser).filter(PolicyUser.email == email_n).first()
    if u:
        return u
    u = PolicyUser(email=email_n, role="viewer")
    db.add(u)
    db.flush()
    return u


def _owner_emails(db: Session, doc_id: int) -> List[str]:
    rows = (
        db.query(PolicyUser.email)
        .join(PolicyDocumentOwner, PolicyDocumentOwner.user_id == PolicyUser.id)
        .filter(
            PolicyDocumentOwner.document_id == doc_id,
            PolicyDocumentOwner.role.in_(("owner", "approver")),
        )
        .all()
    )
    return [r[0].lower() for r in rows]


def _user_has_doc_role(
    db: Session, user_email: str, doc_id: int, allowed: Tuple[str, ...] = ("owner", "approver")
) -> bool:
    if not user_email:
        return False
    email_n = user_email.strip().lower()
    q = (
        db.query(PolicyDocumentOwner.id)
        .join(PolicyUser, PolicyUser.id == PolicyDocumentOwner.user_id)
        .filter(
            PolicyDocumentOwner.document_id == doc_id,
            PolicyDocumentOwner.role.in_(allowed),
            PolicyUser.email == email_n,
        )
    )
    return db.query(q.exists()).scalar() or False


def _notify_user(
    db: Session,
    target_email: str,
    ntype: str,
    message: str,
    document_id: Optional[int] = None,
    version: Optional[int] = None,
    approval_id: Optional[int] = None,
):
    if not target_email:
        return
    row = PolicyNotification(
        target_email=target_email.strip().lower(),
        type=ntype,
        message=message,
        document_id=document_id,
        version=version,
        approval_id=approval_id,
    )
    db.add(row)


# =========================================================
# Ownership coverage (STATIC ROUTE) — declared before /{doc_id} paths
# =========================================================
@router.get("/ownership_coverage", response_model=OwnershipCoverageOut,
            dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
def ownership_coverage(limit: int = 5, db: Session = Depends(get_db)):
    """
    Returns documents that are missing owners and/or approvers assignments (per-doc),
    plus totals. Limited lists are ordered by most recently updated.
    """
    # Docs with NO owner assignment
    no_owner_docs = (
        db.query(PolicyDocument)
        .filter(
            ~exists().where(
                and_(
                    PolicyDocumentOwner.document_id == PolicyDocument.id,
                    PolicyDocumentOwner.role == "owner",
                )
            )
        )
        .order_by(PolicyDocument.updated_at.desc())
        .limit(limit)
        .all()
    )

    # Docs with NO approver assignment
    no_approver_docs = (
        db.query(PolicyDocument)
        .filter(
            ~exists().where(
                and_(
                    PolicyDocumentOwner.document_id == PolicyDocument.id,
                    PolicyDocumentOwner.role == "approver",
                )
            )
        )
        .order_by(PolicyDocument.updated_at.desc())
        .limit(limit)
        .all()
    )

    # Totals across all docs
    total_no_owner = (
        db.query(PolicyDocument)
        .filter(
            ~exists().where(
                and_(
                    PolicyDocumentOwner.document_id == PolicyDocument.id,
                    PolicyDocumentOwner.role == "owner",
                )
            )
        )
        .count()
    )
    total_no_approver = (
        db.query(PolicyDocument)
        .filter(
            ~exists().where(
                and_(
                    PolicyDocumentOwner.document_id == PolicyDocument.id,
                    PolicyDocumentOwner.role == "approver",
                )
            )
        )
        .count()
    )

    def _map(d: PolicyDocument) -> CoverageDocOut:
        return CoverageDocOut(
            document_id=d.id, title=d.title, updated_at=d.updated_at.isoformat()
        )

    return OwnershipCoverageOut(
        no_owner=[_map(d) for d in no_owner_docs],
        no_approver=[_map(d) for d in no_approver_docs],
        totals={"no_owner": total_no_owner, "no_approver": total_no_approver},
    )


# =========================================================
# "My approvals" for dashboard
# =========================================================
class MyApprovalOut(BaseModel):
    id: int
    document_id: int
    document_title: str
    version: Optional[int]
    reviewer: str
    status: Literal["pending", "approved", "rejected"]
    note: Optional[str]
    requested_at: str
    decided_at: Optional[str]


@router.get("/approvals/mine", response_model=List[MyApprovalOut],
            dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
def approvals_mine(
    status: Literal["any", "pending", "approved", "rejected"] = "pending",
    limit: int = 5,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    if not user or not getattr(user, "email", None):
        return []

    q = (
        db.query(PolicyApproval, PolicyDocument.title)
        .join(PolicyDocument, PolicyDocument.id == PolicyApproval.document_id)
        .filter(func.lower(PolicyApproval.reviewer) == func.lower(user.email))
        .order_by(PolicyApproval.requested_at.desc())
    )
    if status != "any":
        q = q.filter(PolicyApproval.status == status)

    rows = q.limit(limit).all()
    out: List[MyApprovalOut] = []
    for a, title in rows:
        out.append(
            MyApprovalOut(
                id=a.id,
                document_id=a.document_id,
                document_title=title,
                version=a.version,
                reviewer=a.reviewer,
                status=a.status,  # type: ignore
                note=a.note,
                requested_at=a.requested_at.isoformat(),
                decided_at=a.decided_at.isoformat() if a.decided_at else None,
            )
        )
    return out


# =========================================================
# Documents & Versions
# =========================================================
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

    doc.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(doc)

    return _doc_to_out(db, doc)


@router.get("", response_model=List[DocumentOut],
            dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
def list_documents(limit: int = 50, db: Session = Depends(get_db)):
    docs = (
        db.query(PolicyDocument)
        .order_by(PolicyDocument.updated_at.desc())
        .limit(limit)
        .all()
    )
    return [_doc_to_out(db, d) for d in docs]


@router.get("/{doc_id}", response_model=DocumentDetailOut,
            dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
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


@router.get("/{doc_id}/versions", response_model=List[VersionOut],
            dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
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


@router.get("/{doc_id}/versions/latest", response_model=VersionDetailOut,
            dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
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


@router.get("/{doc_id}/versions/{version}", response_model=VersionDetailOut,
            dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
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


# =========================================================
# Comments
# =========================================================
@router.get("/{doc_id}/comments", response_model=List[CommentOut],
            dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
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
        exists_v = (
            db.query(PolicyVersion)
            .filter(
                PolicyVersion.document_id == doc_id,
                PolicyVersion.version == payload.version,
            )
            .first()
        )
        if not exists_v:
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


# =========================================================
# Approvals
# =========================================================
@router.get("/{doc_id}/approvals", response_model=List[ApprovalOut],
            dependencies=[Depends(require_roles("owner","admin","editor","viewer","approver"))])
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
        exists_v = (
            db.query(PolicyVersion)
            .filter(PolicyVersion.document_id == doc_id, PolicyVersion.version == payload.version)
            .first()
        )
        if not exists_v:
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
    actor_email = (getattr(user, "email", "") or "").strip().lower()

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
            db,
            target_email=em,
            ntype="approval_requested",
            message=f"Approval requested for '{d.title}' v{ver_label}",
            document_id=doc_id,
            version=payload.version,
            approval_id=a.id if a.id else None,
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
    # Per-document permission: only document owners/approvers may decide
    if not _user_has_doc_role(db, getattr(user, "email", ""), doc_id, allowed=("owner", "approver")):
        raise HTTPException(status_code=403, detail="Only document owners or approvers can decide approvals")

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
    actor_email = (getattr(user, "email", "") or "").strip().lower()

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
            db,
            target_email=em,
            ntype="approval_decided",
            message=f"'{d.title}' v{ver_label} was {a.status}",
            document_id=doc_id,
            version=a.version,
            approval_id=a.id,
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


# =========================================================
# Approval summaries
# =========================================================
@router.get("/approvals/summary_by_doc")
def approvals_summary_by_doc(scope: str = "any", db: Session = Depends(get_db)):
    """
    Return counts of approvals by document.

    scope="any"   → counts across all versions
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

    scope="any"    → counts across ALL versions
    scope="latest" → counts only for each document's latest version, plus versionless approvals
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


# =========================================================
# Owners (for per-document ownership panel)
# =========================================================
@router.get(
    "/{doc_id}/owners",
    response_model=List[DocOwnerOut],
    dependencies=[Depends(require_roles("owner", "admin", "editor", "viewer", "approver"))],
)
def list_doc_owners(doc_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(PolicyDocumentOwner, PolicyUser)
        .join(PolicyUser, PolicyUser.id == PolicyDocumentOwner.user_id)
        .filter(PolicyDocumentOwner.document_id == doc_id)
        .order_by(PolicyDocumentOwner.id.asc())
        .all()
    )
    out: List[DocOwnerOut] = []
    for own, usr in rows:
        out.append(
            DocOwnerOut(
                id=own.id,
                user_id=usr.id,
                email=usr.email,
                name=usr.name,
                role=own.role,  # type: ignore
            )
        )
    return out


@router.post(
    "/{doc_id}/owners",
    response_model=DocOwnerOut,
    status_code=201,
    dependencies=[Depends(require_roles("owner", "admin", "editor"))],
)
def add_doc_owner(doc_id: int, payload: DocOwnerIn, db: Session = Depends(get_db)):
    d = db.get(PolicyDocument, doc_id)
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")

    usr = _get_or_create_user_by_email(db, payload.email)
    # prevent duplicates
    exists_row = (
        db.query(PolicyDocumentOwner)
        .filter(PolicyDocumentOwner.document_id == doc_id, PolicyDocumentOwner.user_id == usr.id)
        .first()
    )
    if exists_row:
        # update role if needed
        exists_row.role = payload.role
        db.commit()
        db.refresh(exists_row)
        return DocOwnerOut(
            id=exists_row.id, user_id=usr.id, email=usr.email, name=usr.name, role=exists_row.role  # type: ignore
        )

    row = PolicyDocumentOwner(document_id=doc_id, user_id=usr.id, role=payload.role)
    db.add(row)
    db.commit()
    db.refresh(row)

    return DocOwnerOut(id=row.id, user_id=usr.id, email=usr.email, name=usr.name, role=row.role)  # type: ignore


@router.delete(
    "/{doc_id}/owners/{owner_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "admin", "editor"))],
)
def remove_doc_owner(doc_id: int, owner_id: int, db: Session = Depends(get_db)):
    row = db.get(PolicyDocumentOwner, owner_id)
    if not row or row.document_id != doc_id:
        raise HTTPException(status_code=404, detail="Owner mapping not found")
    db.delete(row)
    db.commit()
    return None
