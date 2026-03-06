"""Parse documents with Docling and map to Tiptap JSON."""

from __future__ import annotations

import base64
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
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.datamodel.base_models import InputFormat
    except ImportError as exc:
        raise RuntimeError(
            "Docling is not installed. Install backend dependencies to enable Docling import."
        ) from exc

    suffix = os.path.splitext(filename)[1].lower() if filename else ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        pipeline_options = PdfPipelineOptions()
        pipeline_options.generate_picture_images = True
        pipeline_options.images_scale = 2.0
        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
            }
        )
        result = converter.convert(tmp_path)
        doc = result.document
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    if suffix in _NO_PROV_EXTENSIONS:
        doc_json, images = _tiptap_via_markdown(doc)
        header_blocks, footer_blocks, hf_images = _extract_docx_header_footer(file_bytes)
        images = hf_images + images
        content = doc_json["content"]
        if header_blocks:
            content.insert(0, {
                "type": "docSection",
                "attrs": {"blockId": _block_id(), "sectionType": "header"},
                "content": header_blocks,
            })
        if footer_blocks:
            content.append({
                "type": "docSection",
                "attrs": {"blockId": _block_id(), "sectionType": "footer"},
                "content": footer_blocks,
            })
        return doc_json, images

    data = doc.export_to_dict()
    return _tiptap_via_prov(data, doc=doc)


# ---------------------------------------------------------------------------
# DOCX path: export_to_markdown() → Tiptap
# ---------------------------------------------------------------------------

_MD_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")
_MD_TABLE_ROW_RE = re.compile(r"^\|.*\|$")
_MD_TABLE_SEP_RE = re.compile(r"^\|[\s\-:|]+\|$")
_MD_LIST_RE = re.compile(r"^[\-\*\+]\s+(.+)$")
_MD_IMG_RE = re.compile(r"!\[[^\]]*\]\([^\)]*\)")
_MD_STANDALONE_IMG_RE = re.compile(r"^!\[[^\]]*\]\(([^\)]*)\)\s*$")
_TOC_PAGE_NUM_RE = re.compile(r"[\t ]{2,}\d{1,4}\s*$")
_MD_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_MD_ITALIC_RE = re.compile(r"\*(.+?)\*")


def _strip_toc_page_number(text: str) -> str:
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
        if bm and (not im or bm.start() <= im.start()):
            if bm.start() > 0:
                nodes.append({"type": "text", "text": text[: bm.start()]})
            nodes.append({"type": "text", "text": bm.group(1), "marks": [{"type": "bold"}]})
            text = text[bm.end():]
        elif im:
            if im.start() > 0:
                nodes.append({"type": "text", "text": text[: im.start()]})
            nodes.append({"type": "text", "text": im.group(1), "marks": [{"type": "italic"}]})
            text = text[im.end():]
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


def _make_image_node(src: str, pictures: list, pic_idx: int, doc, images: list) -> dict | None:
    """Create a Tiptap image node from a markdown image src, extracting blob and dimensions."""
    blob = None
    mime = "image/png"

    if src.startswith("data:") and ";base64," in src:
        header, b64_data = src.split(";base64,", 1)
        mime = header.replace("data:", "").strip() or "image/png"
        try:
            blob = base64.b64decode(b64_data)
        except Exception:
            pass

    if blob is None and pic_idx < len(pictures):
        try:
            pic = pictures[pic_idx]
            uri = str(pic.image.uri) if pic.image else ""
            if uri.startswith("data:") and ";base64," in uri:
                header, b64_data = uri.split(";base64,", 1)
                mime = header.replace("data:", "").strip() or "image/png"
                blob = base64.b64decode(b64_data)
        except Exception:
            pass

    if not blob:
        return None

    ext = _MIME_EXT.get(mime, ".png")
    filename = f"docling_img_{len(images)}{ext}"
    images.append({"filename": filename, "data": blob, "mime_type": mime})

    attrs: dict = {
        "blockId": _block_id(),
        "src": f"__IMAGE__{filename}",
        "alt": "",
        "title": None,
    }

    if pic_idx < len(pictures):
        try:
            pic = pictures[pic_idx]
            prov_list = pic.prov or []
            if prov_list:
                prov = prov_list[0]
                page = (doc.pages or {}).get(prov.page_no)
                if page and page.size and page.size.width:
                    bbox = prov.bbox.to_top_left_origin(page_height=page.size.height)
                    w_frac = (bbox.r - bbox.l) / float(page.size.width)
                    if 0 < w_frac <= 1:
                        attrs["width"] = round(w_frac * 816)
        except Exception:
            pass

    return {"type": "image", "attrs": attrs}


def _tiptap_via_markdown(doc) -> tuple[dict, list[dict]]:
    """Build Tiptap JSON from docling's markdown export (DOCX/PPTX path)."""
    try:
        from docling_core.types.doc import ImageRefMode
        md_text = doc.export_to_markdown(image_mode=ImageRefMode.EMBEDDED)
    except Exception:
        try:
            md_text = doc.export_to_markdown()
        except Exception:
            data = doc.export_to_dict()
            return _tiptap_via_prov(data, doc=doc)

    pictures = list(getattr(doc, "pictures", []))
    pic_idx = 0
    images: list[dict] = []

    lines = md_text.split("\n")
    blocks: list[dict] = []
    i = 0

    while i < len(lines):
        stripped = lines[i].strip()

        if not stripped:
            i += 1
            continue

        # Standalone image
        sim = _MD_STANDALONE_IMG_RE.match(stripped)
        if sim:
            img_node = _make_image_node(sim.group(1), pictures, pic_idx, doc, images)
            if img_node:
                blocks.append(img_node)
            pic_idx += 1
            i += 1
            continue

        # Heading
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

        # Table
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

        # Paragraph
        para_lines: list[str] = []
        while i < len(lines):
            s = lines[i].strip()
            if not s:
                break
            if (_MD_HEADING_RE.match(s) or _MD_TABLE_ROW_RE.match(s) or
                    _MD_LIST_RE.match(s) or _MD_STANDALONE_IMG_RE.match(s)):
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

    return {"type": "doc", "content": blocks}, images


