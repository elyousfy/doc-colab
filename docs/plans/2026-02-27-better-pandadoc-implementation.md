# Better PandaDoc Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the document editor faithfully reproduce imported DOCX files — correct colors, inline images in reading order, draggable/resizable image blocks, and clickable TOC.

**Architecture:** Docling handles structure + reading order + image bounding boxes. Python-docx enriches the output with run-level text colors. The frontend removes the broken canvas/positioned-image approach for imported content and fixes block drag-and-drop with a drop indicator.

**Tech Stack:** Python (FastAPI, python-docx, docling), TypeScript (React, Tiptap v3, ProseMirror)

---

## Task 1: Rewrite docling parser — provenance-based reading order

**Files:**
- Modify: `backend/app/services/docling_parser.py`

The current parser uses a fragile tree traversal and appends unplaced images at the end under an "Imported Images" heading. Replace the entire `_docling_json_to_tiptap` function with a flat provenance sort.

**Step 1: Understand the provenance data structure**

Run this against your sample DOCX to see what docling actually gives us:

```python
# check_doc.py (already exists at root — run this manually)
# Add temporarily to see prov structure:
from docling.document_converter import DocumentConverter
import json, sys

result = DocumentConverter().convert(sys.argv[1])
data = result.document.export_to_dict()

# Print first 3 text items with their prov
for item in data.get("texts", [])[:3]:
    print(json.dumps({"text": item.get("text","")[:60], "prov": item.get("prov")}, indent=2))

# Print first 3 pictures with their prov
for item in data.get("pictures", [])[:3]:
    print(json.dumps({"ref": item.get("self_ref"), "prov": item.get("prov"), "has_image": bool(item.get("image",{}).get("uri"))}, indent=2))
```

Run: `cd backend && python ../check_doc.py "../Bradford_TECHNO_COMMERCIAL PROPOSAL.docx"`

Look at whether `prov` has `page_no` and `bbox` with `coord_origin`. This confirms what sorting key to use.

**Step 2: Replace `_docling_json_to_tiptap` with provenance sort**

Replace the entire function body in `backend/app/services/docling_parser.py`. Keep `parse_with_docling` unchanged (lines 1-51). Replace everything from line 54 onward with:

```python
def _get_sort_key(item: dict) -> tuple:
    """Sort key: (page_no, y_from_top). Handles both coord origins."""
    prov_list = item.get("prov") or []
    if not prov_list:
        return (9999, 9999)
    prov = prov_list[0]
    page = prov.get("page_no", 9999)
    bbox = prov.get("bbox") or {}
    t = bbox.get("t", 9999)
    origin = bbox.get("coord_origin", "BOTTOMLEFT")
    # BOTTOMLEFT: y increases upward, higher t = higher on page = lower reading index
    # TOPLEFT: y increases downward, lower t = higher on page = lower reading index
    y_from_top = -t if origin == "BOTTOMLEFT" else t
    return (page, y_from_top)


def _docling_json_to_tiptap(data: dict) -> tuple[dict, list[dict]]:
    texts = data.get("texts", [])
    tables = data.get("tables", [])
    pictures = data.get("pictures", [])

    # Build picture nodes and collect image blobs
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

        size = image.get("size") or {}
        attrs: dict = {
            "blockId": _block_id(),
            "src": f"__IMAGE__{filename}",
            "alt": "",
            "title": None,
        }
        w = size.get("width")
        h = size.get("height")
        if isinstance(w, (int, float)):
            attrs["width"] = round(float(w), 1)
        if isinstance(h, (int, float)):
            attrs["height"] = round(float(h), 1)

        picture_nodes[pic_ref] = {"type": "image", "attrs": attrs, "_prov": pic}

    # Collect all items with their prov for sorting
    all_items: list[dict] = []

    for item in texts:
        all_items.append({"_kind": "text", "_item": item})

    for item in tables:
        all_items.append({"_kind": "table", "_item": item})

    for ref, node in picture_nodes.items():
        # Find original picture item for prov
        pic_item = next((p for p in pictures if p.get("self_ref") == ref), {})
        all_items.append({"_kind": "picture", "_item": pic_item, "_node": node})

    # Sort by reading order
    all_items.sort(key=lambda x: _get_sort_key(x["_item"]))

    blocks: list[dict] = []
    for entry in all_items:
        kind = entry["_kind"]
        item = entry["_item"]

        if kind == "picture":
            blocks.append(entry["_node"])

        elif kind == "table":
            tbl = _map_table(item)
            if tbl:
                blocks.append(tbl)

        elif kind == "text":
            node = _map_text_item(item)
            if node:
                # Group consecutive list items
                if node.get("_list_type"):
                    blocks.append(node)  # post-process later
                else:
                    blocks.append(node)

    # Post-process: group consecutive list items
    blocks = _group_list_items(blocks)

    if not blocks:
        blocks = [{"type": "paragraph", "attrs": {"blockId": _block_id()}}]

    return {"type": "doc", "content": blocks}, images


def _map_text_item(item: dict) -> dict | None:
    """Map a single docling text item to a Tiptap node."""
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

    font_name = formatting.get("font_name") or formatting.get("fontName")
    font_size = formatting.get("font_size") or formatting.get("fontSize")
    color = formatting.get("color") or formatting.get("font_color")

    if font_name:
        style_attrs["fontFamily"] = font_name
    if font_size:
        style_attrs["fontSize"] = f"{font_size}pt" if isinstance(font_size, (int, float)) else str(font_size)
    if color and color not in ("auto", "000000", "#000000"):
        hex_color = color if color.startswith("#") else f"#{color}"
        style_attrs["color"] = hex_color

    if style_attrs:
        marks.append({"type": "textStyle", "attrs": style_attrs})

    text_node: dict = {"type": "text", "text": text}
    if marks:
        text_node["marks"] = marks

    attrs: dict = {"blockId": _block_id()}

    # Alignment from formatting
    alignment = formatting.get("text_align") or formatting.get("alignment")
    if alignment:
        mapping = {"left": "left", "center": "center", "right": "right", "justify": "justify", "both": "justify"}
        mapped = mapping.get(alignment.lower())
        if mapped:
            attrs["textAlign"] = mapped

    if label == "section_header":
        level = int(formatting.get("level", 2)) if formatting.get("level") else 2
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
    """Map a docling table item to a Tiptap table node."""
    data = item.get("data") or {}
    grid = data.get("grid") or []
    if not grid:
        return None

    rows: list[dict] = []
    for row in grid:
        cells: list[dict] = []
        for cell in row:
            text = (cell.get("text") or "").strip()
            cell_content: list[dict] = []
            if text:
                cell_content.append({
                    "type": "paragraph",
                    "attrs": {"blockId": _block_id()},
                    "content": [{"type": "text", "text": text}],
                })
            else:
                cell_content.append({"type": "paragraph", "attrs": {"blockId": _block_id()}})
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
                b = dict(blocks[i])
                b.pop("_list_type", None)
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
```

