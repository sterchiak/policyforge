#!/usr/bin/env python3
"""
Normalize a NIST CSF 2.0 JSON export (from the NIST tool) into the format
PolicyForge serves from /v1/frameworks.

USAGE (PowerShell from repo root):
  .\.venv\Scripts\python.exe .\apps\api\scripts\normalize_nist_csf.py `
    .\apps\api\app\data\frameworks\csf-export.json `
    .\apps\api\app\data\frameworks\nist_csf_2_0.json
"""
from __future__ import annotations
import json
from collections import defaultdict, Counter
from pathlib import Path
from typing import Any, Dict, List

def normalize(in_path: Path, out_path: Path) -> None:
    raw = json.loads(in_path.read_text(encoding="utf-8"))

    try:
        graph = raw["response"]["elements"]
        elements: List[Dict[str, Any]] = graph["elements"]
        relationships: List[Dict[str, Any]] = graph["relationships"]
    except Exception:
        raise SystemExit("Input JSON does not look like a CSF Core export (missing response/elements).")

    # Index elements by type
    by_type: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for el in elements:
        t = el.get("element_type")
        if t:
            by_type[t].append(el)

    funcs = {el["element_identifier"]: el for el in by_type.get("function", [])}
    cats  = {el["element_identifier"]: el for el in by_type.get("category", [])}
    subs  = {el["element_identifier"]: el for el in by_type.get("subcategory", [])}
    exs   = {el["element_identifier"]: el for el in by_type.get("implementation_example", [])}

    # Build relationships maps
    cat_to_subs: Dict[str, List[str]] = defaultdict(list)
    sub_to_cat: Dict[str, str] = {}
    cat_to_func: Dict[str, str] = {}
    sub_to_examples: Dict[str, List[str]] = defaultdict(list)

    for r in relationships:
        src = r.get("source_element_identifier")
        dst = r.get("dest_element_identifier")
        if src in cats and dst in subs:
            cat_to_subs[src].append(dst)
            sub_to_cat[dst] = src
        if src in funcs and dst in cats:
            cat_to_func[dst] = src
        if src in subs and dst in exs:
            sub_to_examples[src].append(exs[dst].get("text", "").strip())

    # Build normalized controls list (one row per subcategory)
    controls: List[Dict[str, Any]] = []
    for sid, s in sorted(subs.items()):
        cat_code = sub_to_cat.get(sid)
        func_code = cat_to_func.get(cat_code)
        cat_title = cats.get(cat_code, {}).get("title")
        func_title = funcs.get(func_code, {}).get("title")

        title = (s.get("title") or "").strip()
        if not title:
            # fallback: first line of the descriptive text
            title = (s.get("text") or "").strip().split("\n")[0][:200] or sid

        desc = (s.get("text") or "").strip()
        examples = [x for x in sub_to_examples.get(sid, []) if x]
        if examples:
            bullets = "\n".join(f"- {x}" for x in examples)
            desc = (desc + "\n\nImplementation examples:\n" + bullets) if desc else ("Implementation examples:\n" + bullets)

        controls.append({
            "id": sid,
            "title": title,
            "description": desc or title,
            "family": func_title,           # e.g., IDENTIFY / PROTECT / GOVERN …
            "category": cat_title or cat_code,   # human title if available
        })

    meta = {
        "key": "nist_csf_2_0",
        "name": "NIST Cybersecurity Framework (CSF) 2.0",
        "version": "2.0",
        "description": "NIST CSF 2.0 Core (subcategories) normalized for PolicyForge.",
        "tags": ["NIST", "CSF", "2.0"],
    }

    payload = {"meta": meta, "controls": controls}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    # Friendly stats
    counts = Counter([c.get("family") or "UNK" for c in controls])
    print(f"Unique subcategories (controls): {len(controls)}")
    print("By function:", ", ".join(f"{k}:{v}" for k, v in counts.items()))

def main(argv: List[str]) -> int:
    import sys
    if len(argv) != 3:
        print("Usage: python apps/api/scripts/normalize_nist_csf.py <csf-export.json> <nist_csf_2_0.json>")
        return 2
    in_path = Path(argv[1]); out_path = Path(argv[2])
    if not in_path.exists():
        print(f"Input not found: {in_path}")
        return 2
    normalize(in_path, out_path)
    return 0

if __name__ == "__main__":
    import sys
    raise SystemExit(main(sys.argv))
