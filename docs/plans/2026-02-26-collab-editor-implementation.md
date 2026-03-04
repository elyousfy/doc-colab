# Collaborative Document Editor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a PandaDocs-class document editor with DOCX import/export, rich text editing via Tiptap, comments, and version history.

**Architecture:** React + Tiptap frontend talks to a FastAPI backend over REST. Documents stored as JSON files on disk. DOCX import/export via python-docx. No database, no Docker, no real-time collab.

**Tech Stack:** React, Vite, Tiptap, Tailwind CSS, Zustand, FastAPI, python-docx.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/app/config.py`
- Create: `backend/app/storage.py`

**Step 1: Create backend/requirements.txt**

```
fastapi[standard]
uvicorn[standard]
python-docx
python-multipart
```

**Step 2: Create backend/app/config.py**

```python
import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", "data"))
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
```

**Step 3: Create backend/app/storage.py**

File-system storage layer. All data lives under `data/`.

```python
import json
import os
import uuid
import time
from pathlib import Path
from app.config import DATA_DIR

DEMO_USERS = [
    {"id": "user-alice", "name": "Alice Chen", "email": "alice@demo.com", "color": "#3B82F6"},
    {"id": "user-bob", "name": "Bob Martinez", "email": "bob@demo.com", "color": "#EF4444"},
    {"id": "user-carol", "name": "Carol Kim", "email": "carol@demo.com", "color": "#10B981"},
    {"id": "user-dave", "name": "Dave Patel", "email": "dave@demo.com", "color": "#F59E0B"},
]

def _doc_dir(doc_id: str) -> Path:
    return DATA_DIR / "documents" / doc_id

def _ensure_dirs(doc_id: str):
    d = _doc_dir(doc_id)
    (d / "versions").mkdir(parents=True, exist_ok=True)
    (d / "images").mkdir(parents=True, exist_ok=True)

def get_users() -> list[dict]:
    return DEMO_USERS

def get_user(user_id: str) -> dict | None:
    return next((u for u in DEMO_USERS if u["id"] == user_id), None)

# --- Documents ---

def create_document(title: str, created_by: str, content: dict | None = None) -> dict:
    doc_id = str(uuid.uuid4())
    _ensure_dirs(doc_id)
    meta = {
        "id": doc_id,
        "title": title,
        "created_by": created_by,
        "status": "draft",
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    (_doc_dir(doc_id) / "meta.json").write_text(json.dumps(meta, indent=2))

    if content is None:
        content = {"type": "doc", "content": [{"type": "paragraph", "content": []}]}
    save_version(doc_id, content, created_by, "Created")

    comments = []
    (_doc_dir(doc_id) / "comments.json").write_text(json.dumps(comments, indent=2))
    return meta

def list_documents() -> list[dict]:
    docs_dir = DATA_DIR / "documents"
    if not docs_dir.exists():
        return []
    docs = []
    for d in docs_dir.iterdir():
        meta_path = d / "meta.json"
        if meta_path.exists():
            docs.append(json.loads(meta_path.read_text()))
    docs.sort(key=lambda x: x.get("updated_at", 0), reverse=True)
    return docs

def get_document(doc_id: str) -> dict | None:
    meta_path = _doc_dir(doc_id) / "meta.json"
    if not meta_path.exists():
        return None
    return json.loads(meta_path.read_text())

def delete_document(doc_id: str):
    import shutil
    d = _doc_dir(doc_id)
    if d.exists():
        shutil.rmtree(d)

# --- Versions ---

def save_version(doc_id: str, content: dict, author_id: str, message: str | None = None) -> dict:
    versions_dir = _doc_dir(doc_id) / "versions"
    existing = sorted(versions_dir.glob("v*.json"))
    next_num = len(existing) + 1
    version = {
        "id": next_num,
        "doc_id": doc_id,
        "author_id": author_id,
        "message": message,
        "created_at": time.time(),
    }
    version_file = versions_dir / f"v{next_num}.json"
    version_file.write_text(json.dumps({"meta": version, "content": content}, indent=2))

    # Update doc timestamp
    meta_path = _doc_dir(doc_id) / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        meta["updated_at"] = time.time()
        meta_path.write_text(json.dumps(meta, indent=2))
    return version

def get_latest_content(doc_id: str) -> dict | None:
    versions_dir = _doc_dir(doc_id) / "versions"
    if not versions_dir.exists():
        return None
    files = sorted(versions_dir.glob("v*.json"))
    if not files:
        return None
    data = json.loads(files[-1].read_text())
    return {"version_id": data["meta"]["id"], "content": data["content"]}

def list_versions(doc_id: str) -> list[dict]:
    versions_dir = _doc_dir(doc_id) / "versions"
    if not versions_dir.exists():
        return []
    versions = []
    for f in sorted(versions_dir.glob("v*.json"), reverse=True):
        data = json.loads(f.read_text())
        versions.append(data["meta"])
    return versions

def get_version(doc_id: str, version_id: int) -> dict | None:
    version_file = _doc_dir(doc_id) / "versions" / f"v{version_id}.json"
    if not version_file.exists():
        return None
    data = json.loads(version_file.read_text())
    return {"version_id": data["meta"]["id"], "content": data["content"], "created_at": data["meta"]["created_at"]}

# --- Images ---

def save_image(doc_id: str, filename: str, data: bytes, mime_type: str):
    _ensure_dirs(doc_id)
    (_doc_dir(doc_id) / "images" / filename).write_bytes(data)

def get_image(doc_id: str, filename: str) -> tuple[bytes, str] | None:
    path = _doc_dir(doc_id) / "images" / filename
    if not path.exists():
        return None
    ext = filename.rsplit(".", 1)[-1].lower()
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "bmp": "image/bmp"}.get(ext, "application/octet-stream")
    return path.read_bytes(), mime