Also delete the now-unused functions: `_ref_from_link`, `_extract_picture_nodes`, `_place_unmapped_pictures`, `_find_anchor_index`, `_block_text`, `_norm`, `_keep_primary_images`, `_map_ref`, `_map_text`, `_map_linear_texts`, `_map_table` (old version).

**Step 3: Test manually**

```bash
cd backend
python -c "
from app.services.docling_parser import parse_with_docling
with open('../Bradford_TECHNO_COMMERCIAL PROPOSAL.docx','rb') as f:
    content, images = parse_with_docling(f.read(), 'test.docx')
print('blocks:', len(content['content']))
print('images:', len(images))
# Check first 5 block types
for b in content['content'][:5]:
    print(b['type'], '-', str(b.get('content',''))[:60])
# Check that images are inline (not all at end)
img_positions = [i for i,b in enumerate(content['content']) if b['type']=='image']
print('image positions:', img_positions)
"
```

Expected: image positions should be spread throughout (e.g. `[3, 8, 14, 22]`), not all at the end.

**Step 4: Commit**

```bash
git add backend/app/services/docling_parser.py
git commit -m "feat: rewrite docling parser to use provenance-based reading order for inline image placement"
```

---

## Task 2: Add python-docx color enrichment

**Files:**
- Create: `backend/app/services/color_enricher.py`
- Modify: `backend/app/routers/upload.py`

**Step 1: Create `color_enricher.py`**

```python
# backend/app/services/color_enricher.py
"""Enrich docling Tiptap JSON with text colors extracted from python-docx."""
from __future__ import annotations
import io
import re


def _normalize(text: str) -> str:
    """Strip whitespace and lowercase for fuzzy matching."""
    return re.sub(r"\s+", " ", text.strip().lower())


def build_color_map(file_bytes: bytes) -> dict[str, str]:
    """
    Parse DOCX with python-docx and return {normalized_paragraph_text: hex_color}.
    Only captures the dominant (first non-black) color per paragraph.
    """
    from docx import Document
    doc = Document(io.BytesIO(file_bytes))
    color_map: dict[str, str] = {}

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        key = _normalize(text)
        # Find first run with a real color
        for run in para.runs:
            try:
                rgb = run.font.color.rgb
                if rgb and str(rgb) not in ("000000", "auto"):
                    color_map[key] = f"#{rgb}"
                    break
            except Exception:
                continue
    return color_map


def enrich_tiptap_with_colors(content: dict, color_map: dict[str, str]) -> dict:
    """
    Walk tiptap JSON and apply colors from color_map to matching paragraph/heading nodes.
    Modifies content in-place and returns it.
    """
    _walk_blocks(content.get("content", []), color_map)
    return content


def _walk_blocks(blocks: list, color_map: dict[str, str]) -> None:
    for block in blocks:
        btype = block.get("type")
        if btype in ("paragraph", "heading"):
            _apply_color_to_block(block, color_map)
        # Recurse into containers
        children = block.get("content", [])
        if children and btype not in ("paragraph", "heading"):
            _walk_blocks(children, color_map)


def _apply_color_to_block(block: dict, color_map: dict[str, str]) -> None:
    """If the block text matches a colored paragraph in color_map, apply the color."""
    # Collect full text of block
    parts = []
    for node in block.get("content", []):
        if node.get("type") == "text":
            parts.append(node.get("text", ""))
    full_text = _normalize(" ".join(parts))
    if not full_text:
        return

    color = color_map.get(full_text)
    if not color:
        # Try prefix match (docling sometimes truncates text)
        for key, val in color_map.items():
            if full_text.startswith(key[:30]) or key.startswith(full_text[:30]):
                color = val
                break
    if not color:
        return

    # Apply color to all text nodes in this block that don't already have a color
    for node in block.get("content", []):
        if node.get("type") != "text":
            continue
        marks = node.get("marks", [])
        # Check if a color is already set
        has_color = any(
            m.get("type") == "textStyle" and m.get("attrs", {}).get("color")
            for m in marks
        )
        if has_color:
            continue
        # Find existing textStyle mark or create one
        ts_mark = next((m for m in marks if m.get("type") == "textStyle"), None)
        if ts_mark:
            ts_mark.setdefault("attrs", {})["color"] = color
        else:
            marks.append({"type": "textStyle", "attrs": {"color": color}})
        node["marks"] = marks
```

