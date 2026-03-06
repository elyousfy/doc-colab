from fastapi import APIRouter, HTTPException, Request, UploadFile, File

from app import storage
from app.routers.auth import get_current_user
from app.services.docling_parser import parse_with_docling

router = APIRouter(prefix="/api/documents", tags=["upload"])


@router.post("/upload")
async def upload_document(request: Request, file: UploadFile = File(...)):
    user = get_current_user(request)

    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    filename = file.filename
    file_bytes = await file.read()

    if not _is_docling_supported_filename(filename):
        raise HTTPException(status_code=400, detail="Unsupported file type")

    try:
        content, images = parse_with_docling(file_bytes, filename)
        if filename.lower().endswith(".docx"):
            from app.services.color_enricher import build_color_map, enrich_tiptap_with_colors
            color_map = build_color_map(file_bytes)
            enrich_tiptap_with_colors(content, color_map)
    except RuntimeError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse document: {e}")

    title = filename.rsplit(".", 1)[0]
    doc = storage.create_document(title, user["id"])
    doc_id = doc["id"]

    for img in images:
        storage.save_image(doc_id, img["filename"], img["data"], img["mime_type"])

    _replace_image_placeholders(content, doc_id)
    storage.save_version(doc_id, content, user["id"], "Uploaded")

    return {"id": doc["id"], "title": doc["title"], "images_count": len(images)}


def _is_docling_supported_filename(filename: str) -> bool:
    lower = filename.lower()
    return lower.endswith((
        ".pdf", ".docx", ".doc", ".pptx",
        ".html", ".htm", ".md", ".txt",
        ".jpg", ".jpeg", ".png", ".tiff",
    ))


def _replace_image_placeholders(content: dict, doc_id: str) -> None:
    _walk_and_replace(content.get("content", []), doc_id)


def _walk_and_replace(nodes: list, doc_id: str) -> None:
    for node in nodes:
        if node.get("type") in ("image", "positionedImage"):
            src = node.get("attrs", {}).get("src", "")
            if src.startswith("__IMAGE__"):
                node["attrs"]["src"] = f"/api/documents/{doc_id}/images/{src[len('__IMAGE__'):]}"
        if node.get("content"):
            _walk_and_replace(node["content"], doc_id)
