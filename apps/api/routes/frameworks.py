# apps/api/routes/frameworks.py
from __future__ import annotations

import csv
import io
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, validator
from sqlalchemy.orm import Session

from apps.api.app.auth import UserPrincipal, get_current_user, require_roles
from apps.api.app.db import get_db
from apps.api.app.models import FrameworkControlAssessment, PolicyUser

router = APIRouter(prefix="/v1/frameworks", tags=["frameworks"])

# --------------------------------------------------------------------
# Filesystem helpers
# --------------------------------------------------------------------

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app", "data", "frameworks")

_FN_ABBR = {
    "IDENTIFY": "ID",
    "PROTECT": "PR",
    "DETECT": "DE",
    "RESPOND": "RS",
    "RECOVER": "RC",
    "GOVERN": "GV",
}


def _file_path(*names: str) -> str:
    return os.path.normpath(os.path.join(DATA_DIR, *names))


def _load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _controls_for_key(framework_key: str) -> Tuple[dict, List[dict]]:
    """
    Returns (meta, controls) for the framework.
    For CSF 2.0 look for (in order):
      - nist_csf_2_0.json   (our normalized file)
      - csf-export.json     (normalized export name)
      - nist_csf.json       (older converter output)
    For CIS v8:
      - cis_v8.json
    Fallback: <key>.json
    """
    if framework_key == "nist_csf_2_0":
        candidates = ["nist_csf_2_0.json", "csf-export.json", "nist_csf.json"]
    elif framework_key == "cis_v8":
        candidates = ["cis_v8.json"]
    else:
        candidates = [f"{framework_key}.json"]

    meta = {"key": framework_key, "name": framework_key.upper(), "version": "", "description": "", "tags": []}
    controls: List[dict] = []

    for name in candidates:
        p = _file_path(name)
        if os.path.exists(p):
            blob = _load_json(p)
            if isinstance(blob, dict) and "controls" in blob:
                meta = blob.get("meta") or meta
                controls = blob.get("controls") or []
                break
            if isinstance(blob, list):
                controls = blob
                break

    return meta, controls


# --------------------------------------------------------------------
# Normalization
# --------------------------------------------------------------------

@dataclass
class _Control:
    id: str
    title: str
    description: str
    family: str  # IDENTIFY / DETECT / …
    category: str  # e.g., "Adverse Event Analysis"
    cat_code: str  # e.g., "DE.AE"


def _normalize_control(rc: dict) -> Optional[_Control]:
    cid = str(
        rc.get("id")
        or rc.get("control_id")
        or rc.get("number")
        or rc.get("ref")
        or rc.get("key")
        or ""
    ).strip()
    if not cid:
        return None

    title = str(rc.get("title") or rc.get("name") or rc.get("statement") or cid)
    desc = str(rc.get("description") or rc.get("text") or rc.get("details") or "")
    fam = str(rc.get("family") or rc.get("function") or "").strip()
    cat = str(rc.get("category") or rc.get("subcategory") or "").strip()

    # Category code: for CSF style IDs like "DE.AE-05" take the part before "-"
    # If no hyphen, try first 5 chars "DE.AE"
    cat_code = cid.split("-", 1)[0]
    if "." not in cat_code and fam:
        # fallback: build from family abbr + first two letters of category words
        abbr = _FN_ABBR.get(fam.upper(), fam[:2].upper())
        cat_part = "".join(w[:1] for w in re.findall(r"[A-Za-z]+", cat))[:2].upper() or "XX"
        cat_code = f"{abbr}.{cat_part}"

    return _Control(
        id=cid,
        title=title,
        description=desc,
        family=fam,
        category=cat,
        cat_code=cat_code,
    )


def _all_controls(key: str) -> List[_Control]:
    _meta, raw = _controls_for_key(key)
    out: List[_Control] = []
    for rc in raw or []:
        c = _normalize_control(rc)
        if c:
            out.append(c)
    return out


# --------------------------------------------------------------------
# Public list of frameworks
# --------------------------------------------------------------------

class FrameworkSummary(BaseModel):
    key: str
    name: str
    version: str = ""
    description: str = ""
    controls: int = 0
    tags: List[str] = []
    publisher: Optional[str] = None


