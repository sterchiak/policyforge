
## Overview

PolicyForge helps small teams create and govern policy documents with approval workflows and framework mapping. It centralizes ownership, notifications, and provides practical assessment of framework control coverage.

**What you get:**

* Policy authoring with versioning, diffs, rollback, and exports (HTML/PDF/DOCX)
* Approvals (owners/approvers), notifications, and dashboard cards
* Frameworks hub (NIST CSF 2.0 category drawer; CIS v8 scaffolding)
* DB‑backed **policy templates** with default seeding at startup and a compatibility layer that powers the existing **Policies** page (no frontend rewrite necessary)

---

## Key Features

* **Documents & Versions**: create, edit, diff, rollback; export HTML/PDF/DOCX
* **Approvals Workflow**: request, approve/reject with notes; status bubbles
* **Team & Roles**: viewer, editor, approver, admin; per‑document owners/approvers
* **Notifications**: in‑app list, mark‑read, mark‑all‑read
* **Frameworks**: NIST CSF 2.0 categories + drawer; per‑control assessments; CSV exports
* **Templates**: Markdown + parameters with seeded defaults; render/preview and generate into real docs

---

## Monorepo Layout

```
apps/
  api/
    app/
      auth.py              # JWT decoding + role guards
      config.py            # env config (NEXTAUTH_SECRET, CORS, etc.)
      db.py                # SQLAlchemy engine + SessionLocal
      email.py             # SMTP helper (optional)
      models.py            # ORM: users, documents, versions, approvals, notifications, PolicyTemplate
      default_templates.py # <— builtin policy templates (hard-coded JSON/MD)
      template_seed.py     # <— seeds default templates into DB on startup (idempotent)
      data/frameworks/
        nist_csf_2_0.json
        cis_v8.json
    main.py                # FastAPI app, CORS, router mounts, startup seed
  routes/
    documents.py           # CRUD + versions + approvals, ownership coverage
    policies.py            # <— UI compatibility shim for Policies page
    policy_templates.py    # <— CRUD + render + generate (DB-backed templates)
    frameworks.py          # NIST CSF 2.0, CIS v8 endpoints & CSV exports
    notifications.py       # list, mark-read, mark-all
    users.py               # team CRUD + role updates

apps/web/
  src/app/
    policies/             # Policy generator/list page (existing UI)
    templates/            # (optional) Template Studio pages (editor + preview)
  src/components/
    NewPolicyButton.tsx   # "New Policy" quick action component
```

---

## Prerequisites

* **Python 3.10+** with a virtualenv at `.venv/`
* **Node 18+** with pnpm (or npm/yarn)
* Optional for PDF export: **Playwright (Chromium)**

---

## Quickstart

### Backend (FastAPI)

**Windows PowerShell**

```powershell
# repo root
.\.venv\Scripts\Activate.ps1
python -m ensurepip --upgrade
python -m pip install --upgrade pip
python -m pip install markdown jsonschema requests
# Optional for PDF export
# python -m pip install playwright
# python -m playwright install chromium

python -m uvicorn apps.api.main:app --host 127.0.0.1 --port 8000 --log-level debug
```

**macOS/Linux**

```bash
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install markdown jsonschema requests
# optional: python -m pip install playwright && python -m playwright install chromium
uvicorn apps.api.main:app --host 127.0.0.1 --port 8000 --log-level debug
```

### Frontend (Next.js)

```bash
# from apps/web
pnpm install
pnpm dev   # or npm/yarn
```

Create `apps/web/.env.local`:

```
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000
```

### Dev JWT for local auth

Generate a bearer token signed with `NEXTAUTH_SECRET` (defaults to `dev-super-secret-change-me`).

**PowerShell**

```powershell
$env:JWT = (python -c "
import os, base64, json, hmac, hashlib, time
secret=os.getenv('NEXTAUTH_SECRET','dev-super-secret-change-me')
header={'alg':'HS256','typ':'JWT'}
payload={'sub':'dev-user','email':'dev@policyforge.local','name':'Dev User','role':'admin','orgId':1,'iat':int(time.time()),'exp':int(time.time())+8*3600}
b64=lambda d: base64.urlsafe_b64encode(json.dumps(d,separators=(',',':')).encode()).rstrip(b'=')
msg=b'.'.join([b64(header),b64(payload)])
sig=base64.urlsafe_b64encode(hmac.new(secret.encode(), msg, hashlib.sha256).digest()).rstrip(b'=')
print((msg+b'.'+sig).decode())
").Trim()
```

**Health check**

```powershell
$headers = @{ Authorization = "Bearer $env:JWT" }
Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -Headers $headers
```

---

## Configuration

**Backend env (see `config.py`)**

* `NEXTAUTH_SECRET` — JWT HMAC secret (default: `dev-super-secret-change-me`)
* `WEB_ORIGIN` — CORS origin (default: `http://localhost:3000`)
* Email (optional) — `EMAIL_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`

**Frontend**

* `NEXT_PUBLIC_API_BASE` — e.g., `http://127.0.0.1:8000`

---
