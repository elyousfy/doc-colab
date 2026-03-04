# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Colab Doc** is a collaborative document editor with:
- A **FastAPI** backend (`backend/`) that stores documents as JSON files on disk
- A **React + TypeScript** frontend (`frontend/`) built with Vite, using Tiptap as the rich-text editor
- Document import from DOCX/PDF/etc. via two parsers: a legacy `python-docx` parser and a `docling`-based parser
- Export to DOCX, version history, image upload/storage, and threaded comments

## Running the Project

**Backend** (from `backend/`):
```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8003
```

Environment variables:
- `DATA_DIR` — path for document storage (default: `data/`)
- `CORS_ORIGINS` — comma-separated allowed origins (default: `http://localhost:5173,http://localhost:5174,http://localhost:5175`)

**Frontend** (from `frontend/`):
```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # TypeScript check + Vite build
npm run preview    # preview production build
```

The Vite dev server proxies `/api/*` to `http://localhost:8003`.

## Architecture

### Backend

All API endpoints are in `backend/app/routers/`:
- `auth.py` — reads `X-User-Id` header; users are hardcoded demo accounts in `storage.py`
- `documents.py` — CRUD for documents and version content
- `upload.py` — file import with parser selection (`auto`/`legacy`/`docling`)
- `export.py` — DOCX export via `docx_builder.py`
- `images.py` — serve stored images
- `comments.py` — threaded comments per document

`backend/app/storage.py` is the single persistence layer. Documents are stored under `data/documents/{uuid}/`:
- `meta.json` — title, author, timestamps, status
- `versions/v{n}.json` — Tiptap JSON content snapshots
- `comments.json` — flat list of comment objects
- `images/` — binary image files + `.meta` sidecar for MIME type

### Document Parsing Pipeline

`upload.py` resolves the parser strategy:
- **`legacy`**: `services/docx_parser.py` (python-docx, DOCX only)
- **`docling`**: `services/docling_parser.py` (uses Docling for PDF, DOCX, PPTX, images, etc.)
- **`hybrid`** (auto-selected for DOCX): runs both parsers — takes legacy header/footer sections + docling body + merged image canvas

Both parsers produce **Tiptap JSON** (`{"type": "doc", "content": [...]}`) and a list of image dicts `{filename, data, mime_type}`. Image `src` values use the placeholder prefix `__IMAGE__{filename}` which `upload.py` rewrites to real `/api/documents/{id}/images/{filename}` URLs before saving.

### Frontend

State is minimal — Zustand is only used for the user store (`src/stores/userStore.ts`). Everything else is local React state passed via props.

Key components:
- `src/editor/BlockEditor.tsx` — Tiptap editor with 2-second debounced auto-save, accepts `contentToLoad` prop for version restore
- `src/editor/extensions/` — custom Tiptap extensions (e.g., `pageCanvas`, `positionedImage`, `docSection`)
- `src/api/client.ts` — `apiFetch` wrapper that injects `X-User-Id` header from `localStorage`
- `src/api/documents.ts` — typed API calls for all document operations

Authentication is simulated: the current user is stored in `localStorage` as `userId` and sent via `X-User-Id` header. The backend resolves it from the hardcoded `DEMO_USERS` list.

### Custom Tiptap Node Types

The editor uses custom block types beyond standard Tiptap nodes. These appear in stored Tiptap JSON:
- `docSection` — header/footer wrapper (`attrs.sectionType: "header" | "footer"`)
- `pageCanvas` — free-form positioned canvas with `width`, `height`, `grid` attrs
- `positionedImage` — image with absolute x/y/width/height/zIndex coordinates inside a `pageCanvas`

All custom nodes carry a `blockId` attribute (UUID) in `attrs`.