@router.get("", response_model=List[FrameworkSummary])
def list_frameworks():
    items: List[FrameworkSummary] = []

    cis_meta, cis_controls = _controls_for_key("cis_v8")
    items.append(
        FrameworkSummary(
            key="cis_v8",
            name="CIS Critical Security Controls v8",
            version=str((cis_meta or {}).get("version") or "8"),
            description=str((cis_meta or {}).get("description") or ""),
            controls=len(cis_controls),
            tags=(cis_meta or {}).get("tags") or [],
            publisher="Center for Internet Security (CIS)",
        )
    )

    nist11_meta, nist11_controls = _controls_for_key("nist_csf")
    items.append(
        FrameworkSummary(
            key="nist_csf",
            name="NIST Cybersecurity Framework (v1.1)",
            version=str((nist11_meta or {}).get("version") or "1.1"),
            description=str((nist11_meta or {}).get("description") or ""),
            controls=len(nist11_controls),
            tags=(nist11_meta or {}).get("tags") or [],
            publisher="NIST",
        )
    )

    csf2_meta, csf2_controls = _controls_for_key("nist_csf_2_0")
    items.append(
        FrameworkSummary(
            key="nist_csf_2_0",
            name=str((csf2_meta or {}).get("name") or "NIST Cybersecurity Framework (v2.0)"),
            version=str((csf2_meta or {}).get("version") or "2.0"),
            description=str((csf2_meta or {}).get("description") or ""),
            controls=len(csf2_controls),
            tags=(csf2_meta or {}).get("tags") or [],
            publisher="NIST",
        )
    )

    return items


# --------------------------------------------------------------------
# Framework detail + CSF 2.0 category APIs
# --------------------------------------------------------------------

class FrameworkDetail(BaseModel):
    key: str
    name: str
    version: str = ""
    description: str = ""
    tags: List[str] = []
    publisher: Optional[str] = None


@router.get("/{key}", response_model=FrameworkDetail)
def get_framework(key: str):
    meta, _ = _controls_for_key(key)
    return FrameworkDetail(
        key=key,
        name=str(meta.get("name") or key.upper()),
        version=str(meta.get("version") or ""),
        description=str(meta.get("description") or ""),
        tags=meta.get("tags") or [],
        publisher=meta.get("publisher"),
    )


class CategorySummary(BaseModel):
    id: str              # e.g., "DE.AE"
    title: str           # e.g., "Adverse Event Analysis"
    function: Optional[str] = None  # e.g., "DETECT"
    sub_count: int
    implemented_count: int


@router.get("/{key}/categories", response_model=List[CategorySummary])
def categories_for_framework(
    key: str,
    db: Session = Depends(get_db),
):
    controls = _all_controls(key)

    buckets: Dict[str, CategorySummary] = {}
    for c in controls:
        if c.cat_code not in buckets:
            buckets[c.cat_code] = CategorySummary(
                id=c.cat_code,
                title=c.category or c.cat_code,
                function=c.family or None,
                sub_count=0,
                implemented_count=0,
            )
        buckets[c.cat_code].sub_count += 1

    # implemented count from DB
    if buckets:
        ids_by_cat = {cat: [c.id for c in controls if c.cat_code == cat] for cat in buckets.keys()}
        rows = (
            db.query(FrameworkControlAssessment)
            .filter(
                FrameworkControlAssessment.framework_key == key,
                FrameworkControlAssessment.status == "implemented",
            )
            .all()
        )
        for r in rows:
            for cat_code, id_list in ids_by_cat.items():
                if r.control_id in id_list:
                    buckets[cat_code].implemented_count += 1

    # stable order: by function then by id
    def _sort_key(cs: CategorySummary):
        f = (cs.function or "").upper()
        return (f, cs.id)

    return sorted(buckets.values(), key=_sort_key)


class AssessmentEmbedded(BaseModel):
    control_id: str
    status: Optional[str] = None
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
    assessment: Optional[AssessmentEmbedded] = None


class CategoryDetail(BaseModel):
    id: str
    title: str
    function: Optional[str] = None
    controls: List[ControlWithAssessment]


@router.get("/{key}/categories/{cat_id}", response_model=CategoryDetail)
def category_detail_by_id(
    key: str,
    cat_id: str,
    db: Session = Depends(get_db),
):
    cat_id = cat_id.strip()
    controls = [c for c in _all_controls(key) if c.cat_code == cat_id]
    if not controls:
        raise HTTPException(status_code=404, detail="Category not found")

    title = controls[0].category or cat_id
    func = controls[0].family or None

    # assessments map
    rows = (
        db.query(FrameworkControlAssessment)
        .filter(FrameworkControlAssessment.framework_key == key)
        .all()
    )
    amap: Dict[str, FrameworkControlAssessment] = {r.control_id: r for r in rows}

    out_controls: List[ControlWithAssessment] = []
    for c in controls:
        a = amap.get(c.id)
        out_controls.append(
            ControlWithAssessment(
                id=c.id,
                title=c.title,
                function=c.family or None,
                assessment=(
                    AssessmentEmbedded(
                        control_id=c.id,
                        status=a.status,
                        owner_user_id=a.owner_user_id,
                        owner_email=getattr(a.owner, "email", None) if a.owner else None,
                        notes=a.note or None,
                        evidence_links=[a.evidence_url] if a.evidence_url else [],
                        last_reviewed_at=a.updated_at.isoformat() if a.updated_at else None,
                        updated_at=a.updated_at.isoformat() if a.updated_at else None,
                    )
                    if a
                    else None
                ),
            )
        )

    return CategoryDetail(id=cat_id, title=title, function=func, controls=out_controls)


