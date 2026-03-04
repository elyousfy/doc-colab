# Better PandaDoc — Design Document
*2026-02-27*

## Problem Statement

The current document editor has two parser modes with complementary weaknesses:

| Mode | Content Quality | Formatting | Image Placement |
|------|----------------|-----------|-----------------|
| Legacy (python-docx) | Below average | Excellent (colors, fonts) | Good (inline) |
| Docling | 10/10 | Markdown-like (no colors) | Broken (canvas at end) |

Goal: combine the best of both — docling's content quality + python-docx's colors + correct inline image placement + polished block editing UX.

---

## Architecture Decisions

### Decision 1: Parser Strategy

**Docling as primary, python-docx for color enrichment only.**

Rationale:
- Docling already captures bold, italic, font size, and correct reading order
- Docling's only missing formatting: text colors (rgb values)
- Python-docx reliably extracts per-run colors via `run.font.color.rgb`
- Simpler than maintaining two content extraction paths

Flow for DOCX:
1. Parse with Docling → get content in reading order + image provenance
2. Parse with python-docx → build `{normalized_text → color_marks}` lookup
3. Walk Docling output, for each text node look up color from python-docx and apply

For non-DOCX (PDF, PPTX, etc.): Docling only (no change).

### Decision 2: Image Placement

**Reading-order interleaving via provenance bounding boxes.**

Rationale:
- Docling attaches `prov: [{page_no, bbox: {l, t, r, b, coord_origin}}]` to every item (texts + pictures)
- Sorting ALL items by `(page_no, -bbox.t)` (BOTTOMLEFT origin) gives exact top-to-bottom reading order
- Images appear inline immediately after the text that precedes them on the page
- Eliminates `pageCanvas` and `positionedImage` for imported content
- Images become standard `image` blocks — first-class blocks in the document flow

### Decision 3: Image Editing UX

**Images as draggable, resizable blocks — same model as PandaDoc.**

- Images are block-level nodes (not inline in a text run)
- The block handle (⠿) appears on hover — drag to reorder anywhere in document
- Resize handles on all 4 corners + 4 edges (not just bottom-right)
- No free-float/canvas positioning for imported images (keeps model simple)

### Decision 4: Block Drag-and-Drop

**Fix existing block handle implementation:**
- Add visual drop indicator (blue horizontal line) between blocks during drag
- Fix `findBlockAtCoords` to detect blocks inside nested `docSection` nodes
- Add `docSection` and `image` to `TOP_LEVEL_NODES`

### Decision 5: Table of Contents

**Clickable anchor links.**
- Extend Tiptap `Heading` node to render with `id={blockId}`
- When a `docSection[sectionType=toc]` is rendered, wrap each entry text in `<a>` that scrolls to the matching heading `blockId`
- Matching: by normalized paragraph text (strip page numbers, match heading text)

---

## Backend Changes

### `backend/app/services/docling_parser.py`

**Rewrite `_docling_json_to_tiptap`:**

```
OLD: tree traversal → many unplaced images appended at end under "Imported Images" heading
NEW:
  1. Collect ALL items (texts + tables + pictures) with their prov[0].bbox
  2. Sort by (page_no, -bbox.t) for BOTTOMLEFT, or (page_no, bbox.t) for TOPLEFT
  3. Items without prov are appended at end
  4. Emit each item as its tiptap node type in sorted order
  5. Pictures become standard image nodes (type: "image") with width/height from image.size
```

**Remove:** `_place_unmapped_pictures`, `_find_anchor_index`, canvas/positioned-image logic, the "Imported Images" heading fallback.

### New: `backend/app/services/color_enricher.py`

```python
def build_color_map(file_bytes: bytes) -> dict[str, list[dict]]:
    """Returns {normalized_text: [textStyle marks with color]}"""

def enrich_tiptap_with_colors(content: dict, color_map: dict) -> dict:
    """Walk tiptap JSON, for each text node look up color by paragraph text."""
```

