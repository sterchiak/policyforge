# apps/api/routes/frameworks.py
from __future__ import annotations

from typing import List, Optional, Dict
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
import io
import csv
from datetime import datetime

router = APIRouter(prefix="/v1/frameworks", tags=["frameworks"])

# --- Simple in-memory catalog for MVP (swap to JSON files later) ---

class Control(BaseModel):
    id: str
    title: str
    description: str
    family: Optional[str] = None
    category: Optional[str] = None

class FrameworkMeta(BaseModel):
    key: str
    name: str
    version: str
    description: str
    tags: List[str] = []

class Framework(BaseModel):
    meta: FrameworkMeta
    controls: List[Control]

CATALOG: Dict[str, Framework] = {
    "nist_csf": Framework(
        meta=FrameworkMeta(
            key="nist_csf",
            name="NIST Cybersecurity Framework (CSF)",
            version="2.0",
            description="Functions/Categories/Outcomes for managing cybersecurity risk across Identify, Protect, Detect, Respond, Recover.",
            tags=["SMB", "General", "Security"],
        ),
        controls=[
            Control(id="ID.AM-01", title="Asset Inventory", description="Maintain an up-to-date asset inventory.", family="Identify", category="Asset Management"),
            Control(id="PR.AC-01", title="Access Control Policy", description="Establish and maintain access control policy.", family="Protect", category="Access Control"),
            Control(id="DE.DP-01", title="Security Monitoring", description="Monitor systems to detect cybersecurity events.", family="Detect", category="Detection Processes"),
            Control(id="RS.MA-01", title="Incident Response Plan", description="Maintain an incident response plan.", family="Respond", category="Mitigation"),
            Control(id="RC.IM-01", title="Improvements", description="Incorporate lessons learned into response activities.", family="Recover", category="Improvements"),
        ],
    ),
    "cis_v8": Framework(
        meta=FrameworkMeta(
            key="cis_v8",
            name="CIS Critical Security Controls v8",
            version="8",
            description="Prioritized set of safeguard controls to mitigate the most common cyber attacks.",
            tags=["SMB", "Security", "Prioritized"],
        ),
        controls=[
            Control(id="1.1", title="Establish and Maintain Detailed Enterprise Asset Inventory", description="Maintain an accurate asset inventory.", family="Inventory and Control of Enterprise Assets"),
            Control(id="4.1", title="Establish and Maintain Secure Configurations", description="Harden and baseline configurations for enterprise assets.", family="Secure Configuration of Enterprise Assets and Software"),
            Control(id="5.3", title="Configure Automatic Anti-Malware Scanning", description="Enable scheduled and real-time anti-malware scans.", family="Account Management"),
            Control(id="6.7", title="Centralize Audit Logs", description="Collect and retain audit logs for analysis.", family="Access Control Management"),
            Control(id="16.13", title="Perform Regular Incident Response Exercises", description="Exercise incident response plans and update processes.", family="Incident Response Management"),
        ],
    ),
    # Add more seeds later (ISO 27001 Annex A, NIST 800-53, etc.)
}

# --- Schemas for responses ---

class FrameworkSummary(BaseModel):
    key: str
    name: str
    version: str
    description: str
    controls: int
    tags: List[str]

class FrameworkDetail(BaseModel):
    meta: FrameworkMeta
    controls: int

# --- Routes ---

@router.get("", response_model=List[FrameworkSummary])
def list_frameworks():
    out: List[FrameworkSummary] = []
    for fw in CATALOG.values():
        out.append(
            FrameworkSummary(
                key=fw.meta.key,
                name=fw.meta.name,
                version=fw.meta.version,
                description=fw.meta.description,
                controls=len(fw.controls),
                tags=fw.meta.tags,
            )
        )
    # stable order by name
    out.sort(key=lambda x: x.name.lower())
    return out

@router.get("/{key}", response_model=FrameworkDetail)
def get_framework(key: str):
    fw = CATALOG.get(key)
    if not fw:
        raise HTTPException(status_code=404, detail="Framework not found")
    return FrameworkDetail(meta=fw.meta, controls=len(fw.controls))

@router.get("/{key}/controls", response_model=List[Control])
def list_controls(key: str):
    fw = CATALOG.get(key)
    if not fw:
        raise HTTPException(status_code=404, detail="Framework not found")
    # pre-sorted by control id
    return sorted(fw.controls, key=lambda c: c.id)

@router.get("/{key}/export/csv")
def export_controls_csv(key: str):
    fw = CATALOG.get(key)
    if not fw:
        raise HTTPException(status_code=404, detail="Framework not found")

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["control_id", "title", "description", "family", "category"])
    for c in sorted(fw.controls, key=lambda c: c.id):
        writer.writerow([c.id, c.title, c.description, c.family or "", c.category or ""])

    data = buf.getvalue().encode("utf-8")
    buf.close()

    filename = f"{fw.meta.key}_controls_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(io.BytesIO(data), media_type="text/csv; charset=utf-8", headers=headers)
