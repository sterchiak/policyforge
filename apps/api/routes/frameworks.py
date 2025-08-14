# apps/api/routes/frameworks.py
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pathlib import Path
import csv
import io
import json
import logging
from typing import Dict, List, Any, Tuple
from urllib.parse import unquote

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/frameworks", tags=["frameworks"])

# ---------- Helpers

def _data_dir() -> Path:
    """
    Resolve to: apps/api/app/data/frameworks
    (__file__ is .../apps/api/routes/frameworks.py)
    """
    return Path(__file__).resolve().parents[1] / "app" / "data" / "frameworks"

def _read_json(p: Path) -> Dict[str, Any]:
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)

def _normalize_controls(raw: Any) -> List[Dict[str, Any]]:
    """
    Accepts shapes like:
      - {"controls": [...]}
      - {"controls": {...}} (map -> values)
      - {"core": {...}} (future proof)
    Returns list of dicts with id, title, description, family, category.
    """
    if raw is None:
        return []
    controls: List[Dict[str, Any]] = []
    if isinstance(raw, dict):
        if "controls" in raw:
            c = raw["controls"]
            if isinstance(c, list):
                controls = c
            elif isinstance(c, dict):
                controls = list(c.values())
        elif "core" in raw:  # relaxed fallback
            core = raw["core"]
            for sc in core.get("subcategories", []) or []:
                controls.append({
                    "id": sc.get("id") or sc.get("uid") or "",
                    "title": sc.get("title") or sc.get("name") or "",
                    "description": sc.get("description") or "",
                    "family": sc.get("function") or sc.get("family") or "",
                    "category": sc.get("category") or "",
                })
    elif isinstance(raw, list):
        controls = raw

    out: List[Dict[str, Any]] = []
    for r in controls:
        if not r:
            continue
        cid = str(r.get("id") or "").strip()
        if not cid:
            continue
        out.append({
            "id": cid,
            "title": str(r.get("title") or r.get("name") or cid),
            "description": str(r.get("description") or ""),
            "family": str(r.get("family") or ""),
            "category": str(r.get("category") or ""),
        })
    return out