Matching strategy: for each `paragraph` or `heading` node, concatenate its text content, normalize (strip, lowercase), look up in color_map, apply the color mark to all text nodes in that block.

### `backend/app/routers/upload.py`

**Hybrid mode for DOCX:**
```
OLD: docling body + legacy headers/footers + legacy images
NEW:
  if DOCX:
    content, images = parse_with_docling(file_bytes, filename)  # reads order + images
    color_map = build_color_map(file_bytes)                      # python-docx colors
    content = enrich_tiptap_with_colors(content, color_map)     # apply colors
  else:
    content, images = parse_with_docling(file_bytes, filename)  # non-DOCX: docling only
```

**Remove:** the `_merge_hybrid_docx_content` function, `_docling_images_to_positioned_nodes`, `_extract_sections` — these are no longer needed.

---

## Frontend Changes

### `frontend/src/editor/extensions/block-handle.ts`

**Drop indicator:**
- During `dragover`, find the nearest block gap and render a blue `<div class="block-drop-indicator">` at that position
- On `drop` or `dragleave`, remove the indicator

**Fix nested block detection:**
- `findBlockAtCoords` currently only scans `doc.childCount` (top-level)
- For blocks inside `docSection`, also scan children of `docSection` nodes
- Add `docSection` and `image` to `TOP_LEVEL_NODES`

**Visual improvements:**
- Gear icon (⚙) replaces the current multi-button action menu trigger (matches PandaDoc)
- Menu stays visible until user clicks elsewhere

### `frontend/src/editor/extensions/custom-image.ts`

**Full resize handles:**
- Enable all 8 resize directions (all 4 corners + all 4 edges)
- Preserve aspect ratio option (hold Shift)
- Min size 50×50px

**Block-level image:**
- Ensure image is `group: "block"` not inline — so block handle attaches to it

### `frontend/src/editor/extensions/heading-id.ts` (new)

```typescript
// Extend StarterKit Heading to add id attribute from blockId
// renderHTML: adds id={blockId} to the heading DOM element
```

### `frontend/src/editor/extensions/doc-section.ts`

**TOC section rendering:**
- When `sectionType === "toc"`, wrap the section in a `<div class="doc-section toc-section">`
- Post-process: for each paragraph inside TOC section, detect the entry text, strip trailing page number (`…. 12`), look up matching heading by text, wrap in `<a data-toc-target={blockId}>`
- Clicking fires `document.getElementById(blockId)?.scrollIntoView({ behavior: "smooth" })`

### Remove / Deprecate

- `page-canvas.ts` — no longer used for imported content (keep file, just not used in hybrid output)
- `positioned-image.tsx` — same, keep for potential manual use but not generated by parser

---

## Data Flow Diagram

```
Upload DOCX
    │
    ├── Docling converter
    │   └── export_to_dict()
    │       ├── texts[]: {text, label, prov: [{page_no, bbox}], formatting: {bold, italic}}
    │       ├── pictures[]: {image: {uri, size}, prov: [{page_no, bbox}]}
    │       └── tables[]: {data: {grid}, prov}
    │
    ├── Sort all items by (page_no, -bbox.t)
    │   └── Emit as Tiptap JSON nodes in order
    │       ├── texts → paragraph / heading
    │       ├── pictures → image {src: __IMAGE__filename, width, height}
    │       └── tables → table
    │
    ├── python-docx color extraction
    │   └── build_color_map() → {normalized_text: [{type: textStyle, attrs: {color: #rrggbb}}]}
    │
    └── enrich_tiptap_with_colors()
        └── Final Tiptap JSON with correct content + reading order + inline images + colors
```

---

## Success Criteria

1. Upload Bradford proposal → headings appear in correct cyan color
2. Images appear inline at their original page positions (not appended at end)
3. Dragging a block shows a blue drop indicator and correctly reorders on drop
4. Images have 8 resize handles; dragging the block handle reorders them
5. Clicking a TOC entry scrolls to the matching heading
6. Non-DOCX files (PDF) still work via docling-only path