# ---------------------------------------------------------------------------
# Header / Footer extraction via python-docx
# ---------------------------------------------------------------------------

_EMU_TO_PT = 72.0 / 914400.0
_EDITOR_WIDTH_PX = 816


def _extract_docx_header_footer(
    file_bytes: bytes,
) -> tuple[list[dict], list[dict], list[dict]]:
    """Extract header/footer content from a DOCX using python-docx.

    Returns (header_blocks, footer_blocks, images).
    Images use the same __IMAGE__{filename} placeholder convention.
    """
    try:
        from docx import Document as DocxDocument
        from docx.oxml.ns import qn
        import io
    except ImportError:
        return [], [], []

    try:
        docx = DocxDocument(io.BytesIO(file_bytes))
    except Exception:
        return [], [], []

    images: list[dict] = []

    def _parse_part(part) -> list[dict]:
        """Convert a header/footer part's paragraphs to Tiptap blocks."""
        if part is None:
            return []
        blocks: list[dict] = []
        for para in part.paragraphs:
            # Collect inline images from this paragraph
            inline_images = _extract_para_images(para, part, images)
            for img_node in inline_images:
                blocks.append(img_node)

            text = para.text.strip()
            if not text:
                continue
            blocks.append({
                "type": "paragraph",
                "attrs": {"blockId": _block_id()},
                "content": [{"type": "text", "text": text}],
            })
        return blocks

    def _extract_para_images(para, part, img_list: list) -> list[dict]:
        """Extract inline images from a paragraph as Tiptap image nodes."""
        nodes: list[dict] = []
        try:
            drawings = para._p.findall(".//" + qn("w:drawing"))
            for drawing in drawings:
                # Get image relationship id
                blip = drawing.find(".//" + qn("a:blip"))
                if blip is None:
                    continue
                r_embed = blip.get(qn("r:embed"))
                if not r_embed:
                    continue
                try:
                    img_part = part.part.rels[r_embed].target_part
                    blob = img_part.blob
                    mime = img_part.content_type or "image/png"
                except Exception:
                    continue

                ext = _MIME_EXT.get(mime, ".png")
                filename = f"docling_img_hf_{len(img_list)}{ext}"
                img_list.append({"filename": filename, "data": blob, "mime_type": mime})

                attrs: dict = {
                    "blockId": _block_id(),
                    "src": f"__IMAGE__{filename}",
                    "alt": "",
                    "title": None,
                }

                # Get display width from EMU extent
                extent = drawing.find(".//" + qn("wp:extent"))
                if extent is not None:
                    cx = extent.get("cx")
                    if cx:
                        try:
                            width_pt = int(cx) * _EMU_TO_PT
                            # Scale to editor: assume standard page width 468pt (6.5in body)
                            w_frac = width_pt / 468.0
                            attrs["width"] = round(min(w_frac, 1.0) * _EDITOR_WIDTH_PX)
                        except Exception:
                            pass

                nodes.append({"type": "image", "attrs": attrs})
        except Exception:
            pass
        return nodes

    header_blocks: list[dict] = []
    footer_blocks: list[dict] = []

    seen_header: set[str] = set()
    seen_footer: set[str] = set()

    for section in docx.sections:
        h_blocks = _parse_part(section.header)
        for b in h_blocks:
            key = str(b)
            if key not in seen_header:
                seen_header.add(key)
                header_blocks.append(b)

        f_blocks = _parse_part(section.footer)
        for b in f_blocks:
            key = str(b)
            if key not in seen_footer:
                seen_footer.add(key)
                footer_blocks.append(b)

    return header_blocks, footer_blocks, images


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


def _tiptap_via_prov(data: dict, doc=None) -> tuple[dict, list[dict]]:
    """Sort ALL items by (page_no, y_from_top) provenance for correct reading order (PDF path)."""
    texts = data.get("texts", [])
    tables = data.get("tables", [])
    pictures = data.get("pictures", [])

    doc_pages = {}
    if doc and doc.pages:
        doc_pages = doc.pages

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

        attrs: dict = {
            "blockId": _block_id(),
            "src": f"__IMAGE__{filename}",
            "alt": "",
            "title": None,
        }

        # Compute scale-correct display width from bbox relative to page width
        prov_list = pic.get("prov") or []
        if prov_list and doc_pages:
            try:
                prov = prov_list[0]
                page_no = prov.get("page_no")
                bbox = prov.get("bbox") or {}
                page = doc_pages.get(page_no)
                if page and page.size and page.size.width:
                    l = float(bbox.get("l", 0))
                    r = float(bbox.get("r", 0))
                    origin = bbox.get("coord_origin", "BOTTOMLEFT")
                    img_w = abs(r - l)
                    w_frac = img_w / float(page.size.width)
                    if 0 < w_frac <= 1:
                        attrs["width"] = round(w_frac * 816)
            except Exception:
                pass

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
