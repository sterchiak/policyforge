# apps/api/routes/frameworks.py
from __future__ import annotations

import json
from datetime import datetime
from typing import List, Optional, Literal, Dict, Any

from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_

from apps.api.app.db import get_db
from apps.api.app.models import (
    OrgControlAssessment,
    OrgControlLink,
    PolicyUser,
    PolicyDocument,
)
from apps.api.app.auth import get_current_user, UserPrincipal

router = APIRouter(prefix="/v1/frameworks", tags=["frameworks"])

# ===== Data (seed) =====
# CIS Critical Security Controls v8 — top-level 18 controls (official names)
CIS_V8_CONTROLS = [
    {"id": "CIS-01", "title": "Inventory and Control of Enterprise Assets"},
    {"id": "CIS-02", "title": "Inventory and Control of Software Assets"},
    {"id": "CIS-03", "title": "Data Protection"},
    {"id": "CIS-04", "title": "Secure Configuration of Enterprise Assets and Software"},
    {"id": "CIS-05", "title": "Account Management"},
    {"id": "CIS-06", "title": "Access Control Management"},
    {"id": "CIS-07", "title": "Continuous Vulnerability Management"},
    {"id": "CIS-08", "title": "Audit Log Management"},
    {"id": "CIS-09", "title": "Email and Web Browser Protections"},
    {"id": "CIS-10", "title": "Malware Defenses"},
    {"id": "CIS-11", "title": "Data Recovery"},
    {"id": "CIS-12", "title": "Network Infrastructure Management"},
    {"id": "CIS-13", "title": "Network Monitoring and Defense"},
    {"id": "CIS-14", "title": "Security Awareness and Skills Training"},
    {"id": "CIS-15", "title": "Service Provider Management"},
    {"id": "CIS-16", "title": "Application Software Security"},
    {"id": "CIS-17", "title": "Incident Response Management"},
    {"id": "CIS-18", "title": "Penetration Testing"},
]

# NIST CSF v1.1 — Categories with official IDs (Functions: ID, PR, DE, RS, RC)
NIST_CSF_CATEGORIES = [
    # Identify
    {"id": "ID.AM", "title": "Asset Management", "function": "ID"},
    {"id": "ID.BE", "title": "Business Environment", "function": "ID"},
    {"id": "ID.GV", "title": "Governance", "function": "ID"},
    {"id": "ID.RA", "title": "Risk Assessment", "function": "ID"},
    {"id": "ID.RM", "title": "Risk Management Strategy", "function": "ID"},
    {"id": "ID.SC", "title": "Supply Chain Risk Management", "function": "ID"},
    # Protect
    {"id": "PR.AC", "title": "Identity Management, Authentication and Access Control", "function": "PR"},
    {"id": "PR.AT", "title": "Awareness and Training", "function": "PR"},
    {"id": "PR.DS", "title": "Data Security", "function": "PR"},
    {"id": "PR.IP", "title": "Information Protection Processes and Procedures", "function": "PR"},
    {"id": "PR.MA", "title": "Maintenance", "function": "PR"},
    {"id": "PR.PT", "title": "Protective Technology", "function": "PR"},
    # Detect
    {"id": "DE.AE", "title": "Anomalies and Events", "function": "DE"},
    {"id": "DE.CM", "title": "Security Continuous Monitoring", "function": "DE"},
    {"id": "DE.DP", "title": "Detection Processes", "function": "DE"},
    # Respond
    {"id": "RS.RP", "title": "Response Planning", "function": "RS"},
    {"id": "RS.CO", "title": "Communications", "function": "RS"},
    {"id": "RS.AN", "title": "Analysis", "function": "RS"},
    {"id": "RS.MI", "title": "Mitigation", "function": "RS"},
    {"id": "RS.IM", "title": "Improvements", "function": "RS"},
    # Recover
    {"id": "RC.RP", "title": "Recovery Planning", "function": "RC"},
    {"id": "RC.IM", "title": "Improvements", "function": "RC"},
    {"id": "RC.CO", "title": "Communications", "function": "RC"},
]

FRAMEWORKS = {
    "cis_v8": {
        "key": "cis_v8",
        "name": "CIS Critical Security Controls v8",
        "publisher": "Center for Internet Security (CIS)",
        "controls": CIS_V8_CONTROLS,
    },
    "nist_csf": {
        "key": "nist_csf",
        "name": "NIST Cybersecurity Framework (v1.1)",
        "publisher": "NIST",
        "controls": NIST_CSF_CATEGORIES,
    },
}

