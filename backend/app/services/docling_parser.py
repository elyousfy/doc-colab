"""Parse documents with Docling and map to Tiptap JSON."""

from __future__ import annotations

import base64
import io
import os
import re
import tempfile
import uuid


def _block_id() -> str:
    return str(uuid.uuid4())


_MIME_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "image/svg+xml": ".svg",
}

# File extensions that docling processes without provenance/coordinate data
_NO_PROV_EXTENSIONS = {".docx", ".doc", ".pptx", ".ppt"}


def parse_with_docling(file_bytes: bytes, filename: str) -> tuple[dict, list[dict]]:
    """Convert an arbitrary file with Docling and map to Tiptap blocks."""
    try:
        from docling.document_converter import DocumentConverter
    except ImportError as exc:
        raise RuntimeError(
            "Docling is not installed. Install backend dependencies to enable Docling import."
        ) from exc

    suffix = os.path.splitext(filename)[1].lower() if filename else ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        converter = DocumentConverter()
        result = converter.convert(tmp_path)
        doc = result.document
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    # DOCX/PPTX: use docling's own markdown export — it already handles equation
    # fragments, subscripts, and text concatenation correctly.
    if suffix in _NO_PROV_EXTENSIONS:
        return _tiptap_via_markdown(doc)

    # PDF and other formats: use provenance-sorted path (preserves page order + images)
    data = doc.export_to_dict()
    return _tiptap_via_prov(data)


# ---------------------------------------------------------------------------
# DOCX path: export_to_markdown() → Tiptap
# ---------------------------------------------------------------------------

_MD_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")
_MD_TABLE_ROW_RE = re.compile(r"^\|.*\|$")
_MD_TABLE_SEP_RE = re.compile(r"^\|[\s\-:|]+\|$")
_MD_LIST_RE = re.compile(r"^[\-\*\+]\s+(.+)$")
_MD_IMG_RE = re.compile(r"!\[[^\]]*\]\([^\)]*\)")
_TOC_PAGE_NUM_RE = re.compile(r"[\t ]{2,}\d{1,4}\s*$")
_MD_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_MD_ITALIC_RE = re.compile(r"\*(.+?)\*")


def _strip_toc_page_number(text: str) -> str:
    """Strip trailing page-number from TOC lines (e.g. 'Section title   3' → 'Section title')."""
    return _TOC_PAGE_NUM_RE.sub("", text).rstrip()


def _md_inline_to_nodes(text: str) -> list[dict]:
    """Convert inline markdown (bold, italic, plain) to Tiptap text nodes."""
    text = _MD_IMG_RE.sub("", text).strip()
    if not text:
        return []
    nodes: list[dict] = []
    while text:
        bm = _MD_BOLD_RE.search(text)
        im = _MD_ITALIC_RE.search(text)
        # Use whichever match starts earliest; prefer bold if tied
        if bm and (not im or bm.start() <= im.start()):
            if bm.start() > 0:
                nodes.append({"type": "text", "text": text[: bm.start()]})
            nodes.append({"type": "text", "text": bm.group(1), "marks": [{"type": "bold"}]})
            text = text[bm.end() :]
        elif im:
            if im.start() > 0:
                nodes.append({"type": "text", "text": text[: im.start()]})
            nodes.append({"type": "text", "text": im.group(1), "marks": [{"type": "italic"}]})
            text = text[im.end() :]
        else:
            nodes.append({"type": "text", "text": text})
            break
    return nodes


def _md_parse_table(table_lines: list[str]) -> dict | None:
    if not table_lines:
        return None
    rows: list[dict] = []
    for line in table_lines:
        parts = [c.strip() for c in line.split("|")]
        # Remove leading/trailing empty strings from outer pipes
        if parts and not parts[0]:
            parts = parts[1:]
        if parts and not parts[-1]:
            parts = parts[:-1]
        if not parts:
            continue
        cells = []
        for cell_text in parts:
            nodes = _md_inline_to_nodes(cell_text) or []
            cells.append({
                "type": "tableCell",
                "attrs": {},
                "content": [{"type": "paragraph", "attrs": {"blockId": _block_id()}, "content": nodes}],
            })
        rows.append({"type": "tableRow", "content": cells})
    if not rows:
        return None
    return {"type": "table", "attrs": {"blockId": _block_id()}, "content": rows}