# --------------------------------------------------------------------
# Combined controls + assessment list (fallback / non-2.0)
# --------------------------------------------------------------------

@router.get("/{key}/assessments", response_model=List[ControlWithAssessment])
def list_controls_with_assessments(
    key: str,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    controls = _all_controls(key)
    rows = (
        db.query(FrameworkControlAssessment)
        .filter(FrameworkControlAssessment.framework_key == key)
        .all()
    )
    amap: Dict[str, FrameworkControlAssessment] = {r.control_id: r for r in rows}

    out: List[ControlWithAssessment] = []
    for c in controls:
        a = amap.get(c.id)
        out.append(
            ControlWithAssessment(
                id=c.id,
                title=c.title,
                function=c.family or None,
                assessment=(
                    AssessmentEmbedded(
                        control_id=c.id,
                        status=a.status,
                        owner_user_id=a.owner_user_id,
                        owner_email=getattr(a.owner, "email", None) if a.owner else None,
                        notes=a.note or None,
                        evidence_links=[a.evidence_url] if a.evidence_url else [],
                        last_reviewed_at=a.updated_at.isoformat() if a.updated_at else None,
                        updated_at=a.updated_at.isoformat() if a.updated_at else None,
                    )
                    if a
                    else None
                ),
            )
        )
    return out


# --------------------------------------------------------------------
# Single-control PATCH (UI quick updates)
# --------------------------------------------------------------------

class AssessmentPatchIn(BaseModel):
    status: Optional[str] = Field(None, description="not_applicable | planned | in_progress | implemented")
    owner_user_id: Optional[int] = None
    notes: Optional[str] = None
    evidence_links: Optional[List[str]] = None

    @validator("status")
    def _check_status(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        allowed = {"not_applicable", "planned", "in_progress", "implemented"}
        if v not in allowed:
            raise ValueError(f"status must be one of {sorted(allowed)}")
        return v


def _upsert_assessment_row(
    db: Session,
    key: str,
    control_id: str,
) -> FrameworkControlAssessment:
    row = (
        db.query(FrameworkControlAssessment)
        .filter(
            FrameworkControlAssessment.framework_key == key,
            FrameworkControlAssessment.control_id == control_id,
        )
        .first()
    )
    if row:
        return row

    now = datetime.utcnow()
    row = FrameworkControlAssessment(
        framework_key=key,
        control_id=control_id,
        status=None,
        owner_user_id=None,
        note=None,
        evidence_url=None,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


@router.patch(
    "/{key}/controls/{control_id}/assessment",
    response_model=AssessmentEmbedded,
    dependencies=[Depends(require_roles("owner", "admin", "editor"))],
)
def patch_assessment(
    key: str,
    control_id: str,
    payload: AssessmentPatchIn,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    # ensure this is a known control id
    valid = {c.id for c in _all_controls(key)}
    if control_id not in valid:
        raise HTTPException(status_code=404, detail="Unknown control_id for this framework")

    row = _upsert_assessment_row(db, key, control_id)

    if payload.status is not None:
        row.status = payload.status or None
    if payload.owner_user_id is not None:
        # allow clearing with null
        row.owner_user_id = payload.owner_user_id
    if payload.notes is not None:
        row.note = (payload.notes or "").strip() or None
    if payload.evidence_links is not None:
        # store as single URL string (first) for now; keep mapping to list for FE
        ev = [s.strip() for s in payload.evidence_links if s.strip()]
        row.evidence_url = (", ".join(ev)) if ev else None

    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)

    return AssessmentEmbedded(
        control_id=control_id,
        status=row.status or None,
        owner_user_id=row.owner_user_id,
        owner_email=getattr(row.owner, "email", None) if row.owner else None,
        notes=row.note or None,
        evidence_links=[row.evidence_url] if row.evidence_url else [],
        last_reviewed_at=row.updated_at.isoformat() if row.updated_at else None,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )


# --------------------------------------------------------------------
# Bulk upsert (still available) + delete + CSV exports
# --------------------------------------------------------------------

ALLOWED_STATUSES_BULK = {"not_started", "in_progress", "implemented", "not_applicable"}


class AssessmentIn(BaseModel):
    control_id: str
    status: str
    owner_user_id: Optional[int] = None
    note: Optional[str] = None
    evidence_url: Optional[str] = None

    @validator("status")
    def _check_status_bulk(cls, v: str) -> str:
        v = (v or "").strip()
        if v not in ALLOWED_STATUSES_BULK:
            raise ValueError(f"status must be one of {sorted(ALLOWED_STATUSES_BULK)}")
        return v


class AssessmentOut(AssessmentIn):
    id: int
    framework_key: str
    created_at: str
    updated_at: str
    owner: Optional[Dict] = None


def _to_out(a: FrameworkControlAssessment) -> AssessmentOut:
    return AssessmentOut(
        id=a.id,
        framework_key=a.framework_key,
        control_id=a.control_id,
        status=a.status or "",
        owner_user_id=a.owner_user_id,
        note=a.note or None,
        evidence_url=a.evidence_url or None,
        created_at=a.created_at.isoformat(),
        updated_at=a.updated_at.isoformat(),
        owner=({"id": a.owner.id, "name": getattr(a.owner, "name", None), "email": getattr(a.owner, "email", None)} if a.owner else None),
    )


class BulkUpsertIn(BaseModel):
    items: List[AssessmentIn]


@router.post(
    "/{key}/assessments/bulk_upsert",
    response_model=List[AssessmentOut],
    dependencies=[Depends(require_roles("owner", "admin", "editor"))],
)
def bulk_upsert_assessments(
    key: str,
    payload: BulkUpsertIn,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    valid_ids = {c.id for c in _all_controls(key)}
    if not valid_ids:
        raise HTTPException(status_code=404, detail=f"No controls found for framework '{key}'.")

    out: List[FrameworkControlAssessment] = []
    now = datetime.utcnow()

    for item in payload.items:
        cid = item.control_id.strip()
        if cid not in valid_ids:
            continue

        row = (
            db.query(FrameworkControlAssessment)
            .filter(
                FrameworkControlAssessment.framework_key == key,
                FrameworkControlAssessment.control_id == cid,
            )
            .first()
        )
        if row:
            row.status = item.status
            row.owner_user_id = item.owner_user_id
            row.note = (item.note or "").strip() or None
            row.evidence_url = (item.evidence_url or "").strip() or None
            row.updated_at = now
        else:
            row = FrameworkControlAssessment(
                framework_key=key,
                control_id=cid,
                status=item.status,
                owner_user_id=item.owner_user_id,
                note=(item.note or "").strip() or None,
                evidence_url=(item.evidence_url or "").strip() or None,
                created_at=now,
                updated_at=now,
            )
            db.add(row)
        out.append(row)

    db.commit()
    for r in out:
        db.refresh(r)

    return [_to_out(r) for r in out]


@router.delete(
    "/{key}/assessments/{assessment_id}",
    status_code=204,
    dependencies=[Depends(require_roles("owner", "admin"))],
)
def delete_assessment(
    key: str,
    assessment_id: int,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    a = db.get(FrameworkControlAssessment, assessment_id)
    if not a or a.framework_key != key:
        raise HTTPException(status_code=404, detail="Assessment not found")
    db.delete(a)
    db.commit()
    return Response(status_code=204)


@router.get("/{key}/export/csv")
def export_controls_csv(key: str):
    controls = _all_controls(key)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["framework_key", "control_id", "title", "function", "category", "description"])
    for c in controls:
        w.writerow([key, c.id, c.title, c.family, c.category, c.description.replace("\n", " ").strip()])
    out = buf.getvalue().encode("utf-8")
    headers = {"Content-Disposition": f'attachment; filename="{key}_controls.csv"'}
    return Response(content=out, media_type="text/csv", headers=headers)


@router.get("/{key}/assessments/export/csv")
def export_assessments_csv(
    key: str,
    db: Session = Depends(get_db),
    user: UserPrincipal = Depends(get_current_user),
):
    rows = (
        db.query(FrameworkControlAssessment)
        .filter(FrameworkControlAssessment.framework_key == key)
        .order_by(FrameworkControlAssessment.control_id.asc())
        .all()
    )

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "framework_key",
            "control_id",
            "status",
            "owner_user_id",
            "owner_name",
            "owner_email",
            "note",
            "evidence_url",
            "created_at",
            "updated_at",
        ]
    )
    for r in rows:
        w.writerow(
            [
                r.framework_key,
                r.control_id,
                r.status or "",
                r.owner_user_id or "",
                getattr(r.owner, "name", "") if r.owner else "",
                getattr(r.owner, "email", "") if r.owner else "",
                (r.note or "").replace("\n", " ").strip(),
                (r.evidence_url or "").strip(),
                r.created_at.isoformat(),
                r.updated_at.isoformat(),
            ]
        )

    out = buf.getvalue().encode("utf-8")
    headers = {"Content-Disposition": f'attachment; filename="{key}_assessments.csv"'}
    return Response(content=out, media_type="text/csv", headers=headers)
