#!/usr/bin/env python3
"""
Convert a raw NIST CSF 2.0 JSON export into PolicyForge's normalized format.

Usage (PowerShell, one line):
  .\.venv\Scripts\python.exe .\apps\api\scripts\convert_csf2_json.py .\apps\api\app\data\frameworks\raw_csf2.json .\apps\api\app\data\frameworks\nist_csf.json
"""

from __future__ import annotations
import json
import pathlib
import re
import sys
from typing import Any, Dict, List, Optional

VALID_FUNCS = {"GV", "ID", "PR", "DE", "RS", "RC"}

FUNC_ID_RE = re.compile(r"^(GV|ID|PR|DE|RS|RC)$")
CAT_ID_RE  = re.compile(r"^(GV|ID|PR|DE|RS|RC)\.[A-Z]{2}$")          # e.g., GV.OC
SUBCAT_RE  = re.compile(r"^(GV|ID|PR|DE|RS|RC)\.[A-Z]{2}-\d{2}$")    # e.g., DE.AE-01

def get_first(d: Dict[str, Any], *keys: str, default: str = "") -> str:
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return default

def first_sentence(text: str, fallback_len: int = 160) -> str:
    t = " ".join((text or "").split())
    if not t:
        return ""
    for sep in (". ", "\n", "•", "; "):
        if sep in t:
            return t.split(sep, 1)[0].strip()
    return t[:fallback_len].strip()

def extract_examples_from_subcat(sc: Dict[str, Any]) -> List[str]:
    texts: List[str] = []
    for key in ("implementation_examples", "implementationExamples", "examples"):
        val = sc.get(key)
        if isinstance(val, list):
            for ex in val:
                t = get_first(ex or {}, "text", "description", "example", default="")
                if t:
                    texts.append(t.strip())
    return texts

def prefer_functions_tree(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    core = raw.get("core")
    if isinstance(core, dict) and isinstance(core.get("functions"), list):
        return core["functions"]
    if isinstance(raw.get("functions"), list):
        return raw["functions"]
    return []

def id_of(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    return get_first(node, "id", "identifier", "element_identifier", default="").upper()

def find_functions_candidates(obj: Any) -> Optional[List[Dict[str, Any]]]:
    """
    Heuristic: find a list whose items include several function codes (GV/ID/PR/DE/RS/RC).
    Returns that list (of dicts) if found.
    """
    if isinstance(obj, list):
        codes = set()
        dict_items = [x for x in obj if isinstance(x, dict)]
        if dict_items:
            for it in dict_items:
                fid = id_of(it)
                if FUNC_ID_RE.match(fid):
                    codes.add(fid)
        if len(codes) >= 3:
            return dict_items
        for it in obj:
            cand = find_functions_candidates(it)
            if cand:
                return cand
    elif isinstance(obj, dict):
        for v in obj.values():
            cand = find_functions_candidates(v)
            if cand:
                return cand
    return None

def categories_of(func_node: Dict[str, Any], fcode: str) -> List[Dict[str, Any]]:
    # common keys
    for key in ("categories", "Categories", "children"):
        val = func_node.get(key)
        if isinstance(val, list):
            return [x for x in val if isinstance(x, dict)]
    # fallback: any list child with items whose id starts with fcode + "."
    for v in func_node.values():
        if isinstance(v, list):
            cand = [x for x in v if isinstance(x, dict) and id_of(x).startswith(fcode + ".")]
            if len(cand) >= 1:
                return cand
    return []

def subcategories_of(cat_node: Dict[str, Any]) -> List[Dict[str, Any]]:
    for key in ("subcategories", "Subcategories", "children"):
        val = cat_node.get(key)
        if isinstance(val, list):
            return [x for x in val if isinstance(x, dict)]
    # fallback: any list child with ids like PR.AC-xx etc.
    for v in cat_node.values():
        if isinstance(v, list):
            cand = [x for x in v if isinstance(x, dict) and SUBCAT_RE.match(id_of(x))]
            if len(cand) >= 1:
                return cand
    return []

def convert(src_path: pathlib.Path, dst_path: pathlib.Path) -> None:
    raw = json.loads(src_path.read_text(encoding="utf-8"))

    functions = prefer_functions_tree(raw)
    fn_source = "core.functions" if functions else ""
    if not functions:
        functions = find_functions_candidates(raw) or []
        fn_source = "discovered-list" if functions else ""

    if not functions:
        print("Could not find a functions list in the JSON. Re-export the CSF Core JSON from the NIST tool.")
        sys.exit(3)

    controls_out: Dict[str, Dict[str, Any]] = {}
    func_seen = 0
    cat_seen = 0
    sub_seen = 0

    for f in functions:
        fid = id_of(f)
        if not FUNC_ID_RE.match(fid):
            continue
        func_seen += 1
        ftitle = get_first(f, "title", "name", "label", default=fid)

        cats = categories_of(f, fid)
        for c in cats:
            cid = id_of(c)
            if not CAT_ID_RE.match(cid):
                continue
            cat_seen += 1
            ctitle = get_first(c, "title", "name", "label", default=cid)

            subs = subcategories_of(c)
            for sc in subs:
                sid = id_of(sc)
                if not SUBCAT_RE.match(sid):
                    continue
                sub_seen += 1

                raw_title = get_first(sc, "title", "name", "label", default="")
                raw_text  = get_first(sc, "text", "description", "statement", default="")

                title = raw_title or first_sentence(raw_text, 120) or sid
                exs = extract_examples_from_subcat(sc)
                desc = raw_text.strip()
                if exs:
                    bullets = "\n".join(f"- {e}" for e in exs)
                    desc = f"{desc}\n\nImplementation examples:\n{bullets}" if desc else f"Implementation examples:\n{bullets}"

                controls_out[sid] = {
                    "id": sid,
                    "title": title,
                    "description": desc or None,
                    "family": ftitle or fid,
                    "category": ctitle or cid,
                }

    controls = list(controls_out.values())
    controls.sort(key=lambda r: (r.get("family") or "", r.get("category") or "", r.get("id") or ""))

    framework_doc = {
        "key": "nist_csf_2_0",
        "name": "NIST Cybersecurity Framework (CSF)",
        "version": "2.0",
        "publisher": "NIST",
        "description": "NIST CSF 2.0 Core controls (subcategories) normalized for PolicyForge.",
        "tags": ["NIST", "CSF", "2.0"],
        "controls": controls,
    }

    dst_path.parent.mkdir(parents=True, exist_ok=True)
    dst_path.write_text(json.dumps(framework_doc, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Functions source: {fn_source}")
    print(f"Functions parsed : {func_seen}")
    print(f"Categories parsed: {cat_seen}")
    print(f"Subcats parsed   : {sub_seen} (canonical only)")
    print(f"Normalized controls (unique): {len(controls)}")
    print(f"Wrote: {dst_path}")
    if len(controls) < 90 or len(controls) > 120:
        print("NOTE: Expected ~106 controls for CSF 2.0. If far off, your raw export may not be the full 'Core'.")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python apps/api/scripts/convert_csf2_json.py <raw_csf2.json> <nist_csf.json>")
        sys.exit(1)
    src = pathlib.Path(sys.argv[1])
    dst = pathlib.Path(sys.argv[2])
    if not src.exists():
        print(f"Input not found: {src}")
        sys.exit(2)
    convert(src, dst)