# ===== Schemas =====
class FrameworkMeta(BaseModel):
    key: str
    name: str
    publisher: str
    count: int


class Control(BaseModel):
    id: str
    title: str
    function: Optional[str] = None


class FrameworkDetail(BaseModel):
    key: str
    name: str
    publisher: str
    controls: List[Control]


# ---- Assessments ----
AssessmentStatus = Literal["not_applicable", "planned", "in_progress", "implemented"]
ALLOWED_STATUSES = {"not_applicable", "planned", "in_progress", "implemented"}


class AssessmentIn(BaseModel):
    status: Optional[AssessmentStatus] = None
    owner_user_id: Optional[int] = None
    notes: Optional[str] = None
    evidence_links: Optional[List[str]] = None  # URLs; stored as JSON array


class AssessmentOut(BaseModel):
    control_id: str
    status: Optional[AssessmentStatus] = None
    owner_user_id: Optional[int] = None
    owner_email: Optional[str] = None
    notes: Optional[str] = None
    evidence_links: List[str] = []
    last_reviewed_at: Optional[str] = None
    updated_at: Optional[str] = None


class ControlWithAssessment(BaseModel):
    id: str
    title: str
    function: Optional[str] = None
    assessment: Optional[AssessmentOut] = None
    linked_docs: Optional[List[Dict[str, Any]]] = None


# ===== Helpers =====
def _framework_or_404(key: str) -> Dict[str, Any]:
    fw = FRAMEWORKS.get(key)
    if not fw:
        raise HTTPException(status_code=404, detail="Unknown framework key")
    return fw


def _load_links(db: Session, org_id: Optional[int], framework_key: str, control_id: str) -> List[Dict[str, Any]]:
    q = db.query(OrgControlLink).filter(
        OrgControlLink.framework_key == framework_key,
        OrgControlLink.control_id == control_id,
    )
    if org_id is not None:
        q = q.filter(OrgControlLink.org_id == org_id)
    rows = q.all()
    # Minimal projection to keep payload light
    return [{"document_id": r.document_id, "version": r.version} for r in rows]


def _serialize_assessment(a: OrgControlAssessment, owner: Optional[PolicyUser]) -> AssessmentOut:
    links = []
    if a.evidence_links:
        try:
            links = json.loads(a.evidence_links)
            if not isinstance(links, list):
                links = []
        except Exception:
            links = []
    return AssessmentOut(
        control_id=a.control_id,
        status=a.status,  # type: ignore
        owner_user_id=a.owner_user_id,
        owner_email=owner.email if owner else None,
        notes=a.notes,
        evidence_links=links,
        last_reviewed_at=a.last_reviewed_at.isoformat() if a.last_reviewed_at else None,
        updated_at=a.updated_at.isoformat() if a.updated_at else None,
    )