def _tiptap_via_markdown(doc) -> tuple[dict, list[dict]]:
    """Build Tiptap JSON from docling's markdown export.

    Docling's export_to_markdown() already handles equation fragment merging,
    subscript concatenation, and reading-order reconstruction — so we use it
    directly instead of reimplementing that logic via iterate_items().
    """
    try:
        md_text = doc.export_to_markdown()
    except Exception:
        # Emergency fallback: use the prov-based path
        data = doc.export_to_dict()
        return _tiptap_via_prov(data)

    lines = md_text.split("\n")
    blocks: list[dict] = []
    i = 0

    while i < len(lines):
        stripped = lines[i].strip()

        # Empty line — skip
        if not stripped:
            i += 1
            continue

        # Heading: # / ## / ...
        hm = _MD_HEADING_RE.match(stripped)
        if hm:
            level = min(len(hm.group(1)), 6)
            text = _strip_toc_page_number(hm.group(2).strip())
            nodes = _md_inline_to_nodes(text)
            if nodes:
                blocks.append({
                    "type": "heading",
                    "attrs": {"blockId": _block_id(), "level": level},
                    "content": nodes,
                })
            i += 1
            continue

        # Table: collect rows, skip separator lines
        if _MD_TABLE_ROW_RE.match(stripped):
            table_lines: list[str] = []
            while i < len(lines):
                s = lines[i].strip()
                if not _MD_TABLE_ROW_RE.match(s):
                    break
                if not _MD_TABLE_SEP_RE.match(s):
                    table_lines.append(s)
                i += 1
            tbl = _md_parse_table(table_lines)
            if tbl:
                blocks.append(tbl)
            continue

        # Unordered list
        if _MD_LIST_RE.match(stripped):
            items: list[dict] = []
            while i < len(lines):
                lm = _MD_LIST_RE.match(lines[i].strip())
                if not lm:
                    break
                nodes = _md_inline_to_nodes(lm.group(1))
                if nodes:
                    items.append({
                        "type": "listItem",
                        "content": [{"type": "paragraph", "attrs": {"blockId": _block_id()}, "content": nodes}],
                    })
                i += 1
            if items:
                blocks.append({
                    "type": "bulletList",
                    "attrs": {"blockId": _block_id()},
                    "content": items,
                })
            continue

        # Paragraph: collect until blank line or block-level element
        para_lines: list[str] = []
        while i < len(lines):
            s = lines[i].strip()
            if not s:
                break
            if _MD_HEADING_RE.match(s) or _MD_TABLE_ROW_RE.match(s) or _MD_LIST_RE.match(s):
                break
            para_lines.append(s)
            i += 1
        text = " ".join(para_lines)
        text = _strip_toc_page_number(text)
        nodes = _md_inline_to_nodes(text)
        if nodes:
            blocks.append({
                "type": "paragraph",
                "attrs": {"blockId": _block_id()},
                "content": nodes,
            })

    if not blocks:
        blocks = [{"type": "paragraph", "attrs": {"blockId": _block_id()}}]

    return {"type": "doc", "content": blocks}, []


# ---------------------------------------------------------------------------
# PDF path: provenance-sorted via export_to_dict()
# ---------------------------------------------------------------------------

def _get_sort_key(item: dict) -> tuple:
    """Sort key: (page_no, y_from_top). Handles both coord origins."""
    prov_list = item.get("prov") or []
    if not prov_list:
        return (9999, 9999.0)
    prov = prov_list[0]
    page = prov.get("page_no", 9999)
    bbox = prov.get("bbox") or {}
    t = float(bbox.get("t", 9999))
    origin = bbox.get("coord_origin", "BOTTOMLEFT")
    y_from_top = -t if origin == "BOTTOMLEFT" else t
    return (page, y_from_top)


def _tiptap_via_prov(data: dict) -> tuple[dict, list[dict]]:
    """Sort ALL items by (page_no, y_from_top) provenance for correct reading order (PDF path)."""
    texts = data.get("texts", [])
    tables = data.get("tables", [])
    pictures = data.get("pictures", [])

    picture_nodes: dict[str, dict] = {}
    images: list[dict] = []

    for idx, pic in enumerate(pictures):
        pic_ref = pic.get("self_ref")
        image = pic.get("image") or {}
        uri = image.get("uri", "")
        mime = image.get("mimetype") or "image/png"

        if not isinstance(pic_ref, str):
            continue
        if not uri.startswith("data:") or ";base64," not in uri:
            continue

        header, b64_data = uri.split(";base64,", 1)
        mime_from_uri = header.replace("data:", "").strip()
        if mime_from_uri:
            mime = mime_from_uri
        ext = _MIME_EXT.get(mime, ".bin")
        filename = f"docling_img_{idx}{ext}"

        try:
            blob = base64.b64decode(b64_data)
        except (ValueError, TypeError):
            continue

        images.append({"filename": filename, "data": blob, "mime_type": mime})

        size = image.get("size") or {}
        attrs: dict = {
            "blockId": _block_id(),
            "src": f"__IMAGE__{filename}",
            "alt": "",
            "title": None,
        }
        w = size.get("width")
        h = size.get("height")
        if isinstance(w, (int, float)):
            attrs["width"] = round(float(w), 1)
        if isinstance(h, (int, float)):
            attrs["height"] = round(float(h), 1)

        picture_nodes[pic_ref] = {"node": {"type": "image", "attrs": attrs}, "prov_item": pic}

    all_items: list[dict] = []
    for item in texts:
        all_items.append({"_kind": "text", "_item": item})
    for item in tables:
        all_items.append({"_kind": "table", "_item": item})
    for ref, data_dict in picture_nodes.items():
        all_items.append({"_kind": "picture", "_item": data_dict["prov_item"], "_node": data_dict["node"]})

    all_items.sort(key=lambda x: _get_sort_key(x["_item"]))

    raw_blocks: list[dict] = []
    current_page: int = 0
    for entry in all_items:
        kind = entry["_kind"]
        item = entry["_item"]

        # Insert page break marker between pages
        prov_list = item.get("prov") or []
        if prov_list:
            page_no = prov_list[0].get("page_no", 0)
            if current_page > 0 and page_no > current_page:
                raw_blocks.append({
                    "type": "pageBreak",
                    "attrs": {"blockId": _block_id(), "pageNumber": page_no},
                })
            if page_no > 0:
                current_page = page_no

        if kind == "picture":
            raw_blocks.append(entry["_node"])
        elif kind == "table":
            tbl = _map_table(item)
            if tbl:
                raw_blocks.append(tbl)
        elif kind == "text":
            node = _map_text_item(item)
            if node:
                raw_blocks.append(node)

    blocks = _group_list_items(raw_blocks)
    if not blocks:
        blocks = [{"type": "paragraph", "attrs": {"blockId": _block_id()}}]

    return {"type": "doc", "content": blocks}, images


