#!/usr/bin/env python3
"""
Convert a raw NIST CSF 2.0 JSON export into PolicyForge's normalized format.

Input  : apps/api/app/data/frameworks/raw_csf2.json
Output : apps/api/app/data/frameworks/nist_csf.json

Run:
  python apps/api/scripts/convert_csf2_json.py \
    apps/api/app/data/frameworks/raw_csf2.json \
    apps/api/app/data/frameworks/nist_csf.json
"""

from __future__ import annotations
import json
import pathlib
import sys
from typing import Any, Dict, List, Tuple


# ----------------------------
# Utilities for defensive parse
# ----------------------------

def as_list(x: Any) -> List[Any]:
    if x is None:
        return []
    if isinstance(x, list):
        return x
    return [x]

def get_first(d: Dict[str, Any], *keys: str, default: str = "") -> str:
    for k in keys:
        if k in d and isinstance(d[k], str) and d[k].strip():
            return d[k].strip()
    return default

def first_sentence(text: str, fallback_len: int = 160) -> str:
    t = " ".join((text or "").split())
    if not t:
        return ""
    # try to grab a concise first sentence
    for sep in [". ", "\n", "•", "; "]:
        if sep in t:
            return t.split(sep, 1)[0].strip()
    return t[:fallback_len].strip()


# ------------------------------------
# Walk the raw JSON and collect pieces
# ------------------------------------

def walk_collect(obj: Any,
                 functions: List[Dict[str, Any]],
                 categories: List[Dict[str, Any]],
                 subcats: List[Dict[str, Any]],
                 examples: List[Dict[str, Any]]) -> None:
    """Recursively collect nodes by element_type (or similar hints)."""
    if isinstance(obj, dict):
        et = get_first(obj, "element_type", "type", default="").lower()
        # Heuristics for NIST tool shapes
        if et == "function" or (et == "" and obj.get("categories") and obj.get("id") and len(obj.get("id", "")) <= 3):
            functions.append(obj)
        elif et == "category" or (et == "" and obj.get("subcategories") and obj.get("id") and "." in obj.get("id", "")):
            categories.append(obj)
        elif et == "subcategory" or (et == "" and obj.get("id") and "-" in obj.get("id", "")):
            subcats.append(obj)
        elif "implementation_example" in et or obj.get("implementation_example") is True:
            examples.append(obj)
        # Some exports provide examples in a top-level collection
        elif "element_type" in obj and obj["element_type"] in ("implementation_example", "Implementation_Example"):
            examples.append(obj)

        # Recurse
        for v in obj.values():
            walk_collect(v, functions, categories, subcats, examples)

    elif isinstance(obj, list):
        for it in obj:
            walk_collect(it, functions, categories, subcats, examples)


# --------------------------------------------
# Build lookup maps and normalized control rows
# --------------------------------------------

def build_maps(functions: List[Dict[str, Any]],
               categories: List[Dict[str, Any]]) -> Tuple[Dict[str, str], Dict[str, Tuple[str, str]]]:
    """
    Returns:
      fn_map:   { "GV": "GOVERN", ... }
      cat_map:  { "GV.OC": ("GV", "Organizational Context"), ... }
    """
    fn_map: Dict[str, str] = {}
    for f in functions:
        fid = get_first(f, "id", "identifier", "element_identifier", default="").upper()
        title = get_first(f, "title", "name", "label", default=fid)
        if fid:
            fn_map[fid] = title

    cat_map: Dict[str, Tuple[str, str]] = {}
    for c in categories:
        cid = get_first(c, "id", "identifier", "element_identifier", default="")
        title = get_first(c, "title", "name", "label", default=cid)
        # function code often precedes the dot
        fcode = cid.split(".", 1)[0].upper() if "." in cid else get_first(c, "function_id", default="").upper()
        if cid:
            cat_map[cid] = (fcode, title)

    return fn_map, cat_map


