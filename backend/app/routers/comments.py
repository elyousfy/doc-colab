from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app import storage
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/documents", tags=["comments"])


class AddCommentBody(BaseModel):
    anchor: dict | None = None
    body: str
    thread_id: str | None = None


class UpdateCommentBody(BaseModel):
    body: str | None = None
    resolved: bool | None = None


@router.get("/{doc_id}/comments")
async def list_comments(doc_id: str):
    doc = storage.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return storage.get_comments(doc_id)


@router.post("/{doc_id}/comments")
async def add_comment(doc_id: str, body: AddCommentBody, request: Request):
    doc = storage.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    user = get_current_user(request)
    comment = storage.add_comment(
        doc_id,
        anchor=body.anchor,
        body=body.body,
        author_id=user["id"],
        thread_id=body.thread_id,
    )
    return comment


@router.patch("/{doc_id}/comments/{comment_id}")
async def update_comment(doc_id: str, comment_id: str, body: UpdateCommentBody):
    doc = storage.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    comment = storage.update_comment(
        doc_id,
        comment_id,
        body=body.body,
        resolved=body.resolved,
    )
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment


@router.delete("/{doc_id}/comments/{comment_id}")
async def delete_comment(doc_id: str, comment_id: str):
    doc = storage.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if not storage.delete_comment(doc_id, comment_id):
        raise HTTPException(status_code=404, detail="Comment not found")
    return {"ok": True}
