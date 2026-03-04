from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from app.config import DATA_DIR

DEMO_USERS = [
    {"id": "user-alice", "name": "Alice Chen", "email": "alice@demo.com", "color": "#3B82F6"},
    {"id": "user-bob", "name": "Bob Martinez", "email": "bob@demo.com", "color": "#EF4444"},
    {"id": "user-carol", "name": "Carol Kim", "email": "carol@demo.com", "color": "#10B981"},
    {"id": "user-dave", "name": "Dave Patel", "email": "dave@demo.com", "color": "#F59E0B"},
]

_USERS_BY_ID = {u["id"]: u for u in DEMO_USERS}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _doc_dir(doc_id: str) -> Path:
    return DATA_DIR / "documents" / doc_id


def _read_json(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def get_users() -> list[dict]:
    return list(DEMO_USERS)


def get_user(user_id: str) -> dict | None:
    return _USERS_BY_ID.get(user_id)


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

def create_document(
    title: str,
    created_by: str,
    content: dict | None = None,
) -> dict:
    doc_id = str(uuid.uuid4())
    now = time.time()

    meta = {
        "id": doc_id,
        "title": title,
        "created_by": created_by,
        "status": "draft",
        "created_at": now,
        "updated_at": now,
    }

    doc_path = _doc_dir(doc_id)
    _write_json(doc_path / "meta.json", meta)
    _write_json(doc_path / "comments.json", [])

    if content is not None:
        save_version(doc_id, content, created_by, "Initial version")

    return meta


def list_documents() -> list[dict]:
    docs_root = DATA_DIR / "documents"
    if not docs_root.exists():
        return []
    results: list[dict] = []
    for child in sorted(docs_root.iterdir()):
        meta_path = child / "meta.json"
        if meta_path.exists():
            results.append(_read_json(meta_path))
    results.sort(key=lambda d: d.get("updated_at", 0), reverse=True)
    return results


def get_document(doc_id: str) -> dict | None:
    meta_path = _doc_dir(doc_id) / "meta.json"
    if not meta_path.exists():
        return None
    return _read_json(meta_path)


def delete_document(doc_id: str) -> bool:
    doc_path = _doc_dir(doc_id)
    if not doc_path.exists():
        return False
    shutil.rmtree(doc_path)
    return True


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------

def _versions_dir(doc_id: str) -> Path:
    return _doc_dir(doc_id) / "versions"


def _next_version_number(doc_id: str) -> int:
    vdir = _versions_dir(doc_id)
    if not vdir.exists():
        return 1
    existing = [
        int(p.stem.lstrip("v"))
        for p in vdir.glob("v*.json")
        if p.stem.lstrip("v").isdigit()
    ]
    return max(existing, default=0) + 1


def save_version(
    doc_id: str,
    content: dict,
    author_id: str,
    message: str = "",
) -> dict:
    num = _next_version_number(doc_id)
    version_id = f"v{num}"
    now = time.time()

    version_data = {
        "meta": {
            "version_id": version_id,
            "version_number": num,
            "author_id": author_id,
            "message": message,
            "created_at": now,
        },
        "content": content,
    }

    _write_json(_versions_dir(doc_id) / f"{version_id}.json", version_data)

    # Touch document updated_at
    meta_path = _doc_dir(doc_id) / "meta.json"
    if meta_path.exists():
        meta = _read_json(meta_path)
        meta["updated_at"] = now
        _write_json(meta_path, meta)

    return version_data["meta"]


def get_latest_content(doc_id: str) -> dict | None:
    vdir = _versions_dir(doc_id)
    if not vdir.exists():
        return None
    files = sorted(vdir.glob("v*.json"))
    if not files:
        return None
    data = _read_json(files[-1])
    return data.get("content")


def list_versions(doc_id: str) -> list[dict]:
    vdir = _versions_dir(doc_id)
    if not vdir.exists():
        return []
    results: list[dict] = []
    for p in sorted(vdir.glob("v*.json")):
        data = _read_json(p)
        results.append(data["meta"])
    return results


def get_version(doc_id: str, version_id: str) -> dict | None:
    path = _versions_dir(doc_id) / f"{version_id}.json"
    if not path.exists():
        return None
    return _read_json(path)


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

def _images_dir(doc_id: str) -> Path:
    return _doc_dir(doc_id) / "images"


def save_image(doc_id: str, filename: str, data: bytes, mime_type: str) -> str:
    img_dir = _images_dir(doc_id)
    img_dir.mkdir(parents=True, exist_ok=True)
    (img_dir / filename).write_bytes(data)
    # Store mime type alongside
    meta_path = img_dir / f"{filename}.meta"
    meta_path.write_text(mime_type, encoding="utf-8")
    return filename


def get_image(doc_id: str, filename: str) -> tuple[bytes, str] | None:
    img_path = _images_dir(doc_id) / filename
    if not img_path.exists():
        return None
    meta_path = _images_dir(doc_id) / f"{filename}.meta"
    mime_type = "image/png"
    if meta_path.exists():
        mime_type = meta_path.read_text(encoding="utf-8").strip()
    return img_path.read_bytes(), mime_type


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

def _comments_path(doc_id: str) -> Path:
    return _doc_dir(doc_id) / "comments.json"


def get_comments(doc_id: str) -> list[dict]:
    path = _comments_path(doc_id)
    if not path.exists():
        return []
    return _read_json(path)


def add_comment(
    doc_id: str,
    anchor: dict | None,
    body: str,
    author_id: str,
    thread_id: str | None = None,
) -> dict:
    comments = get_comments(doc_id)
    now = time.time()
    comment = {
        "id": str(uuid.uuid4()),
        "thread_id": thread_id or str(uuid.uuid4()),
        "anchor": anchor,
        "body": body,
        "author_id": author_id,
        "resolved": False,
        "created_at": now,
        "updated_at": now,
    }
    comments.append(comment)
    _write_json(_comments_path(doc_id), comments)
    return comment


def update_comment(
    doc_id: str,
    comment_id: str,
    body: str | None = None,
    resolved: bool | None = None,
) -> dict | None:
    comments = get_comments(doc_id)
    for c in comments:
        if c["id"] == comment_id:
            if body is not None:
                c["body"] = body
            if resolved is not None:
                c["resolved"] = resolved
            c["updated_at"] = time.time()
            _write_json(_comments_path(doc_id), comments)
            return c
    return None


def delete_comment(doc_id: str, comment_id: str) -> bool:
    comments = get_comments(doc_id)
    new_comments = [c for c in comments if c["id"] != comment_id]
    if len(new_comments) == len(comments):
        return False
    _write_json(_comments_path(doc_id), new_comments)
    return True