def _get_or_create_assessment(
    db: Session, org_id: Optional[int], framework_key: str, control_id: str
) -> OrgControlAssessment:
    row = (
        db.query(OrgControlAssessment)
        .filter(
            OrgControlAssessment.framework_key == framework_key,
            OrgControlAssessment.control_id == control_id,
            (OrgControlAssessment.org_id == org_id) if org_id is not None else OrgControlAssessment.org_id.is_(None),
        )
        .first()
    )
    if row:
        return row
    row = OrgControlAssessment(
        org_id=org_id,
        framework_key=framework_key,
        control_id=control_id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(row)
    db.flush()
    return row


# ===== Routes: Catalog =====
@router.get("", response_model=List[FrameworkMeta])
def list_frameworks():
    out: List[FrameworkMeta] = []
    for fw in FRAMEWORKS.values():
        out.append(
            FrameworkMeta(
                key=fw["key"], name=fw["name"], publisher=fw["publisher"], count=len(fw["controls"])
            )
        )
    return out


@router.get("/{key}", response_model=FrameworkDetail)
def get_framework(key: str, q: Optional[str] = None, function: Optional[str] = None):
    fw = _framework_or_404(key)
    controls = fw["controls"]
    # Optional filtering
    if function:
        controls = [c for c in controls if (c.get("function") or "").lower() == function.lower()]
    if q:
        qs = q.strip().lower()
        controls = [c for c in controls if qs in c["id"].lower() or qs in c["title"].lower()]

    return FrameworkDetail(
        key=fw["key"],
        name=fw["name"],
        publisher=fw["publisher"],
        controls=[Control(**c) for c in controls],
    )


@router.get("/{key}/export/csv")
def export_framework_csv(key: str):
    fw = _framework_or_404(key)
    # very small CSV for now: id,title[,function]
    header = "id,title,function\n"
    rows = []
    for c in fw["controls"]:
        rows.append(f'{c["id"]},"{c["title"].replace("\"","\"\"")}",{c.get("function","")}')
    csv = header + "\n".join(rows)
    filename = f"{key}_controls.csv"
    return Response(
        content=csv,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ===== Routes: Assessments (NEW) =====

@router.get("/{key}/assessments", response_model=List[ControlWithAssessment])
def list_assessments_for_framework(
    key: str,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    fw = _framework_or_404(key)
    org_id = getattr(user, "orgId", None)

    # Load all assessments for org+framework in one shot
    q = db.query(OrgControlAssessment).filter(OrgControlAssessment.framework_key == key)
    if org_id is not None:
        q = q.filter(OrgControlAssessment.org_id == org_id)
    else:
        q = q.filter(OrgControlAssessment.org_id.is_(None))
    assessments = {a.control_id: a for a in q.all()}

    # Preload owners
    owner_ids = {a.owner_user_id for a in assessments.values() if a.owner_user_id}
    owners: Dict[int, PolicyUser] = {}
    if owner_ids:
        for u in db.query(PolicyUser).filter(PolicyUser.id.in_(owner_ids)).all():
            owners[u.id] = u  # type: ignore

    out: List[ControlWithAssessment] = []
    for c in fw["controls"]:
        ctrl_id = c["id"]
        a = assessments.get(ctrl_id)
        owner = owners.get(a.owner_user_id) if a and a.owner_user_id else None
        out.append(
            ControlWithAssessment(
                id=ctrl_id,
                title=c["title"],
                function=c.get("function"),
                assessment=_serialize_assessment(a, owner) if a else None,
                linked_docs=_load_links(db, org_id, key, ctrl_id),
            )
        )
    return out


@router.patch("/{key}/controls/{control_id}/assessment", response_model=AssessmentOut)
def upsert_control_assessment(
    key: str,
    control_id: str,
    payload: AssessmentIn,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    _framework_or_404(key)
    org_id = getattr(user, "orgId", None)

    # Validate status
    if payload.status and payload.status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")

    # Validate owner
    owner: Optional[PolicyUser] = None
    if payload.owner_user_id:
        owner = db.get(PolicyUser, payload.owner_user_id)
        if not owner:
            raise HTTPException(status_code=404, detail="Owner user not found")

    row = _get_or_create_assessment(db, org_id, key, control_id)
    if payload.status is not None:
        row.status = payload.status  # type: ignore
    if payload.owner_user_id is not None:
        row.owner_user_id = payload.owner_user_id
    if payload.notes is not None:
        row.notes = payload.notes.strip() or None
    if payload.evidence_links is not None:
        # Normalize to list[str]
        links = [str(u).strip() for u in payload.evidence_links if str(u).strip()]
        row.evidence_links = json.dumps(links)

    row.last_reviewed_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)

    owner_obj = db.get(PolicyUser, row.owner_user_id) if row.owner_user_id else None
    return _serialize_assessment(row, owner_obj)


class AssignOwnerIn(BaseModel):
    owner_user_id: int


@router.post("/{key}/controls/{control_id}/assign", response_model=AssessmentOut)
def assign_control_owner(
    key: str,
    control_id: str,
    payload: AssignOwnerIn,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    _framework_or_404(key)
    org_id = getattr(user, "orgId", None)

    owner = db.get(PolicyUser, payload.owner_user_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Owner user not found")

    row = _get_or_create_assessment(db, org_id, key, control_id)
    row.owner_user_id = payload.owner_user_id
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)

    return _serialize_assessment(row, owner)


class LinkDocIn(BaseModel):
    document_id: int
    version: Optional[int] = None


@router.post("/{key}/controls/{control_id}/link-doc")
def link_control_to_document(
    key: str,
    control_id: str,
    payload: LinkDocIn,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    _framework_or_404(key)
    org_id = getattr(user, "orgId", None)

    doc = db.get(PolicyDocument, payload.document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    # Optional: enforce org match when org scoping is live
    # if org_id is not None and doc.org_id is not None and doc.org_id != org_id:
    #     raise HTTPException(status_code=403, detail="Document belongs to another org")

    link = OrgControlLink(
        org_id=org_id,
        framework_key=key,
        control_id=control_id,
        document_id=payload.document_id,
        version=payload.version,
    )
    db.add(link)
    try:
        db.commit()
    except Exception:
        # Likely unique violation (already linked) — treat as idempotent
        db.rollback()
    return {"ok": True}


class BulkAssessmentItem(AssessmentIn):
    control_id: str


@router.put("/{key}/assessments")
def bulk_upsert_assessments(
    key: str,
    items: List[BulkAssessmentItem],
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    _framework_or_404(key)
    org_id = getattr(user, "orgId", None)
    now = datetime.utcnow()

    # Pre-validate owners
    owner_ids = {i.owner_user_id for i in items if i.owner_user_id}
    owners: Dict[int, PolicyUser] = {}
    if owner_ids:
        for u in db.query(PolicyUser).filter(PolicyUser.id.in_(owner_ids)).all():
            owners[u.id] = u  # type: ignore

    for i in items:
        if i.status and i.status not in ALLOWED_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status for {i.control_id}")
        if i.owner_user_id and i.owner_user_id not in owners:
            raise HTTPException(status_code=404, detail=f"Owner not found for {i.control_id}")

    # Upsert each
    for i in items:
        row = _get_or_create_assessment(db, org_id, key, i.control_id)
        if i.status is not None:
            row.status = i.status  # type: ignore
        if i.owner_user_id is not None:
            row.owner_user_id = i.owner_user_id
        if i.notes is not None:
            row.notes = i.notes.strip() or None
        if i.evidence_links is not None:
            links = [str(u).strip() for u in i.evidence_links if str(u).strip()]
            row.evidence_links = json.dumps(links)
        row.last_reviewed_at = now
        row.updated_at = now

    db.commit()
    return {"updated": len(items)}


@router.get("/{key}/export/assessments.csv")
def export_assessments_csv(
    key: str,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    fw = _framework_or_404(key)
    org_id = getattr(user, "orgId", None)

    # Load all assessments
    q = db.query(OrgControlAssessment).filter(OrgControlAssessment.framework_key == key)
    if org_id is not None:
        q = q.filter(OrgControlAssessment.org_id == org_id)
    else:
        q = q.filter(OrgControlAssessment.org_id.is_(None))

    rows = {a.control_id: a for a in q.all()}

    # Preload owners
    owner_ids = {a.owner_user_id for a in rows.values() if a.owner_user_id}
    owners: Dict[int, PolicyUser] = {}
    if owner_ids:
        for u in db.query(PolicyUser).filter(PolicyUser.id.in_(owner_ids)).all():
            owners[u.id] = u  # type: ignore

    # Build CSV (controls are the source of truth for listing)
    header = "id,title,function,status,owner_email,notes,evidence_links,last_reviewed_at,updated_at\n"
    data_lines: List[str] = []
    for c in fw["controls"]:
        ctrl_id = c["id"]
        a = rows.get(ctrl_id)
        owner_email = owners[a.owner_user_id].email if a and a.owner_user_id and a.owner_user_id in owners else ""
        notes = (a.notes or "").replace('"', '""') if a else ""
        links = ""
        if a and a.evidence_links:
            try:
                lst = json.loads(a.evidence_links)
                if isinstance(lst, list):
                    links = " ".join(str(x) for x in lst)
            except Exception:
                pass
        line = [
            ctrl_id,
            c["title"].replace('"', '""'),
            c.get("function", "") or "",
            a.status if a and a.status else "",
            owner_email,
            notes,
            links.replace('"', '""'),
            a.last_reviewed_at.isoformat() if a and a.last_reviewed_at else "",
            a.updated_at.isoformat() if a and a.updated_at else "",
        ]
        data_lines.append(f'{line[0]},"{line[1]}",{line[2]},{line[3]},"{line[4]}","{line[5]}","{line[6]}",{line[7]},{line[8]}')

    csv = header + "\n".join(data_lines)
    filename = f"{key}_assessments.csv"
    return Response(
        content=csv,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