**Step 2: Test color enricher in isolation**

```bash
cd backend
python -c "
from app.services.color_enricher import build_color_map, enrich_tiptap_with_colors
with open('../Bradford_TECHNO_COMMERCIAL PROPOSAL.docx','rb') as f:
    data = f.read()
cmap = build_color_map(data)
print('color map entries:', len(cmap))
# Show a few colored entries
for k, v in list(cmap.items())[:5]:
    print(f'  {v}: {k[:60]}')
"
```

Expected: should see entries like `#00B0F0: notice of confidentiality` (or similar cyan color).

**Step 3: Wire into `upload.py`**

In `backend/app/routers/upload.py`, replace the `_upload_with_parser` function's hybrid DOCX path.

Find this block (around line 51-58):
```python
    try:
        if parser_used == "legacy":
            content, images = parse_docx(file_bytes)
            version_message = "Uploaded from DOCX (legacy parser)"
        elif parser_used == "hybrid":
            legacy_content, legacy_images = parse_docx(file_bytes)
            docling_content, docling_images = parse_with_docling(file_bytes, filename)
            content = _merge_hybrid_docx_content(legacy_content, docling_content, docling_images)
            images = legacy_images + docling_images
            version_message = "Uploaded from DOCX (hybrid parser)"
        else:
            content, images = parse_with_docling(file_bytes, filename)
            version_message = "Uploaded with Docling"
```

Replace with:
```python
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
```

**Step 4: Start the backend and upload the Bradford DOCX**

```bash
cd backend
uvicorn app.main:app --reload --port 8003
```

In a second terminal, run the existing upload test:
```bash
cd /c/Users/alyou/Desktop/Learning/RAG/colab_doc
python upload_test.py
```

Or use the frontend to upload. Check that:
- The document appears in the list
- Opening it shows headings with colors (cyan/blue)
- Images appear scattered throughout the document (not all at the end)

**Step 5: Commit**

```bash
git add backend/app/services/color_enricher.py backend/app/routers/upload.py
git commit -m "feat: add python-docx color enrichment for docling output"
```

---

## Task 3: Fix block drag-and-drop — drop indicator

**Files:**
- Modify: `frontend/src/editor/extensions/block-handle.ts`
- Modify: `frontend/src/styles/editor.css`

The current drag implementation sets `editorView.dragging` correctly but has no visual drop indicator and fails to detect nested blocks.

**Step 1: Add drop indicator CSS to `editor.css`**

Append at the end of `frontend/src/styles/editor.css`:

```css
/* ===== Block drag drop indicator ===== */

.block-drop-indicator {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: #6366f1;
  border-radius: 1px;
  pointer-events: none;
  z-index: 200;
  transition: top 0.05s ease;
}

.block-drop-indicator::before {
  content: "";
  position: absolute;
  left: -4px;
  top: -3px;
  width: 8px;
  height: 8px;
  background: #6366f1;
  border-radius: 50%;
}
```

**Step 2: Rewrite `block-handle.ts` — fix nested detection + add drop indicator**

Replace the entire content of `frontend/src/editor/extensions/block-handle.ts`:

