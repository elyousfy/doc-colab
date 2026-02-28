from copy import deepcopy
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, File

from app import storage
from app.routers.auth import get_current_user
from app.services.docling_parser import parse_with_docling
from app.services.docx_parser import parse_docx

router = APIRouter(prefix="/api/documents", tags=["upload"])


@router.post("/upload")
async def upload_docx(
    request: Request,
    file: UploadFile = File(...),
    parser: Literal["auto", "legacy", "docling"] = Query(default="auto"),
):
    user = get_current_user(request)
    return await _upload_with_parser(request, user["id"], file, parser)


@router.post("/upload-docling")
async def upload_with_docling(request: Request, file: UploadFile = File(...)):
    user = get_current_user(request)
    return await _upload_with_parser(request, user["id"], file, "docling")


async def _upload_with_parser(
    request: Request,
    user_id: str,
    file: UploadFile,
    parser: Literal["auto", "legacy", "docling"],
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    filename = file.filename
    lower = filename.lower()
    file_bytes = await file.read()

    parser_used = _resolve_parser(parser, lower)
    if parser_used == "legacy" and not lower.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Legacy parser supports only .docx")

    if parser_used == "docling" and not _is_docling_supported_filename(filename):
        raise HTTPException(status_code=400, detail="Unsupported file type for Docling import")

    try:
        if parser_used == "legacy":
            content, images = parse_docx(file_bytes)
            version_message = "Uploaded from DOCX (legacy parser)"
        elif parser_used == "hybrid":
            from app.services.color_enricher import build_color_map, enrich_tiptap_with_colors
            content, images = parse_with_docling(file_bytes, filename)
            color_map = build_color_map(file_bytes)
            enrich_tiptap_with_colors(content, color_map)
            version_message = "Uploaded from DOCX (docling + color enrichment)"
        else:
            content, images = parse_with_docling(file_bytes, filename)
            version_message = "Uploaded with Docling"
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        prefix = "DOCX parser" if parser_used == "legacy" else "Docling parser"
        raise HTTPException(status_code=422, detail=f"Failed with {prefix}: {e}")

    title = filename.rsplit(".", 1)[0]
    doc = storage.create_document(title, user_id)
    doc_id = doc["id"]

    for img in images:
        storage.save_image(doc_id, img["filename"], img["data"], img["mime_type"])

    _replace_image_placeholders(content, doc_id)

    storage.save_version(doc_id, content, user_id, version_message)

    return {
        "id": doc["id"],
        "title": doc["title"],
        "images_count": len(images),
        "parser_used": parser_used,
    }


def _resolve_parser(
    parser: Literal["auto", "legacy", "docling"], lower_filename: str
) -> Literal["legacy", "docling", "hybrid"]:
    if parser == "legacy":
        return "legacy"
    if parser == "docling":
        return "docling"
    # auto mode: hybrid for DOCX fidelity + structure, Docling for all else.
    if lower_filename.endswith(".docx"):
        return "hybrid"
    return "docling"


def _merge_hybrid_docx_content(
    legacy_content: dict,
    docling_content: dict,
    docling_images: list[dict],
) -> dict:
    legacy_blocks = deepcopy(legacy_content.get("content", []))
    docling_blocks = deepcopy(docling_content.get("content", []))

    header_blocks = _extract_sections(legacy_blocks, "header")
    footer_blocks = _extract_sections(legacy_blocks, "footer")

    body_blocks: list[dict] = []
    for block in docling_blocks:
        if block.get("type") == "image":
            continue
        if block.get("type") == "heading":
            text = _block_text(block).strip().lower()
            if text == "imported images":
                continue
        body_blocks.append(block)

    positioned_images = _docling_images_to_positioned_nodes(docling_images)
    if positioned_images:
        body_blocks.append(
            {
                "type": "pageCanvas",
                "attrs": {
                    "blockId": _new_block_id(),
                    "width": 816,
                    "height": max(1200, 240 * len(positioned_images)),
                    "grid": 8,
                },
                "content": positioned_images,
            }
        )

    merged: list[dict] = []
    merged.extend(header_blocks)
    merged.extend(body_blocks)
    merged.extend(footer_blocks)
    return {"type": "doc", "content": merged}


def _extract_sections(blocks: list[dict], section_type: str) -> list[dict]:
    out: list[dict] = []
    for block in blocks:
        if block.get("type") != "docSection":
            continue
        attrs = block.get("attrs", {})
        if attrs.get("sectionType") == section_type:
            out.append(block)
    return out


def _new_block_id() -> str:
    import uuid

    return str(uuid.uuid4())


def _block_text(block: dict) -> str:
    content = block.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            parts.append(item.get("text") or "")
    return " ".join(parts)


def _docling_images_to_positioned_nodes(images: list[dict]) -> list[dict]:
    nodes: list[dict] = []
    y = 24.0
    x = 24.0
    max_width = 760.0

    for i, img in enumerate(images):
        filename = img.get("filename")
        if not filename:
            continue

        # Approximate size defaults; preserve source dimensions when available.
        w = 520.0
        h = 300.0
        node = {
            "type": "positionedImage",
            "attrs": {
                "blockId": _new_block_id(),
                "src": f"__IMAGE__{filename}",
                "alt": "",
                "title": None,
                "x": x,
                "y": y,
                "width": min(max_width, w),
                "height": h,
                "zIndex": i + 1,
                "locked": False,
            },
        }
        nodes.append(node)
        y += h + 20.0
    return nodes


def _is_docling_supported_filename(filename: str) -> bool:
    lower = filename.lower()
    return lower.endswith(
        (
            ".pdf",
            ".docx",
            ".doc",
            ".pptx",
            ".html",
            ".htm",
            ".md",
            ".txt",
            ".jpg",
            ".jpeg",
            ".png",
            ".tiff",
        )
    )


def _replace_image_placeholders(content: dict, doc_id: str) -> None:
    """Walk the content tree and replace __IMAGE__{filename} with real URLs."""
    nodes = content.get("content", [])
    _walk_and_replace(nodes, doc_id)


def _walk_and_replace(nodes: list, doc_id: str) -> None:
    for node in nodes:
        if node.get("type") in ("image", "positionedImage"):
            attrs = node.get("attrs", {})
            src = attrs.get("src", "")
            if src.startswith("__IMAGE__"):
                filename = src.replace("__IMAGE__", "")
                attrs["src"] = f"/api/documents/{doc_id}/images/{filename}"
        children = node.get("content", [])
        if children:
            _walk_and_replace(children, doc_id)