def _group_categories(controls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Group by (function + category). Function is derived from control id prefix (e.g., PR, DE, GV).
    """
    groups: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for c in controls:
        cid = c["id"]
        func = cid.split(".", 1)[0] if "." in cid else (c.get("family") or "")[:2].upper()
        cat = c.get("category") or "Uncategorized"
        key = (func, cat)
        g = groups.setdefault(key, {"function": func, "title": cat, "sub_count": 0, "implemented_count": 0})
        g["sub_count"] += 1

    out = []
    for (func, cat), g in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        cat_id = f"{func}|{cat}"  # composite id we can parse back
        out.append({
            "id": cat_id,
            "title": g["title"],
            "function": func,
            "sub_count": g["sub_count"],
            "implemented_count": g["implemented_count"],  # placeholder until DB-backed assessments
        })
    return out

# ---------- Loaders

def _load_cis_v8() -> Dict[str, Any]:
    p = _data_dir() / "cis_v8.json"
    if not p.exists():
        logger.warning("CIS v8 file not found: %s", p)
        return {"meta": {"key": "cis_v8", "name": "CIS Critical Security Controls v8", "version": "8"},
                "controls": []}
    raw = _read_json(p)
    controls = _normalize_controls(raw)
    logger.info("Loaded CIS v8: %d controls from %s", len(controls), p)
    return {
        "meta": {
            "key": "cis_v8",
            "name": "CIS Critical Security Controls v8",
            "version": str(raw.get("meta", {}).get("version", "8")),
            "description": raw.get("meta", {}).get("description", ""),
            "tags": raw.get("meta", {}).get("tags", ["CIS"]),
            "publisher": "Center for Internet Security (CIS)",
        },
        "controls": controls,
    }

def _load_nist_csf_v1_1() -> Dict[str, Any]:
    p = _data_dir() / "nist_csf.json"
    if not p.exists():
        return {"meta": {"key": "nist_csf", "name": "NIST Cybersecurity Framework (v1.1)", "version": "1.1"},
                "controls": []}
    raw = _read_json(p)
    controls = _normalize_controls(raw)
    logger.info("Loaded NIST CSF v1.1: %d controls from %s", len(controls), p)
    return {
        "meta": {
            "key": "nist_csf",
            "name": "NIST Cybersecurity Framework (v1.1)",
            "version": str(raw.get("meta", {}).get("version", "1.1")),
            "description": raw.get("meta", {}).get("description", ""),
            "tags": raw.get("meta", {}).get("tags", ["NIST", "CSF"]),
            "publisher": "NIST",
        },
        "controls": controls,
    }

def _load_nist_csf_2_0() -> Dict[str, Any]:
    d = _data_dir()
    prefer = d / "nist_csf_2_0.json"   # normalized (your file)
    alt1   = d / "csf-export.json"     # raw export shape we can normalize
    alt2   = d / "nist_csf.json"       # legacy name fallback
    picked = None
    for cand in (prefer, alt1, alt2):
        if cand.exists():
            picked = cand
            break
    if picked is None:
        logger.warning(
            "CSF 2.0 data file not found in %s (looked for nist_csf_2_0.json, csf-export.json, nist_csf.json)", d
        )
        return {"meta": {"key": "nist_csf_2_0", "name": "NIST Cybersecurity Framework (v2.0)", "version": "2.0"},
                "controls": []}
    raw = _read_json(picked)
    controls = _normalize_controls(raw)
    logger.info("Loaded NIST CSF 2.0: %d controls from %s", len(controls), picked)
    meta = raw.get("meta") or {
        "key": "nist_csf_2_0",
        "name": "NIST Cybersecurity Framework (v2.0)",
        "version": "2.0",
        "description": "NIST CSF 2.0 Core (subcategories) normalized for PolicyForge.",
        "tags": ["NIST", "CSF", "2.0"],
        "publisher": "NIST",
    }
    meta["key"] = "nist_csf_2_0"
    return {"meta": meta, "controls": controls}

# in-process cache
CACHE: Dict[str, Dict[str, Any]] = {}

def _get_framework(key: str) -> Dict[str, Any]:
    if key in CACHE:
        return CACHE[key]
    if key == "cis_v8":
        fw = _load_cis_v8()
    elif key in ("nist_csf", "nist_csf_v1_1"):
        fw = _load_nist_csf_v1_1()
    elif key in ("nist_csf_2_0", "csf_2_0"):
        fw = _load_nist_csf_2_0()
    else:
        raise HTTPException(status_code=404, detail="Unknown framework")
    CACHE[key] = fw
    return fw

# ---------- Routes

@router.get("")
def list_frameworks():
    rows = []
    for key in ("cis_v8", "nist_csf", "nist_csf_2_0"):
        try:
            fw = _get_framework(key)
        except HTTPException:
            continue
        meta = fw.get("meta", {})
        rows.append({
            "key": meta.get("key", key),
            "name": meta.get("name", key),
            "version": meta.get("version", ""),
            "description": meta.get("description", ""),
            "controls": len(fw.get("controls", [])),
            "tags": meta.get("tags", []),
            "publisher": meta.get("publisher", "NIST" if "nist" in key else "Center for Internet Security (CIS)"),
        })
    return rows

@router.get("/{key}")
def get_framework_meta(key: str):
    fw = _get_framework(key)
    meta = fw.get("meta", {})
    return {
        "key": meta.get("key", key),
        "name": meta.get("name", key),
        "version": meta.get("version", ""),
        "description": meta.get("description", ""),
        "publisher": meta.get("publisher", "NIST" if "nist" in key else "Center for Internet Security (CIS)"),
        "tags": meta.get("tags", []),
    }

@router.get("/{key}/categories")
def get_framework_categories(key: str):
    fw = _get_framework(key)
    controls = fw.get("controls", [])
    if not controls:
        logger.warning("Framework %s has zero controls loaded; UI may show only sample.", key)
    return _group_categories(controls)

@router.get("/{key}/categories/{cat_id}")
def get_category_detail(key: str, cat_id: str):
    """
    cat_id is "FUNC|Category Name"
    """
    fw = _get_framework(key)
    controls = fw.get("controls", [])
    if not controls:
        return {"id": cat_id, "title": "", "function": "", "controls": []}
    func, _, cat_enc = unquote(cat_id).partition("|")
    cat = cat_enc
    members = []
    for c in controls:
        c_func = c["id"].split(".", 1)[0] if "." in c["id"] else (c.get("family") or "")[:2].upper()
        if c_func == func and (c.get("category") or "Uncategorized") == cat:
            members.append({
                "id": c["id"],
                "title": c["title"],
                "function": c_func,
                "assessment": None,   # placeholder until DB-backed assessments
                "linked_docs": [],
            })
    return {"id": cat_id, "title": cat, "function": func, "controls": members}

@router.get("/{key}/assessments")
def list_controls_for_inline_mode(key: str):
    """
    Minimal list to make the 'inline table' mode work if categories are empty.
    """
    fw = _get_framework(key)
    controls = fw.get("controls", [])
    out = []
    for c in controls:
        func = c["id"].split(".", 1)[0] if "." in c["id"] else (c.get("family") or "")[:2].upper()
        out.append({
            "id": c["id"],
            "title": c["title"],
            "function": func,
            "assessment": None,
            "linked_docs": [],
        })
    return out

@router.get("/{key}/export/csv")
def export_controls_csv(key: str):
    fw = _get_framework(key)
    controls = fw.get("controls", [])
    if not controls:
        raise HTTPException(status_code=404, detail="No controls available")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "title", "family", "category", "description"])
    for c in controls:
        w.writerow([c["id"], c["title"], c.get("family", ""), c.get("category", ""), c.get("description", "")])
    buf.seek(0)
    filename = f"{key}_controls.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)

@router.get("/{key}/export/assessments/csv")
def export_assessments_csv(key: str):
    fw = _get_framework(key)
    controls = fw.get("controls", [])
    if not controls:
        raise HTTPException(status_code=404, detail="No controls available")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["control_id", "status", "owner", "evidence", "notes"])
    for c in controls:
        w.writerow([c["id"], "", "", "", ""])
    buf.seek(0)
    filename = f"{key}_assessments.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)