```typescript
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";

const HANDLE_WIDTH = 24;

const TOP_LEVEL_NODES = new Set([
  "heading", "paragraph", "image", "table",
  "bulletList", "orderedList", "blockquote",
  "codeBlock", "horizontalRule", "docSection",
]);

// Find the top-level block at a given clientY coordinate
function findBlockAtCoords(view: EditorView, clientY: number) {
  const { state } = view;
  const { doc } = state;

  for (let i = 0; i < doc.childCount; i++) {
    const pos = doc.content.offsetAt(i);
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) continue;
    const rect = dom.getBoundingClientRect();
    if (clientY >= rect.top - 4 && clientY <= rect.bottom + 4) {
      const node = doc.child(i);
      if (TOP_LEVEL_NODES.has(node.type.name)) {
        return { node, pos, dom, rect };
      }
    }
  }
  return null;
}

// Find the gap position (between blocks) closest to clientY for drop indicator
function findDropGap(view: EditorView, clientY: number): { top: number; pos: number } | null {
  const { state } = view;
  const { doc } = state;
  const editorRect = view.dom.getBoundingClientRect();

  let bestGap: { top: number; pos: number } | null = null;
  let bestDist = Infinity;

  for (let i = 0; i <= doc.childCount; i++) {
    let gapTop: number;
    let pos: number;

    if (i === 0) {
      const firstDom = view.nodeDOM(0);
      if (!(firstDom instanceof HTMLElement)) continue;
      gapTop = firstDom.getBoundingClientRect().top - editorRect.top;
      pos = 0;
    } else {
      const prevPos = doc.content.offsetAt(i - 1);
      const prevDom = view.nodeDOM(prevPos);
      if (!(prevDom instanceof HTMLElement)) continue;
      gapTop = prevDom.getBoundingClientRect().bottom - editorRect.top;
      pos = prevPos + doc.child(i - 1).nodeSize;
    }

    const dist = Math.abs(clientY - editorRect.top - gapTop);
    if (dist < bestDist) {
      bestDist = dist;
      bestGap = { top: gapTop, pos };
    }
  }

  return bestGap;
}

function createHandleElement(): HTMLDivElement {
  const handle = document.createElement("div");
  handle.className = "block-handle";
  handle.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/>
    <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
    <circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/>
  </svg>`;
  handle.setAttribute("draggable", "true");
  return handle;
}