# ---------------------------------------------------------------------------
# PDF path helpers: text/table mapping from export_to_dict()
# ---------------------------------------------------------------------------

def _map_text_item(item: dict) -> dict | None:
    """Map a docling text item dict to a Tiptap node."""
    text = (item.get("text") or "").strip()
    if not text:
        return None

    label = item.get("label", "")
    formatting = item.get("formatting") or {}

    marks: list[dict] = []
    style_attrs: dict = {}

    if formatting.get("bold"):
        marks.append({"type": "bold"})
    if formatting.get("italic"):
        marks.append({"type": "italic"})
    if formatting.get("underline"):
        marks.append({"type": "underline"})

    font_name = (formatting.get("font_name") or formatting.get("fontName") or
                 formatting.get("font") or "")
    font_size = formatting.get("font_size") or formatting.get("fontSize")
    color = (formatting.get("color") or formatting.get("font_color") or
             formatting.get("fontColor") or "")

    if font_name:
        style_attrs["fontFamily"] = font_name
    if font_size:
        if isinstance(font_size, (int, float)):
            style_attrs["fontSize"] = f"{font_size}pt"
        else:
            style_attrs["fontSize"] = str(font_size)
    if color and color.lower() not in ("", "auto", "000000", "#000000", "000"):
        style_attrs["color"] = color if color.startswith("#") else f"#{color}"

    if style_attrs:
        marks.append({"type": "textStyle", "attrs": style_attrs})

    text_node: dict = {"type": "text", "text": text}
    if marks:
        text_node["marks"] = marks

    attrs: dict = {"blockId": _block_id()}

    alignment = (formatting.get("text_align") or formatting.get("alignment") or
                 formatting.get("textAlign") or "")
    if alignment:
        mapping = {"left": "left", "center": "center", "right": "right",
                   "justify": "justify", "both": "justify"}
        mapped = mapping.get(alignment.lower())
        if mapped:
            attrs["textAlign"] = mapped

    if label == "section_header":
        raw_level = formatting.get("level") or formatting.get("heading_level")
        level = int(raw_level) if raw_level else 2
        level = max(1, min(level, 6))
        return {"type": "heading", "attrs": {**attrs, "level": level}, "content": [text_node]}

    if label == "list_item":
        return {
            "type": "paragraph",
            "attrs": attrs,
            "content": [text_node],
            "_list_type": "bullet",
        }

    return {"type": "paragraph", "attrs": attrs, "content": [text_node]}


def _map_table(item: dict) -> dict | None:
    """Map a docling table dict to a Tiptap table node."""
    data = item.get("data") or {}
    grid = data.get("grid") or []
    if not grid:
        return None

    rows: list[dict] = []
    for row in grid:
        cells: list[dict] = []
        for cell in row:
            text = (cell.get("text") or "").strip()
            if text:
                cell_content = [{
                    "type": "paragraph",
                    "attrs": {"blockId": _block_id()},
                    "content": [{"type": "text", "text": text}],
                }]
            else:
                cell_content = [{"type": "paragraph", "attrs": {"blockId": _block_id()}}]
            cells.append({"type": "tableCell", "attrs": {}, "content": cell_content})
        rows.append({"type": "tableRow", "content": cells})

    return {"type": "table", "attrs": {"blockId": _block_id()}, "content": rows}


def _group_list_items(blocks: list[dict]) -> list[dict]:
    """Wrap consecutive _list_type paragraphs into bulletList nodes."""
    result: list[dict] = []
    i = 0
    while i < len(blocks):
        block = blocks[i]
        if block.get("_list_type"):
            items: list[dict] = []
            while i < len(blocks) and blocks[i].get("_list_type"):
                b = {k: v for k, v in blocks[i].items() if k != "_list_type"}
                items.append({"type": "listItem", "content": [b]})
                i += 1
            result.append({
                "type": "bulletList",
                "attrs": {"blockId": _block_id()},
                "content": items,
            })
        else:
            block.pop("_list_type", None)
            result.append(block)
            i += 1
    return result
