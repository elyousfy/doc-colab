from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app import storage

router = APIRouter(prefix="/api/documents", tags=["images"])


@router.get("/{doc_id}/images/{filename}")
async def get_image(doc_id: str, filename: str):
    doc = storage.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    result = storage.get_image(doc_id, filename)
    if result is None:
        raise HTTPException(status_code=404, detail="Image not found")

    data, mime_type = result
    return Response(content=data, media_type=mime_type)
