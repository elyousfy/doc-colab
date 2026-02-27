"""Parse documents with Docling JSON and map to Tiptap JSON."""

from __future__ import annotations

import base64
import os
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


def parse_with_docling(file_bytes: bytes, filename: str) -> tuple[dict, list[dict]]:
    """Convert an arbitrary file with Docling and map to Tiptap blocks."""
    try:
        from docling.document_converter import DocumentConverter
    except ImportError as exc:
        raise RuntimeError(
            "Docling is not installed. Install backend dependencies to enable Docling import."
        ) from exc

    suffix = os.path.splitext(filename)[1] if filename else ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        converter = DocumentConverter()
        result = converter.convert(tmp_path)
        data = result.document.export_to_dict()
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    content, images = _docling_json_to_tiptap(data, doc=result.document)
    return content, images


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
    # BOTTOMLEFT: y increases upward, higher t = closer to top, so negate for ascending sort
    # TOPLEFT: y increases downward, lower t = closer to top, use as-is
    y_from_top = -t if origin == "BOTTOMLEFT" else t
    return (page, y_from_top)


def _has_prov_data(data: dict) -> bool:
    """Return True if any item in the document has provenance data."""
    for collection_key in ("texts", "pictures", "tables"):
        for item in data.get(collection_key, []):
            if item.get("prov"):
                return True
    return False


def _docling_json_to_tiptap(data: dict, doc=None) -> tuple[dict, list[dict]]:
    """Convert docling export_to_dict() output to Tiptap JSON using provenance-based reading order.

    When provenance data (prov) is available (e.g. PDF), sorts ALL items by
    (page_no, y_from_top) for correct reading order with images inline.

    When provenance data is absent (e.g. DOCX), uses doc.iterate_items() which
    already yields items in correct document reading order.
    """
    if doc is not None and not _has_prov_data(data):
        return _docling_json_to_tiptap_via_iterate(data, doc)
    return _docling_json_to_tiptap_via_prov(data)


def _extract_images_from_dict(pictures: list[dict]) -> tuple[dict[str, dict], list[dict]]:
    """Extract image blobs and build picture_nodes mapping from export_to_dict pictures list.

    Returns:
        picture_nodes: self_ref -> {"node": tiptap_node}
        images: list of {"filename", "data", "mime_type"} dicts
    """
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

        picture_nodes[pic_ref] = {"node": {"type": "image", "attrs": attrs}}

    return picture_nodes, images


def _docling_json_to_tiptap_via_iterate(data: dict, doc) -> tuple[dict, list[dict]]:
    """Use doc.iterate_items() for reading order (DOCX path — no prov data)."""
    try:
        from docling_core.types.doc.document import (
            TextItem,
            TableItem,
            PictureItem,
            SectionHeaderItem,
            ListItem,
        )
    except ImportError:
        # If types unavailable, fall back to prov path
        return _docling_json_to_tiptap_via_prov(data)

    # Pre-build picture_nodes and images from the exported dict (has base64 data)
    pictures = data.get("pictures", [])
    picture_nodes, images = _extract_images_from_dict(pictures)

    raw_blocks: list[dict] = []

    for item, _level in doc.iterate_items():
        if isinstance(item, PictureItem):
            ref = item.self_ref
            if ref in picture_nodes:
                raw_blocks.append(picture_nodes[ref]["node"])

        elif isinstance(item, TableItem):
            # Map table via its dict representation
            ref = item.self_ref
            # Extract index from self_ref like "#/tables/3"
            try:
                idx = int(ref.split("/")[-1])
                table_dict = data.get("tables", [])[idx]
            except (ValueError, IndexError):
                table_dict = None
            if table_dict:
                tbl = _map_table(table_dict)
                if tbl:
                    raw_blocks.append(tbl)

        elif isinstance(item, (TextItem, SectionHeaderItem, ListItem)):
            ref = item.self_ref
            # Extract index from self_ref like "#/texts/5"
            try:
                idx = int(ref.split("/")[-1])
                text_dict = data.get("texts", [])[idx]
            except (ValueError, IndexError):
                text_dict = None
            if text_dict:
                node = _map_text_item(text_dict)
                if node:
                    raw_blocks.append(node)

    blocks = _group_list_items(raw_blocks)

    if not blocks:
        blocks = [{"type": "paragraph", "attrs": {"blockId": _block_id()}}]

    return {"type": "doc", "content": blocks}, images


def _docling_json_to_tiptap_via_prov(data: dict) -> tuple[dict, list[dict]]:
    """Sort ALL items by (page_no, y_from_top) provenance for correct reading order (PDF path)."""
    texts = data.get("texts", [])
    tables = data.get("tables", [])
    pictures = data.get("pictures", [])

    # --- Extract images and build picture nodes ---
    picture_nodes: dict[str, dict] = {}  # self_ref -> {"node": tiptap_node, "prov_item": pic}
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

    # --- Build flat list of all content items ---
    all_items: list[dict] = []

    for item in texts:
        all_items.append({"_kind": "text", "_item": item})

    for item in tables:
        all_items.append({"_kind": "table", "_item": item})

    for ref, data_dict in picture_nodes.items():
        all_items.append({"_kind": "picture", "_item": data_dict["prov_item"], "_node": data_dict["node"]})

    # Sort by (page_no, y_from_top) — true reading order
    all_items.sort(key=lambda x: _get_sort_key(x["_item"]))

    # --- Emit blocks in reading order ---
    raw_blocks: list[dict] = []

    for entry in all_items:
        kind = entry["_kind"]
        item = entry["_item"]

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

    # Group consecutive list items into bulletList/orderedList wrappers
    blocks = _group_list_items(raw_blocks)

    if not blocks:
        blocks = [{"type": "paragraph", "attrs": {"blockId": _block_id()}}]

    return {"type": "doc", "content": blocks}, images


def _map_text_item(item: dict) -> dict | None:
    """Map a single docling text item to a Tiptap node."""
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

    # Font info (field names vary by docling version — try common variants)
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

    # Text alignment
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
    """Map a docling table item to a Tiptap table node."""
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