function createPlusElement(): HTMLDivElement {
  const plus = document.createElement("div");
  plus.className = "block-plus-button";
  plus.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 1v14M1 8h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
  </svg>`;
  return plus;
}

function createActionMenu(): HTMLDivElement {
  const menu = document.createElement("div");
  menu.className = "block-action-menu";
  menu.innerHTML = `
    <button data-action="duplicate" title="Duplicate">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
    </button>
    <button data-action="moveUp" title="Move up">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
    </button>
    <button data-action="moveDown" title="Move down">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <button data-action="delete" title="Delete">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
    </button>
  `;
  return menu;
}

function createDropIndicator(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "block-drop-indicator";
  el.style.display = "none";
  return el;
}

export const BlockHandle = Extension.create({
  name: "blockHandle",
  addProseMirrorPlugins() {
    let handle: HTMLDivElement | null = null;
    let plusBtn: HTMLDivElement | null = null;
    let actionMenu: HTMLDivElement | null = null;
    let dropIndicator: HTMLDivElement | null = null;
    let activeBlockPos: number | null = null;
    let menuOpen = false;
    let isDragging = false;
    let dropPos: number | null = null;

    const hideMenu = () => {
      actionMenu?.classList.remove("visible");
      menuOpen = false;
    };

    const showHandleAt = (view: EditorView, block: NonNullable<ReturnType<typeof findBlockAtCoords>>) => {
      if (!handle) return;
      const editorRect = view.dom.getBoundingClientRect();
      handle.style.top = `${block.rect.top - editorRect.top + (block.rect.height / 2) - 12}px`;
      handle.style.opacity = "1";
      activeBlockPos = block.pos;
      view.dom.querySelectorAll(".block-hovered").forEach(el => el.classList.remove("block-hovered"));
      block.dom.classList.add("block-hovered");
    };

    const hideHandle = (view: EditorView) => {
      if (!handle) return;
      handle.style.opacity = "0";
      if (!menuOpen) {
        view.dom.querySelectorAll(".block-hovered").forEach(el => el.classList.remove("block-hovered"));
      }
    };

    return [
      new Plugin({
        key: new PluginKey("blockHandle"),
        view(editorView) {
          const wrapper = editorView.dom.parentElement;
          if (!wrapper) return {};

          wrapper.style.position = "relative";

          handle = createHandleElement();
          plusBtn = createPlusElement();
          actionMenu = createActionMenu();
          dropIndicator = createDropIndicator();

          wrapper.appendChild(handle);
          wrapper.appendChild(plusBtn);
          wrapper.appendChild(actionMenu);
          wrapper.appendChild(dropIndicator);

          // Handle click → toggle action menu
          handle.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!actionMenu || !handle) return;
            if (menuOpen) { hideMenu(); return; }
            actionMenu.style.top = handle.style.top;
            actionMenu.style.left = `-${HANDLE_WIDTH + 104}px`;
            actionMenu.classList.add("visible");
            menuOpen = true;
          });

          // Handle dragstart → initiate ProseMirror drag
          handle.addEventListener("dragstart", (e) => {
            hideMenu();
            isDragging = true;
            if (activeBlockPos === null) return;
            const { state } = editorView;
            const node = state.doc.nodeAt(activeBlockPos);
            if (!node) return;
            const slice = state.doc.slice(activeBlockPos, activeBlockPos + node.nodeSize);
            editorView.dragging = { slice, move: true };
            e.dataTransfer?.setDragImage(handle!, HANDLE_WIDTH / 2, HANDLE_WIDTH / 2);
          });

          handle.addEventListener("dragend", () => {
            isDragging = false;
            if (dropIndicator) dropIndicator.style.display = "none";
            editorView.dom.querySelectorAll(".block-hovered").forEach(el => el.classList.remove("block-hovered"));
          });

          // Action menu buttons
          actionMenu.addEventListener("click", (e) => {
            const button = (e.target as HTMLElement).closest("button");
            if (!button || activeBlockPos === null) return;
            const action = button.getAttribute("data-action");
            const { state, dispatch } = editorView;
            const node = state.doc.nodeAt(activeBlockPos);
            if (!node) return;
            const nodeEnd = activeBlockPos + node.nodeSize;

            switch (action) {
              case "delete":
                dispatch(state.tr.delete(activeBlockPos, nodeEnd));
                break;
              case "duplicate":
                dispatch(state.tr.insert(nodeEnd, node.copy(node.content)));
                break;
              case "moveUp": {
                const $pos = state.doc.resolve(activeBlockPos);
                const index = $pos.index(0);
                if (index === 0) break;
                const prevNode = state.doc.child(index - 1);
                const prevStart = activeBlockPos - prevNode.nodeSize;
                const tr = state.tr;
                tr.delete(activeBlockPos, nodeEnd);
                tr.insert(prevStart, node.copy(node.content));
                dispatch(tr);
                break;
              }
              case "moveDown": {
                const $pos2 = state.doc.resolve(activeBlockPos);
                const index2 = $pos2.index(0);
                if (index2 >= state.doc.childCount - 1) break;
                const nextNode = state.doc.child(index2 + 1);
                const nextEnd = nodeEnd + nextNode.nodeSize;
                const tr2 = state.tr;
                tr2.insert(nextEnd, node.copy(node.content));
                tr2.delete(activeBlockPos, nodeEnd);
                dispatch(tr2);
                break;
              }
            }
            hideMenu();
          });

          // Plus button → insert paragraph below
          plusBtn.addEventListener("click", (e) => {
            e.preventDefault();
            editorView.focus();
            const { state, dispatch } = editorView;
            const pType = state.schema.nodes.paragraph;
            if (!pType) return;
            const editorRect = editorView.dom.getBoundingClientRect();
            const clickY = parseFloat(plusBtn!.style.top) + editorRect.top + 10;
            const block = findBlockAtCoords(editorView, clickY + 10);
            if (block) {
              const insertPos = block.pos + block.node.nodeSize;
              dispatch(state.tr.insert(insertPos, pType.create()));
              editorView.focus();
              const newState = editorView.state;
              const sel = newState.selection.constructor as any;
              editorView.dispatch(
                newState.tr.setSelection(sel.near(newState.doc.resolve(insertPos + 1)))
              );
            }
          });

          document.addEventListener("click", () => { hideMenu(); });

          return {
            destroy() {
              handle?.remove();
              plusBtn?.remove();
              actionMenu?.remove();
              dropIndicator?.remove();
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              if (isDragging) return false;
              const block = findBlockAtCoords(view, event.clientY);
              if (block && TOP_LEVEL_NODES.has(block.node.type.name)) {
                showHandleAt(view, block);
                const editorRect = view.dom.getBoundingClientRect();
                const gap = block.rect.top - editorRect.top;
                if (event.clientY < block.rect.top && event.clientY > block.rect.top - 12) {
                  if (plusBtn) {
                    plusBtn.style.top = `${gap - 10}px`;
                    plusBtn.style.opacity = "1";
                  }
                } else {
                  if (plusBtn) plusBtn.style.opacity = "0";
                }
              } else {
                hideHandle(view);
                if (plusBtn) plusBtn.style.opacity = "0";
              }
              return false;
            },
            dragover(view, event) {
              event.preventDefault();
              if (!dropIndicator) return false;
              const gap = findDropGap(view, event.clientY);
              if (gap) {
                dropPos = gap.pos;
                dropIndicator.style.display = "block";
                dropIndicator.style.top = `${gap.top - 1}px`;
              }
              return false;
            },
            dragleave(_view, _event) {
              if (dropIndicator) dropIndicator.style.display = "none";
              return false;
            },
            drop(view, event) {
              if (dropIndicator) dropIndicator.style.display = "none";
              isDragging = false;
              // Let ProseMirror handle the actual drop via editorView.dragging
              return false;
            },
            mouseleave(view) {
              if (!menuOpen) hideHandle(view);
              if (plusBtn) plusBtn.style.opacity = "0";
              return false;
            },
            click() {
              hideMenu();
              return false;
            },
          },
        },
      }),
    ];
  },
});
```

**Step 3: Test in browser**

```bash
cd frontend && npm run dev
```

- Open the editor with a document
- Hover over blocks → drag handle appears at vertical center of each block
- Drag a block → blue line appears between blocks showing drop target
- Release → block moves to new position
- Click gear icon → action menu shows (Duplicate, Move Up, Move Down, Delete)

**Step 4: Commit**

```bash
git add frontend/src/editor/extensions/block-handle.ts frontend/src/styles/editor.css
git commit -m "feat: fix block drag-and-drop with drop indicator and nested block support"
```

---

## Task 4: Image resize handles — all 8 directions

**Files:**
- Modify: `frontend/src/editor/extensions/custom-image.ts`
- Modify: `frontend/src/styles/editor.css`

The current CustomImage only has a `bottom-right` resize direction. We need a React NodeView with 8 handles.

**Step 1: Replace `custom-image.ts` with a React NodeView**

```typescript
// frontend/src/editor/extensions/custom-image.ts
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, type NodeViewProps, ReactNodeViewRenderer } from "@tiptap/react";
import { useCallback, useRef } from "react";

type Direction = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const CURSORS: Record<Direction, string> = {
  n: "n-resize", ne: "ne-resize", e: "e-resize", se: "se-resize",
  s: "s-resize", sw: "sw-resize", w: "w-resize", nw: "nw-resize",
};

const MIN_W = 50;
const MIN_H = 50;

function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const startRef = useRef<{
    dir: Direction; mouseX: number; mouseY: number;
    w: number; h: number;
  } | null>(null);

  const src = node.attrs.src as string | undefined;
  const width: number = node.attrs.width ?? 400;
  const height: number = node.attrs.height ?? "auto";
  const hasHeight = typeof height === "number";

  const onResizeStart = useCallback((e: React.MouseEvent, dir: Direction) => {
    e.preventDefault();
    e.stopPropagation();
    startRef.current = {
      dir,
      mouseX: e.clientX,
      mouseY: e.clientY,
      w: width,
      h: hasHeight ? (height as number) : 300,
    };

    const onMove = (ev: MouseEvent) => {
      const s = startRef.current;
      if (!s) return;
      const dx = ev.clientX - s.mouseX;
      const dy = ev.clientY - s.mouseY;
      let newW = s.w;
      let newH = s.h;

      if (s.dir.includes("e")) newW = Math.max(MIN_W, s.w + dx);
      if (s.dir.includes("w")) newW = Math.max(MIN_W, s.w - dx);
      if (s.dir.includes("s")) newH = Math.max(MIN_H, s.h + dy);
      if (s.dir.includes("n")) newH = Math.max(MIN_H, s.h - dy);

      const updates: Record<string, number> = { width: Math.round(newW) };
      if (s.dir.includes("n") || s.dir.includes("s")) updates.height = Math.round(newH);
      updateAttributes(updates);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      startRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width, height, hasHeight, updateAttributes]);

  const handles: Direction[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

  return (
    <NodeViewWrapper
      className={`custom-image-wrapper${selected ? " selected" : ""}`}
      style={{ display: "inline-block", position: "relative", lineHeight: 0 }}
      contentEditable={false}
    >
      <img
        src={src}
        alt={node.attrs.alt || ""}
        draggable={false}
        style={{
          width: `${width}px`,
          height: hasHeight ? `${height}px` : "auto",
          display: "block",
          maxWidth: "100%",
        }}
      />
      {selected && handles.map((dir) => (
        <div
          key={dir}
          className={`img-resize-handle img-resize-handle--${dir}`}
          style={{ cursor: CURSORS[dir] }}
          onMouseDown={(e) => onResizeStart(e, dir)}
        />
      ))}
    </NodeViewWrapper>
  );
}

function parseNumeric(value: string | null): number | null {
  if (!value) return null;
  const num = Number.parseFloat(value.replace("px", "").trim());
  return Number.isFinite(num) ? num : null;
}

export const CustomImage = Image.extend({
  group: "block",
  inline: false,

  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-block-id"),
        renderHTML: (attrs) => attrs.blockId ? { "data-block-id": attrs.blockId } : {},
      },
      width: {
        default: null,
        parseHTML: (el) => parseNumeric(el.getAttribute("data-width") || el.getAttribute("width")),
        renderHTML: (attrs) => {
          if (!attrs.width) return {};
          return { "data-width": String(attrs.width), width: String(Math.round(attrs.width)) };
        },
      },
      height: {
        default: null,
        parseHTML: (el) => parseNumeric(el.getAttribute("data-height") || el.getAttribute("height")),
        renderHTML: (attrs) => {
          if (!attrs.height) return {};
          return { "data-height": String(attrs.height), height: String(Math.round(attrs.height)) };
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
```

**Step 2: Add resize handle CSS to `editor.css`**

Append to `frontend/src/styles/editor.css`:

```css
/* ===== Image resize handles ===== */

.custom-image-wrapper {
  display: inline-block;
  position: relative;
  max-width: 100%;
}

.custom-image-wrapper.selected img {
  outline: 2px solid #6366f1;
  outline-offset: 2px;
}

.img-resize-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: white;
  border: 2px solid #6366f1;
  border-radius: 2px;
  z-index: 10;
  box-sizing: border-box;
}

.img-resize-handle--n  { top: -5px; left: 50%; transform: translateX(-50%); }
.img-resize-handle--ne { top: -5px; right: -5px; }
.img-resize-handle--e  { top: 50%; right: -5px; transform: translateY(-50%); }
.img-resize-handle--se { bottom: -5px; right: -5px; }
.img-resize-handle--s  { bottom: -5px; left: 50%; transform: translateX(-50%); }
.img-resize-handle--sw { bottom: -5px; left: -5px; }
.img-resize-handle--w  { top: 50%; left: -5px; transform: translateY(-50%); }
.img-resize-handle--nw { top: -5px; left: -5px; }
```

**Step 3: Update `index.ts` to remove the old resize config**

In `frontend/src/editor/extensions/index.ts`, replace:

```typescript
  CustomImage.configure({
    inline: false,
    allowBase64: true,
    resize: {
      enabled: true,
      directions: ["bottom-right"],
      minWidth: 50,
      minHeight: 50,
      alwaysPreserveAspectRatio: false,
    },
  }),
```

With:

```typescript
  CustomImage.configure({ allowBase64: true }),
```

**Step 4: Test in browser**

- Upload a DOCX with images
- Click an image → 8 white square handles appear around it
- Drag any handle to resize
- Drag the block handle (⠿) on the image block → reorders it in the document flow

**Step 5: Commit**

```bash
git add frontend/src/editor/extensions/custom-image.ts \
        frontend/src/editor/extensions/index.ts \
        frontend/src/styles/editor.css
git commit -m "feat: image resize with 8 handles and block-level drag-to-reorder"
```

---

## Task 5: TOC clickable anchor links

**Files:**
- Create: `frontend/src/editor/extensions/heading-id.ts`
- Modify: `frontend/src/editor/extensions/doc-section.ts`
- Modify: `frontend/src/editor/extensions/index.ts`
- Modify: `frontend/src/styles/editor.css`

**Step 1: Create `heading-id.ts`**

This extends the built-in Heading node to render with an `id` attribute from `blockId`:

```typescript
// frontend/src/editor/extensions/heading-id.ts
import { Extension } from "@tiptap/core";

/**
 * Makes headings render with id={blockId} so TOC anchor links can scroll to them.
 * Works alongside the existing BlockId extension.
 */
export const HeadingId = Extension.create({
  name: "headingId",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          // blockId is already defined by BlockId extension.
          // We just need renderHTML to also emit an id attribute.
        },
      },
    ];
  },
  // Override heading renderHTML via addOptions isn't possible directly,
  // so we hook into the DOM via a ProseMirror plugin that sets id on heading DOM nodes.
  addProseMirrorPlugins() {
    const { Plugin, PluginKey } = require("@tiptap/pm/state");
    return [
      new Plugin({
        key: new PluginKey("headingId"),
        view(view) {
          const setIds = () => {
            view.dom.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((el) => {
              const blockId = (el as HTMLElement).dataset.blockId;
              if (blockId && !el.id) el.id = blockId;
            });
          };
          setIds();
          const observer = new MutationObserver(setIds);
          observer.observe(view.dom, { childList: true, subtree: true, attributes: true });
          return { destroy() { observer.disconnect(); } };
        },
      }),
    ];
  },
});
```

**Step 2: Replace `doc-section.ts` with a React NodeView for TOC**

```typescript
// frontend/src/editor/extensions/doc-section.ts
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";

function TocSectionView({ node }: NodeViewProps) {
  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const p = target.closest("p");
    if (!p) return;

    // Get the paragraph text, strip trailing dots and page number: "Section Title .... 5"
    const rawText = p.textContent || "";
    const clean = rawText.replace(/[\s.]+\d+\s*$/, "").trim().toLowerCase();

    // Find a heading in the document whose text matches
    const headings = document.querySelectorAll("h1,h2,h3,h4,h5,h6");
    for (const heading of Array.from(headings)) {
      const hText = (heading.textContent || "").trim().toLowerCase();
      if (hText === clean || hText.startsWith(clean.substring(0, 20))) {
        heading.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
  };

  return (
    <NodeViewWrapper
      className="doc-section"
      data-section-type="toc"
      onClick={handleClick}
    >
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

export const DocSection = Node.create({
  name: "docSection",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-block-id"),
        renderHTML: (attrs) => attrs.blockId ? { "data-block-id": attrs.blockId } : {},
      },
      sectionType: {
        default: "generic",
        parseHTML: (el) => el.getAttribute("data-section-type"),
        renderHTML: (attrs) => ({ "data-section-type": attrs.sectionType }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-section-type]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "doc-section" }), 0];
  },

  addNodeView() {
    return (props: NodeViewProps) => {
      if (props.node.attrs.sectionType === "toc") {
        return ReactNodeViewRenderer(TocSectionView)(props);
      }
      // Non-TOC sections use default renderHTML (no React needed)
      return null as any;
    };
  },
});
```

**Step 3: Add `HeadingId` to extensions index**

In `frontend/src/editor/extensions/index.ts`, add:

```typescript
import { HeadingId } from "./heading-id";
```

And add `HeadingId` to the `editorExtensions` array (after `BlockId`):

```typescript
  BlockId,
  HeadingId,
  BlockHandle,
```

**Step 4: Add TOC link hover style to `editor.css`**

In the TOC section of `editor.css`, replace the existing TOC paragraph hover rule:

```css
.editor-content .tiptap .doc-section[data-section-type="toc"] p {
  cursor: pointer;
  padding: 2px 8px !important;
  border-radius: 3px;
  transition: background-color 0.1s ease, color 0.1s ease;
  color: #1d4ed8;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: transparent;
  transition: text-decoration-color 0.15s ease, background-color 0.1s ease;
}

.editor-content .tiptap .doc-section[data-section-type="toc"] p:hover {
  background-color: rgba(29, 78, 216, 0.05) !important;
  text-decoration-color: currentColor;
}
```

**Step 5: Test**

- Upload the Bradford proposal
- Scroll to the TABLE OF CONTENTS section
- It should appear with a yellow background and "TABLE OF CONTENTS" label
- TOC entries should appear as blue underlined links on hover
- Clicking "Cover Letter" should scroll to the Cover Letter heading
- Clicking "Confidentiality Notice" should scroll to that heading

**Step 6: Commit**

```bash
git add frontend/src/editor/extensions/heading-id.ts \
        frontend/src/editor/extensions/doc-section.ts \
        frontend/src/editor/extensions/index.ts \
        frontend/src/styles/editor.css
git commit -m "feat: clickable TOC entries that scroll to matching headings"
```

---

## Task 6: Remove broken canvas output from upload pipeline

**Files:**
- Modify: `backend/app/routers/upload.py`

The old hybrid path produced `pageCanvas` and `positionedImage` nodes. These are no longer generated by the new parser (Task 1+2). But clean up the dead code.

**Step 1: Delete unused functions from `upload.py`**

Remove these functions entirely from `backend/app/routers/upload.py`:
- `_merge_hybrid_docx_content`
- `_extract_sections`
- `_new_block_id`
- `_block_text`
- `_docling_images_to_positioned_nodes`

Also remove the `upload-docling` route (it's now redundant — `/upload?parser=docling` covers it):
```python
# DELETE this entire route:
@router.post("/upload-docling")
async def upload_with_docling(request: Request, file: UploadFile = File(...)):
    ...
```

**Step 2: Update `_resolve_parser`**

The `hybrid` mode now means "docling + colors". Update the docstring:

```python
def _resolve_parser(
    parser: Literal["auto", "legacy", "docling"], lower_filename: str
) -> Literal["legacy", "docling", "hybrid"]:
    if parser == "legacy":
        return "legacy"
    if parser == "docling":
        return "docling"
    # auto: hybrid (docling + python-docx colors) for DOCX; docling-only for everything else
    if lower_filename.endswith(".docx"):
        return "hybrid"
    return "docling"
```

**Step 3: Restart backend and re-upload**

```bash
uvicorn app.main:app --reload --port 8003
```

Upload the Bradford DOCX. Confirm in the browser Network tab that no `pageCanvas` or `positionedImage` nodes appear in the saved version JSON.

**Step 4: Commit**

```bash
git add backend/app/routers/upload.py
git commit -m "chore: remove dead canvas/positioned-image pipeline code"
```

---

## Task 7: Final integration test

**Step 1: Full upload + visual check**

With both backend and frontend running:

1. Delete any existing documents from the list
2. Upload `Bradford_TECHNO_COMMERCIAL PROPOSAL.docx`
3. Open the document and verify:
   - [ ] **Colors**: "NOTICE OF CONFIDENTIALITY" heading appears in cyan/blue (not black)
   - [ ] **Images**: Images appear scattered throughout document (not at the end)
   - [ ] **Images resizable**: Click an image → 8 white handles appear → drag to resize
   - [ ] **Block drag**: Hover any block → ⠿ handle appears → drag → blue indicator line shows → drop works
   - [ ] **TOC**: Yellow "TABLE OF CONTENTS" section → click an entry → scrolls to heading
   - [ ] **Header/Footer**: Blue "HEADER" section at top with logo; "FOOTER" section at bottom with table

**Step 2: Test non-DOCX (if available)**

Upload a PDF → should work via docling-only path (no color enrichment, still inline images).

**Step 3: Commit checklist result**

```bash
git add -A
git commit -m "chore: integration verified — better pandadoc complete"
```

---

## Known Limitations (not in this plan)

- **Color matching**: Text normalization is fuzzy. Very short paragraphs (<20 chars) or paragraphs with special characters may not get colors applied. Can be improved later with paragraph index-based matching.
- **TOC scroll offset**: The `scrollIntoView` doesn't account for the toolbar height. Can add `scroll-margin-top` CSS to headings later.
- **Docling formatting fields**: The exact field names (`formatting.font_name`, `formatting.color`, etc.) may vary by docling version. Check `check_doc.py` output in Task 1 Step 1 and adjust field names in `_map_text_item` if needed.
