from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app import storage
from app.services.docx_builder import build_docx

router = APIRouter(prefix="/api/documents", tags=["export"])


@router.post("/{doc_id}/export")
async def export_document(doc_id: str):
    doc = storage.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    content = storage.get_latest_content(doc_id)
    if content is None:
        raise HTTPException(status_code=404, detail="No content to export")

    images: dict[str, bytes] = {}
    _collect_image_sources(content, doc_id, images)

    docx_bytes = build_docx(content, images)

    filename = f"{doc['title']}.docx"
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _collect_image_sources(content: dict, doc_id: str, images: dict[str, bytes]) -> None:
    """Walk content tree and collect image data keyed by src URL."""
    for node in content.get("content", []):
        _walk_collect_images(node, doc_id, images)


def _walk_collect_images(node: dict, doc_id: str, images: dict[str, bytes]) -> None:
    if node.get("type") == "image":
        src = node.get("attrs", {}).get("src", "")
        if src and src not in images:
            # Extract filename from URL like /api/documents/{id}/images/{filename}
            parts = src.rstrip("/").split("/")
            if len(parts) >= 2 and parts[-2] == "images":
                filename = parts[-1]
                result = storage.get_image(doc_id, filename)
                if result:
                    images[src] = result[0]
    for child in node.get("content", []):
        _walk_collect_images(child, doc_id, images)
