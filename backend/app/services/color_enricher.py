"""Enrich docling Tiptap JSON with text colors extracted from python-docx."""
from __future__ import annotations

import io
import re


def _normalize(text: str) -> str:
    """Strip whitespace and lowercase for fuzzy matching."""
    return re.sub(r"\s+", " ", text.strip().lower())


def build_color_map(file_bytes: bytes) -> dict[str, str]:
    """
    Parse DOCX with python-docx and return {normalized_paragraph_text: hex_color}.
    Only captures the dominant (first non-black) color per paragraph.
    """
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))
    color_map: dict[str, str] = {}

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        key = _normalize(text)
        for run in para.runs:
            try:
                rgb = run.font.color.rgb
                if rgb and str(rgb) not in ("000000", "auto"):
                    color_map[key] = f"#{rgb}"
                    break
            except Exception:
                continue

    return color_map


def enrich_tiptap_with_colors(content: dict, color_map: dict[str, str]) -> dict:
    """
    Walk tiptap JSON and apply colors from color_map to matching paragraph/heading nodes.
    Modifies content in-place and returns it.
    """
    _walk_blocks(content.get("content", []), color_map)
    return content


def _walk_blocks(blocks: list, color_map: dict[str, str]) -> None:
    for block in blocks:
        btype = block.get("type")
        if btype in ("paragraph", "heading"):
            _apply_color_to_block(block, color_map)
        children = block.get("content", [])
        if children and btype not in ("paragraph", "heading"):
            _walk_blocks(children, color_map)


def _apply_color_to_block(block: dict, color_map: dict[str, str]) -> None:
    """If the block text matches a colored paragraph in color_map, apply the color."""
    parts = []
    for node in block.get("content", []):
        if node.get("type") == "text":
            parts.append(node.get("text", ""))
    full_text = _normalize(" ".join(parts))
    if not full_text:
        return

    color = color_map.get(full_text)
    if not color:
        for key, val in color_map.items():
            if full_text.startswith(key[:30]) or key.startswith(full_text[:30]):
                color = val
                break
    if not color:
        return

    for node in block.get("content", []):
        if node.get("type") != "text":
            continue
        marks = node.get("marks", [])
        has_color = any(
            m.get("type") == "textStyle" and m.get("attrs", {}).get("color")
            for m in marks
        )
        if has_color:
            continue
        ts_mark = next((m for m in marks if m.get("type") == "textStyle"), None)
        if ts_mark:
            ts_mark.setdefault("attrs", {})["color"] = color
        else:
            marks.append({"type": "textStyle", "attrs": {"color": color}})
        node["marks"] = marks
