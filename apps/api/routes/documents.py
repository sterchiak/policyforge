# apps/api/routes/documents.py
from __future__ import annotations

from datetime import datetime
import json
from typing import List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from apps.api.app.db import get_db
from apps.api.app.models import PolicyDocument, PolicyVersion
from apps.api.routes.policies import DraftRequest, render_html, TEMPLATES

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
    status: Optional[Literal["draft", "in_review", "approved", "published"]] = None


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


# -----------------------
# Routes
# -----------------------
@router.post("", response_model=DocumentOut)
def create_document(req: DraftRequest, db: Session = Depends(get_db)):
    """Create a new policy document and its initial version (v1)."""
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
                id=v.id,
                version=v.version,
                created_at=v.created_at.isoformat(),
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


@router.post("/{doc_id}/versions", response_model=VersionOut)
def create_version(doc_id: int, req: DraftRequest, db: Session = Depends(get_db)):
    """Create a new version for an existing document using current parameters."""
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
        id=v.id,
        version=v.version,
        created_at=v.created_at.isoformat(),
    )


@router.post("/{doc_id}/versions/{version}/rollback", response_model=VersionOut)
def rollback_to_version(doc_id: int, version: int, db: Session = Depends(get_db)):
    """Create a new version using the params from a historical version."""
    base = (
        db.query(PolicyVersion)
        .filter(
            PolicyVersion.document_id == doc_id,
            PolicyVersion.version == version,
        )
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
        params_json=base.params_json,  # reuse exact params
    )
    db.add(v)
    d.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(v)

    return VersionOut(id=v.id, version=v.version, created_at=v.created_at.isoformat())


@router.get("/{doc_id}/versions/{version}", response_model=VersionDetailOut)
def get_version(doc_id: int, version: int, db: Session = Depends(get_db)):
    """Fetch full details for a specific version, including HTML and params."""
    v = (
        db.query(PolicyVersion)
        .filter(
            PolicyVersion.document_id == doc_id,
            PolicyVersion.version == version,
        )
        .first()
    )
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")

    try:
        payload = json.loads(v.params_json)
        params = DraftRequest.model_validate(payload)  # pydantic v2
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


@router.patch("/{doc_id}", response_model=DocumentOut)
def update_document(doc_id: int, payload: DocumentUpdate, db: Session = Depends(get_db)):
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


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(doc_id: int, db: Session = Depends(get_db)):
    d = db.get(PolicyDocument, doc_id)
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    db.delete(d)
    db.commit()
    return None


@router.delete("/{doc_id}/versions/{version}", status_code=status.HTTP_204_NO_CONTENT)
def delete_version(doc_id: int, version: int, db: Session = Depends(get_db)):
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