def normalize_controls(subcats: List[Dict[str, Any]],
                       examples: List[Dict[str, Any]],
                       fn_map: Dict[str, str],
                       cat_map: Dict[str, Tuple[str, str]]) -> List[Dict[str, Any]]:
    """
    Normalize subcategories into PolicyForge controls:
      { id, title, description, family, category }
    """
    # Pre-index examples by subcat id prefix (e.g., "GV.OC-01")
    example_map: Dict[str, List[str]] = {}
    for ex in examples:
        # Try to discover which subcategory this example belongs to
        ref = get_first(ex, "element_identifier", "subcategory_id", "subcategory", "reference", default="")
        text = get_first(ex, "text", "description", "example", default="")
        if not ref or not text:
            continue
        # Normalize subcat ref to something like "GV.OC-01"
        sub_id = ref.split(".", 1)[0] if "-0" in ref and "." in ref else ref
        # Safer: keep the longest prefix that contains a dash (subcategory)
        parts = [p for p in [ref, ref.replace(".a", ""), ref.replace(".1", "")] if "-" in p]
        sub_id = max(parts, key=len) if parts else ref
        example_map.setdefault(sub_id, []).append(text.strip())

    out: List[Dict[str, Any]] = []

    for sc in subcats:
        sid = get_first(sc, "id", "identifier", "element_identifier", default="")
        if not sid:
            continue

        # category code: prefix before the dash, e.g., "GV.OC" in "GV.OC-01"
        cat_code = sid.split("-", 1)[0] if "-" in sid else ""
        fcode = cat_code.split(".", 1)[0] if "." in cat_code else ""

        family_title = fn_map.get(fcode, fcode or "N/A")
        category_title = cat_map.get(cat_code, ("", cat_code))[1]

        # Titles / text
        raw_title = get_first(sc, "title", "name", "label", default="")
        raw_text = get_first(sc, "text", "description", "statement", default="")
        title = raw_title or first_sentence(raw_text, 120) or sid

        # Append examples (if any) to description
        desc = raw_text.strip()
        exs = example_map.get(sid, [])
        if exs:
            bullets = "\n".join([f"- {e}" for e in exs])
            desc = f"{desc}\n\nImplementation examples:\n{bullets}" if desc else f"Implementation examples:\n{bullets}"

        out.append({
            "id": sid,
            "title": title,
            "description": desc or None,
            "family": family_title or None,
            "category": category_title or None,
        })

    # Stable sort: by family, category, id
    out.sort(key=lambda r: (r.get("family") or "", r.get("category") or "", r.get("id") or ""))
    return out


# ----------------------------
# Main conversion entry point
# ----------------------------

def convert(src_path: pathlib.Path, dst_path: pathlib.Path) -> None:
    raw = json.loads(src_path.read_text(encoding="utf-8"))

    # Collect nodes (defensive against varying shapes)
    functions: List[Dict[str, Any]] = []
    categories: List[Dict[str, Any]] = []
    subcats: List[Dict[str, Any]] = []
    examples: List[Dict[str, Any]] = []

    walk_collect(raw, functions, categories, subcats, examples)

    fn_map, cat_map = build_maps(functions, categories)
    controls = normalize_controls(subcats, examples, fn_map, cat_map)

    # Compose normalized framework document
    framework_doc = {
        "key": "nist_csf_2_0",
        "name": "NIST Cybersecurity Framework (CSF)",
        "version": "2.0",
        "publisher": "NIST",
        "description": "NIST CSF 2.0 Core controls (subcategories) normalized for PolicyForge.",
        "tags": ["NIST", "CSF", "2.0"],
        "controls": controls,  # UI already knows how to render this
    }

    dst_path.parent.mkdir(parents=True, exist_ok=True)
    dst_path.write_text(json.dumps(framework_doc, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Converted CSF 2.0: {len(functions)} functions, {len(categories)} categories, "
          f"{len(subcats)} subcategories → {len(controls)} controls.")
    print(f"Wrote: {dst_path}")


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
