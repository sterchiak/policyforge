# apps/api/routes/frameworks.py
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter(prefix="/v1/frameworks", tags=["frameworks"])

# ===== Data =====
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
# (Subcategories like “ID.AM-1” are intentionally omitted for MVP brevity;
# we can add them later the same way if you want the 100+ subcontrols.)
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

# ===== Routes =====
@router.get("", response_model=List[FrameworkMeta])
def list_frameworks():
    out: List[FrameworkMeta] = []
    for fw in FRAMEWORKS.values():
        out.append(FrameworkMeta(
            key=fw["key"], name=fw["name"], publisher=fw["publisher"], count=len(fw["controls"])
        ))
    return out

@router.get("/{key}", response_model=FrameworkDetail)
def get_framework(key: str, q: Optional[str] = None, function: Optional[str] = None):
    fw = FRAMEWORKS.get(key)
    if not fw:
        raise HTTPException(status_code=404, detail="Unknown framework key")

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
    fw = FRAMEWORKS.get(key)
    if not fw:
        raise HTTPException(status_code=404, detail="Unknown framework key")
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
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
