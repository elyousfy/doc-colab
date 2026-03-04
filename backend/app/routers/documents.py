from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app import storage
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/documents", tags=["documents"])


class CreateDocumentBody(BaseModel):
    title: str
    content: dict | None = None


class SaveContentBody(BaseModel):
    content: dict
    message: str = ""


@router.get("")
async def list_documents():
    return storage.list_documents()


@router.post("")
async def create_document(body: CreateDocumentBody, request: Request):
    user = get_current_user(request)
    doc = storage.create_document(body.title, user["id"], body.content)
    return doc


@router.get("/{doc_id}")
async def get_document(doc_id: str):
    doc = storage.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.delete("/{doc_id}")
async def delete_document(doc_id: str):
    if not storage.delete_document(doc_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True}


@router.get("/{doc_id}/content")
async def get_content(doc_id: str):
    doc = storage.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    content = storage.get_latest_content(doc_id)
    return {"content": content}


@router.post("/{doc_id}/content")
async def save_content(doc_id: str, body: SaveContentBody, request: Request):
    doc = storage.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    user = get_current_user(request)
    version_meta = storage.save_version(doc_id, body.content, user["id"], body.message)
    return version_meta


@router.get("/{doc_id}/versions")
async def list_versions(doc_id: str):
    doc = storage.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return storage.list_versions(doc_id)


@router.get("/{doc_id}/versions/{version_id}")
async def get_version(doc_id: str, version_id: str):
    doc = storage.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    version = storage.get_version(doc_id, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return version