# --- Comments ---

def get_comments(doc_id: str) -> list[dict]:
    path = _doc_dir(doc_id) / "comments.json"
    if not path.exists():
        return []
    return json.loads(path.read_text())

def _save_comments(doc_id: str, comments: list[dict]):
    (_doc_dir(doc_id) / "comments.json").write_text(json.dumps(comments, indent=2))

def add_comment(doc_id: str, anchor: dict, body: str, author_id: str, thread_id: str | None = None) -> dict:
    comments = get_comments(doc_id)
    comment = {
        "id": str(uuid.uuid4()),
        "doc_id": doc_id,
        "thread_id": thread_id,
        "anchor": anchor,
        "author_id": author_id,
        "body": body,
        "resolved": False,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    comments.append(comment)
    _save_comments(doc_id, comments)
    return comment

def update_comment(doc_id: str, comment_id: str, body: str | None = None, resolved: bool | None = None) -> dict | None:
    comments = get_comments(doc_id)
    for c in comments:
        if c["id"] == comment_id:
            if body is not None:
                c["body"] = body
            if resolved is not None:
                c["resolved"] = resolved
            c["updated_at"] = time.time()
            _save_comments(doc_id, comments)
            return c
    return None

def delete_comment(doc_id: str, comment_id: str) -> bool:
    comments = get_comments(doc_id)
    new_comments = [c for c in comments if c["id"] != comment_id]
    if len(new_comments) == len(comments):
        return False
    _save_comments(doc_id, new_comments)
    return True
```

**Step 4: Create backend/app/main.py**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import CORS_ORIGINS

app = FastAPI(title="Colab Doc API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

**Step 5: Verify backend starts**

Run: `cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload`
Hit: `GET http://localhost:8000/health`
Expected: `{"status": "ok"}`

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: project scaffolding with file-based storage, no database"
```

---

### Task 2: Backend — All API Routes

**Files:**
- Create: `backend/app/routers/__init__.py`
- Create: `backend/app/routers/auth.py`
- Create: `backend/app/routers/documents.py`
- Create: `backend/app/routers/upload.py`
- Create: `backend/app/routers/images.py`
- Create: `backend/app/routers/comments.py`
- Create: `backend/app/routers/export.py`

**Step 1: Create all routers**

`backend/app/routers/auth.py`:
```python
from fastapi import APIRouter, Request, HTTPException
from app import storage

router = APIRouter(prefix="/api", tags=["auth"])

def get_current_user(request) -> dict:
    user_id = request.headers.get("X-User-Id")
    if not user_id:
        raise HTTPException(401, "X-User-Id header required")
    user = storage.get_user(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user

@router.get("/users")
async def list_users():
    return storage.get_users()
```

`backend/app/routers/documents.py`:
```python
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from app import storage
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/documents", tags=["documents"])

class DocumentCreate(BaseModel):
    title: str

class ContentSave(BaseModel):
    content: dict
    message: str | None = None

@router.post("", status_code=201)
async def create_document(payload: DocumentCreate, request: Request):
    user = get_current_user(request)
    return storage.create_document(payload.title, user["id"])

@router.get("")
async def list_documents():
    return storage.list_documents()

@router.get("/{doc_id}")
async def get_document(doc_id: str):
    doc = storage.get_document(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    return doc

@router.delete("/{doc_id}", status_code=204)
async def delete_document(doc_id: str):
    storage.delete_document(doc_id)

@router.get("/{doc_id}/content")
async def get_content(doc_id: str):
    result = storage.get_latest_content(doc_id)
    if not result:
        raise HTTPException(404, "No content")
    return result

@router.post("/{doc_id}/content", status_code=201)
async def save_content(doc_id: str, payload: ContentSave, request: Request):
    user = get_current_user(request)
    version = storage.save_version(doc_id, payload.content, user["id"], payload.message)
    return {"version_id": version["id"]}

@router.get("/{doc_id}/versions")
async def list_versions(doc_id: str):
    return storage.list_versions(doc_id)

@router.get("/{doc_id}/versions/{version_id}")
async def get_version(doc_id: str, version_id: int):
    result = storage.get_version(doc_id, version_id)
    if not result:
        raise HTTPException(404, "Version not found")
    return result
```

`backend/app/routers/upload.py`:
```python
from fastapi import APIRouter, Request, UploadFile, File, HTTPException
from app import storage
from app.routers.auth import get_current_user
from app.services.docx_parser import parse_docx, post_process_lists

router = APIRouter(prefix="/api/documents", tags=["upload"])

@router.post("/upload", status_code=201)
async def upload_docx(request: Request, file: UploadFile = File(...)):
    user = get_current_user(request)
    if not file.filename.endswith((".docx", ".doc")):
        raise HTTPException(400, "Only .docx files supported")
    file_bytes = await file.read()
    if len(file_bytes) > 50 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 50MB)")

    content, images = parse_docx(file_bytes)
    content = post_process_lists(content)
    title = file.filename.rsplit(".", 1)[0]
    doc = storage.create_document(title, user["id"], content=None)
    doc_id = doc["id"]

    image_url_map = {}
    for img in images:
        storage.save_image(doc_id, img["filename"], img["data"], img["mime_type"])
        image_url_map[f"__IMAGE__{img['filename']}"] = f"/api/documents/{doc_id}/images/{img['filename']}"

    _replace_image_urls(content, image_url_map)
    storage.save_version(doc_id, content, user["id"], "Imported from DOCX")
    return {"id": doc_id, "title": title}

def _replace_image_urls(node, url_map):
    if isinstance(node, dict):
        if node.get("type") == "image" and "attrs" in node:
            src = node["attrs"].get("src", "")
            if src in url_map:
                node["attrs"]["src"] = url_map[src]
        for v in node.values():
            if isinstance(v, (dict, list)):
                _replace_image_urls(v, url_map)
    elif isinstance(node, list):
        for item in node:
            _replace_image_urls(item, url_map)
```

`backend/app/routers/images.py`:
```python
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from app import storage

router = APIRouter(prefix="/api/documents", tags=["images"])

@router.get("/{doc_id}/images/{filename}")
async def serve_image(doc_id: str, filename: str):
    result = storage.get_image(doc_id, filename)
    if not result:
        raise HTTPException(404, "Image not found")
    data, mime = result
    return Response(content=data, media_type=mime)
```

`backend/app/routers/comments.py`:
```python
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from app import storage
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/documents", tags=["comments"])

class CommentCreate(BaseModel):
    anchor: dict
    body: str
    thread_id: str | None = None

class CommentUpdate(BaseModel):
    body: str | None = None
    resolved: bool | None = None

@router.get("/{doc_id}/comments")
async def list_comments(doc_id: str):
    return storage.get_comments(doc_id)

@router.post("/{doc_id}/comments", status_code=201)
async def create_comment(doc_id: str, payload: CommentCreate, request: Request):
    user = get_current_user(request)
    return storage.add_comment(doc_id, payload.anchor, payload.body, user["id"], payload.thread_id)

@router.patch("/{doc_id}/comments/{comment_id}")
async def update_comment(doc_id: str, comment_id: str, payload: CommentUpdate):
    result = storage.update_comment(doc_id, comment_id, payload.body, payload.resolved)
    if not result:
        raise HTTPException(404, "Comment not found")
    return result

@router.delete("/{doc_id}/comments/{comment_id}", status_code=204)
async def delete_comment(doc_id: str, comment_id: str):
    if not storage.delete_comment(doc_id, comment_id):
        raise HTTPException(404, "Comment not found")
```

`backend/app/routers/export.py`:
```python
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response
from app import storage
from app.services.docx_builder import build_docx
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/documents", tags=["export"])

@router.post("/{doc_id}/export")
async def export_docx(doc_id: str, request: Request):
    get_current_user(request)
    doc = storage.get_document(doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    latest = storage.get_latest_content(doc_id)
    if not latest:
        raise HTTPException(404, "No content to export")

    image_map = {}
    images_dir = storage._doc_dir(doc_id) / "images"
    if images_dir.exists():
        for img_file in images_dir.iterdir():
            url = f"/api/documents/{doc_id}/images/{img_file.name}"
            image_map[url] = img_file.read_bytes()

    docx_bytes = build_docx(latest["content"], image_map)
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{doc["title"]}.docx"'},
    )
```

**Step 2: Register all routers in main.py**

```python
from app.routers import auth, documents, upload, images, comments, export

app.include_router(auth.router)
app.include_router(upload.router)  # before documents so /upload matches before /{doc_id}
app.include_router(export.router)
app.include_router(images.router)
app.include_router(comments.router)
app.include_router(documents.router)
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: all API routes — docs, upload, export, comments, images, auth"
```

---

### Task 3: Backend — DOCX Parser + DOCX Builder

**Files:**
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/docx_parser.py`
- Create: `backend/app/services/docx_builder.py`

**Step 1: Create DOCX parser (DOCX → JSON blocks)**

`backend/app/services/docx_parser.py` — full implementation from design doc. Reads DOCX XML via python-docx, maps paragraphs/runs/tables/images to Tiptap JSON block schema preserving fonts, colors, sizes, alignment, cell shading, image dimensions.

Key functions:
- `parse_docx(file_bytes) -> (content_json, images_list)`
- `post_process_lists(content) -> content` (groups list paragraphs into bulletList/orderedList nodes)

**Step 2: Create DOCX builder (JSON blocks → DOCX)**

`backend/app/services/docx_builder.py` — full implementation from design doc. Walks JSON block tree, maps each node to python-docx objects with formatting.

Key function:
- `build_docx(content, images_dict) -> bytes`

**Step 3: Test round-trip manually**

```bash
curl -X POST http://localhost:8000/api/documents/upload \
  -H "X-User-Id: user-alice" -F "file=@test.docx"
# Note the doc ID
curl http://localhost:8000/api/documents/<id>/content | python -m json.tool
curl -X POST http://localhost:8000/api/documents/<id>/export \
  -H "X-User-Id: user-alice" -o roundtrip.docx
```

Expected: `roundtrip.docx` opens in Word with headings, formatted text, tables, images.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: DOCX import parser and export builder with python-docx"
```

---

### Task 4: Frontend — Scaffolding + API Client + User Store

**Files:**
- Initialize Vite React-TS project in `frontend/`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/documents.ts`
- Create: `frontend/src/api/comments.ts`
- Create: `frontend/src/stores/userStore.ts`

**Step 1: Initialize frontend**

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install zustand lucide-react
npm install -D tailwindcss @tailwindcss/postcss postcss autoprefixer
npx tailwindcss init -p --ts
```

**Step 2: Install all Tiptap extensions**

```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/pm \
  @tiptap/extension-underline @tiptap/extension-text-style \
  @tiptap/extension-color @tiptap/extension-highlight \
  @tiptap/extension-text-align @tiptap/extension-font-family \
  @tiptap/extension-image @tiptap/extension-table \
  @tiptap/extension-table-row @tiptap/extension-table-cell \
  @tiptap/extension-table-header @tiptap/extension-subscript \
  @tiptap/extension-superscript @tiptap/extension-placeholder \
  @tiptap/extension-character-count
```

**Step 3: Create API client, documents API, comments API, user store**

Same code as the previous plan version (already proven correct). API client uses `X-User-Id` header, localStorage for persistence.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: frontend scaffolding with Tiptap deps, API client, user store"
```

---

### Task 5: Frontend — Tiptap Editor + Extensions + Auto-Save

**Files:**
- Create: `frontend/src/editor/extensions/font-size.ts`
- Create: `frontend/src/editor/extensions/block-id.ts`
- Create: `frontend/src/editor/extensions/index.ts`
- Create: `frontend/src/editor/BlockEditor.tsx`

**Step 1: Create custom extensions (FontSize, BlockId)**

Same implementations as previous plan — FontSize adds fontSize to textStyle mark, BlockId auto-assigns UUIDs to block nodes.

**Step 2: Create extensions index**

Assembles all Tiptap extensions into a single array.

**Step 3: Create BlockEditor component**

Loads document content on mount, renders EditorContent, auto-saves on 2-second debounce after edits.

**Step 4: Verify editor renders**

```bash
cd frontend && npm run dev
```

Navigate to editor route, verify Tiptap renders with placeholder text, typing works.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: Tiptap editor with all extensions, auto-save, custom FontSize and BlockId"
```

---

### Task 6: Frontend — Editor Toolbar

**Files:**
- Create: `frontend/src/editor/toolbar/EditorToolbar.tsx`
- Create: `frontend/src/editor/toolbar/FormatButtons.tsx`
- Create: `frontend/src/editor/toolbar/FontControls.tsx`
- Create: `frontend/src/editor/toolbar/AlignmentButtons.tsx`
- Create: `frontend/src/editor/toolbar/InsertMenu.tsx`

Full word-processor toolbar with:
- Font family dropdown, font size dropdown, text color, highlight
- Bold, Italic, Underline, Strike, Sub, Super
- Alignment (left/center/right/justify)
- Heading level, lists, blockquote, code block
- Insert: image, table, horizontal rule

Each button shows active state and calls the corresponding Tiptap command.

**Step 1: Build all toolbar components**

**Step 2: Wire into BlockEditor**

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: full editor toolbar — formatting, fonts, alignment, insert"
```

---

### Task 7: Frontend — App Shell (Document List + Upload + User Switcher)

**Files:**
- Create: `frontend/src/components/Layout.tsx`
- Create: `frontend/src/components/UserSwitcher.tsx`
- Create: `frontend/src/components/DocumentList.tsx`
- Modify: `frontend/src/App.tsx`

**Step 1: Layout with top nav bar + UserSwitcher dropdown**

**Step 2: DocumentList with upload button + document cards**

**Step 3: Simple state-based routing in App.tsx**

- `view: "list"` → DocumentList
- `view: "editor"` → BlockEditor + sidebar

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: app shell — document list, DOCX upload, user switcher"
```

---

### Task 8: Frontend — Comments Sidebar

**Files:**
- Create: `frontend/src/editor/extensions/comment-mark.ts`
- Create: `frontend/src/components/CommentsSidebar.tsx`
- Create: `frontend/src/hooks/useComments.ts`

**Step 1: CommentMark extension** — highlights commented text yellow, stores commentId attr.

**Step 2: useComments hook** — fetches, adds, resolves, deletes comments via API.

**Step 3: CommentsSidebar** — threaded comment list, click to scroll, add/reply/resolve.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: comments sidebar with text-anchored marks and threads"
```

---

### Task 9: Frontend — Version History + Export

**Files:**
- Create: `frontend/src/components/VersionHistory.tsx`
- Create: `frontend/src/components/ExportButton.tsx`

**Step 1: VersionHistory** — timeline of saves, click to preview.

**Step 2: ExportButton** — calls export API, triggers browser download.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: version history panel and DOCX export button"
```

---

### Task 10: Styles + Polish + Integration Test

**Files:**
- Create: `frontend/src/styles/editor.css`
- Modify: various components

**Step 1: Editor CSS** — paper-like document page, table borders, image styling, comment highlights.

**Step 2: Loading states and error handling.**

**Step 3: Full round-trip test:**

1. Start backend: `cd backend && uvicorn app.main:app --reload`
2. Start frontend: `cd frontend && npm run dev`
3. Open browser → pick user → upload DOCX → verify formatting preserved
4. Edit text → verify auto-save → check version history
5. Add comment → verify sidebar → resolve comment
6. Export DOCX → open in Word → verify content matches
7. Switch user → verify different context

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: editor styles, polish, integration testing complete"
```
