# Collaborative Document Editor — Design Document

## Goal

Build a PandaDocs-class document editor: upload a Word file, edit it as JSON blocks in a rich Tiptap editor with comments, suggest edits, and version history. No real-time collab — single-editor-at-a-time model.

## Architecture

```
Browser (React + Tiptap)
        │
        │ HTTPS REST only
        │
   FastAPI backend
        │
     Postgres
```

Two services. No WebSockets. No Yjs. No CRDT.

### Request Flows

- **Open document**: GET `/api/documents/:id/content` → returns JSON block schema → Tiptap loads via `setContent(json)`
- **Save document**: POST `/api/documents/:id/content` → Tiptap `getJSON()` → backend saves new version to Postgres
- **Upload DOCX**: POST `/api/documents/upload` → backend parses DOCX via `python-docx` → converts to JSON blocks → stores in Postgres → returns `doc_id`
- **Comments**: CRUD via REST, stored in Postgres, anchored to block IDs + text ranges
- **Version history**: Each save creates a new version snapshot. Diffing between versions done server-side.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Vite, Tiptap, Tailwind CSS, Zustand |
| Backend | FastAPI, python-docx, SQLAlchemy (async), Alembic, Pydantic |
| Database | PostgreSQL |
| Deployment | Railway (2 services: frontend static + backend API + Postgres plugin) |

---

## Document Model (JSON Block Schema)

Source of truth is a JSON block tree stored in Postgres. Every top-level node is a block with a stable `blockId` (UUID).

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": {
        "blockId": "b-001",
        "level": 1,
        "textAlign": "left",
        "fontFamily": "Calibri",
        "fontSize": 24,
        "color": "#1a1a1a"
      },
      "content": [
        { "type": "text", "text": "Project Proposal" }
      ]
    },
    {
      "type": "paragraph",
      "attrs": {
        "blockId": "b-002",
        "textAlign": "left",
        "lineHeight": 1.5,
        "fontFamily": "Calibri",
        "fontSize": 11
      },
      "content": [
        { "type": "text", "text": "This section covers " },
        {
          "type": "text",
          "marks": [
            { "type": "bold" },
            { "type": "textStyle", "attrs": { "color": "#2563EB" } }
          ],
          "text": "key deliverables"
        },
        { "type": "text", "text": " for Q4." }
      ]
    },
    {
      "type": "image",
      "attrs": {
        "blockId": "b-003",
        "src": "/api/documents/abc/images/img-001.png",
        "width": 400,
        "height": 250,
        "alignment": "center",
        "alt": "Architecture diagram"
      }
    },
    {
      "type": "table",
      "attrs": { "blockId": "b-004" },
      "content": [
        {
          "type": "tableRow",
          "content": [
            {
              "type": "tableCell",
              "attrs": {
                "colspan": 1,
                "rowspan": 1,
                "backgroundColor": "#2563EB",
                "borderColor": "#1e40af",
                "width": 200
              },
              "content": [
                {
                  "type": "paragraph",
                  "content": [
                    {
                      "type": "text",
                      "marks": [{ "type": "bold" }, { "type": "textStyle", "attrs": { "color": "#ffffff" } }],
                      "text": "Phase"
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### Block types

| Node | Attrs | Purpose |
|------|-------|---------|
| `heading` | blockId, level, textAlign, fontFamily, fontSize, color | Section headings (h1-h6) |
| `paragraph` | blockId, textAlign, lineHeight, fontFamily, fontSize, indent | Body text |
| `image` | blockId, src, width, height, alignment, alt | Positioned images |
| `table` | blockId | Table container |
| `tableRow` | — | Table row |
| `tableCell` | colspan, rowspan, backgroundColor, borderColor, width, verticalAlign | Styled cell |
| `bulletList` | blockId | Unordered list |
| `orderedList` | blockId, start | Numbered list |
| `listItem` | — | List item |
| `blockquote` | blockId | Quote block |
| `codeBlock` | blockId, language | Code snippet |
| `horizontalRule` | blockId | Divider |
| `pageBreak` | blockId | Page break marker |

### Marks (inline formatting)

| Mark | Attrs | Purpose |
|------|-------|---------|
| `bold` | — | Bold text |
| `italic` | — | Italic text |
| `underline` | — | Underlined text |
| `strike` | — | Strikethrough |
| `textStyle` | color, fontFamily, fontSize | Per-run styling |
| `highlight` | color | Background highlight |
| `link` | href, target | Hyperlinks |
| `subscript` | — | Subscript |
| `superscript` | — | Superscript |

---

## DOCX Import Pipeline

Upload flow: DOCX file → `python-docx` parser → JSON block schema → Postgres.

No HTML middleman. DOCX XML → JSON blocks directly.

### What python-docx gives us

```
docx.Document
  └── paragraphs[]
  │     ├── style.name → heading level, list type
  │     ├── alignment → textAlign
  │     ├── paragraph_format (line_spacing, space_before, space_after, first_line_indent)
  │     └── runs[]
  │           ├── text
  │           ├── bold, italic, underline, strike
  │           ├── font.name → fontFamily
  │           ├── font.size → fontSize (in EMU, convert to pt)
  │           └── font.color.rgb → color
  └── tables[]
  │     └── rows[]
  │           └── cells[]
  │                 ├── width
  │                 ├── paragraphs[] (cell content, same structure)
  │                 └── merge info (vertical/horizontal)
  └── inline_shapes[] (images)
        ├── width, height (EMU → px conversion)
        └── image blob (extract, store, generate URL)
```

### Conversion mapping

```python
# Pseudocode for DOCX → JSON block conversion

def convert_document(docx_path: str, doc_id: str) -> dict:
    doc = Document(docx_path)
    blocks = []

    for element in doc.element.body:
        if element.tag.endswith('}p'):  # paragraph
            para = Paragraph(element, doc)
            block = convert_paragraph(para, doc_id)
            blocks.append(block)
        elif element.tag.endswith('}tbl'):  # table
            table = Table(element, doc)
            block = convert_table(table, doc_id)
            blocks.append(block)

    return {"type": "doc", "content": blocks}

def convert_paragraph(para, doc_id) -> dict:
    # Detect heading vs list vs normal paragraph from style
    if para.style.name.startswith('Heading'):
        level = int(para.style.name[-1])
        return {
            "type": "heading",
            "attrs": {
                "blockId": str(uuid4()),
                "level": level,
                "textAlign": map_alignment(para.alignment),
                **extract_font_attrs(para)
            },
            "content": convert_runs(para.runs)
        }

    if para.style.name.startswith('List'):
        return convert_list_item(para)

    return {
        "type": "paragraph",
        "attrs": {
            "blockId": str(uuid4()),
            "textAlign": map_alignment(para.alignment),
            "lineHeight": extract_line_height(para.paragraph_format),
            **extract_font_attrs(para)
        },
        "content": convert_runs(para.runs)
    }

def convert_runs(runs) -> list:
    content = []
    for run in runs:
        marks = []
        if run.bold:
            marks.append({"type": "bold"})
        if run.italic:
            marks.append({"type": "italic"})
        if run.underline:
            marks.append({"type": "underline"})

        style_attrs = {}
        if run.font.name:
            style_attrs["fontFamily"] = run.font.name
        if run.font.size:
            style_attrs["fontSize"] = run.font.size.pt
        if run.font.color and run.font.color.rgb:
            style_attrs["color"] = f"#{run.font.color.rgb}"
        if style_attrs:
            marks.append({"type": "textStyle", "attrs": style_attrs})

        node = {"type": "text", "text": run.text}
        if marks:
            node["marks"] = marks
        content.append(node)
    return content

def convert_table(table, doc_id) -> dict:
    rows = []
    for row in table.rows:
        cells = []
        for cell in row.cells:
            cell_content = []
            for para in cell.paragraphs:
                cell_content.append(convert_paragraph(para, doc_id))
            cells.append({
                "type": "tableCell",
                "attrs": {
                    "colspan": 1,
                    "rowspan": 1,
                    "width": cell.width.pt if cell.width else None,
                    "backgroundColor": extract_cell_shading(cell),
                },
                "content": cell_content or [{"type": "paragraph", "content": []}]
            })
        rows.append({"type": "tableRow", "content": cells})

    return {
        "type": "table",
        "attrs": {"blockId": str(uuid4())},
        "content": rows
    }
```

### Image extraction

Images are extracted from the DOCX zip, stored on disk (or Postgres bytea for demo), and referenced by URL in the JSON:

```python
def extract_images(docx_path: str, doc_id: str) -> dict:
    """Returns {relationship_id: image_url} mapping"""
    image_map = {}
    doc = Document(docx_path)
    for rel in doc.part.rels.values():
        if "image" in rel.reltype:
            image_data = rel.target_part.blob
            filename = f"{uuid4()}.{rel.target_part.content_type.split('/')[-1]}"
            # Store image_data to DB or filesystem
            url = f"/api/documents/{doc_id}/images/{filename}"
            image_map[rel.rId] = {
                "url": url,
                "data": image_data
            }
    return image_map
```

---

## DOCX Export Pipeline

Reverse of import. JSON block schema → WordprocessingML XML → zipped .docx.

Uses `python-docx` to build the DOCX from scratch by walking the block tree.

### How it works

```
JSON block schema (from Postgres)
  → Walk block tree top-down
  → Map each block node to python-docx objects:
      heading     → doc.add_heading(text, level) + apply font attrs
      paragraph   → doc.add_paragraph() + apply alignment, spacing, font per run
      image       → doc.add_picture(image_bytes, width, height)
      table       → doc.add_table(rows, cols) + apply cell widths, shading, borders
      bulletList  → paragraphs with list style
      orderedList → paragraphs with numbered list style
      pageBreak   → paragraph with run.add_break(WD_BREAK.PAGE)
      blockquote  → paragraph with indented style
  → Apply style mappings (textStyle marks → run.font properties)
  → Serialize → .docx file bytes
```

### Conversion mapping (export)

```python
from docx import Document as DocxDocument
from docx.shared import Pt, Inches, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

ALIGN_MAP = {
    "left": WD_ALIGN_PARAGRAPH.LEFT,
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}

def build_docx(content: dict, images: dict) -> bytes:
    """Convert JSON block schema to DOCX file bytes."""
    doc = DocxDocument()
    
    for block in content.get("content", []):
        export_block(doc, block, images)
    
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()

def export_block(doc, block: dict, images: dict):
    node_type = block["type"]
    attrs = block.get("attrs", {})

    if node_type == "heading":
        level = attrs.get("level", 1)
        para = doc.add_heading("", level=level)
        para.alignment = ALIGN_MAP.get(attrs.get("textAlign", "left"))
        apply_inline_content(para, block.get("content", []))

    elif node_type == "paragraph":
        para = doc.add_paragraph()
        para.alignment = ALIGN_MAP.get(attrs.get("textAlign", "left"))
        fmt = para.paragraph_format
        if attrs.get("lineHeight"):
            fmt.line_spacing = attrs["lineHeight"]
        apply_inline_content(para, block.get("content", []))

    elif node_type == "image":
        src = attrs.get("src", "")
        image_data = images.get(src)
        if image_data:
            width = Pt(attrs["width"]) if attrs.get("width") else None
            doc.add_picture(io.BytesIO(image_data), width=width)

    elif node_type == "table":
        export_table(doc, block)

    elif node_type == "bulletList":
        for item in block.get("content", []):
            for para_block in item.get("content", []):
                para = doc.add_paragraph(style="List Bullet")
                apply_inline_content(para, para_block.get("content", []))

    elif node_type == "orderedList":
        for item in block.get("content", []):
            for para_block in item.get("content", []):
                para = doc.add_paragraph(style="List Number")
                apply_inline_content(para, para_block.get("content", []))

    elif node_type == "pageBreak":
        para = doc.add_paragraph()
        run = para.add_run()
        run.add_break(docx.enum.text.WD_BREAK.PAGE)

    elif node_type == "horizontalRule":
        # Add a thin horizontal line via border paragraph
        para = doc.add_paragraph()
        pPr = para._p.get_or_add_pPr()
        pBdr = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:color"), "999999")
        pBdr.append(bottom)
        pPr.append(pBdr)

def apply_inline_content(para, content: list):
    """Map text nodes + marks to python-docx runs with formatting."""
    for node in content:
        if node["type"] != "text":
            continue
        run = para.add_run(node.get("text", ""))
        marks = node.get("marks", [])
        for mark in marks:
            if mark["type"] == "bold":
                run.bold = True
            elif mark["type"] == "italic":
                run.italic = True
            elif mark["type"] == "underline":
                run.underline = True
            elif mark["type"] == "strike":
                run.font.strike = True
            elif mark["type"] == "textStyle":
                mark_attrs = mark.get("attrs", {})
                if mark_attrs.get("fontFamily"):
                    run.font.name = mark_attrs["fontFamily"]
                if mark_attrs.get("fontSize"):
                    run.font.size = Pt(mark_attrs["fontSize"])
                if mark_attrs.get("color"):
                    hex_color = mark_attrs["color"].lstrip("#")
                    run.font.color.rgb = RGBColor.from_string(hex_color)

def export_table(doc, block: dict):
    rows_data = block.get("content", [])
    if not rows_data:
        return
    num_cols = len(rows_data[0].get("content", []))
    table = doc.add_table(rows=0, cols=num_cols)
    
    for row_block in rows_data:
        row = table.add_row()
        for i, cell_block in enumerate(row_block.get("content", [])):
            cell = row.cells[i]
            cell_attrs = cell_block.get("attrs", {})
            
            # Apply cell background color
            if cell_attrs.get("backgroundColor"):
                shading = OxmlElement("w:shd")
                shading.set(qn("w:fill"), cell_attrs["backgroundColor"].lstrip("#"))
                cell._tc.get_or_add_tcPr().append(shading)
            
            # Apply cell width
            if cell_attrs.get("width"):
                cell.width = Pt(cell_attrs["width"])
            
            # Clear default paragraph and add cell content
            cell.paragraphs[0].clear()
            for para_block in cell_block.get("content", []):
                if para_block == cell_block["content"][0]:
                    para = cell.paragraphs[0]
                else:
                    para = cell.add_paragraph()
                apply_inline_content(para, para_block.get("content", []))
```

### Export API

```
POST /api/documents/:id/export    → returns .docx file as download

Response: Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
          Content-Disposition: attachment; filename="document-title.docx"
```

The export reads the latest version's JSON content from `document_versions`, fetches all associated images from `document_images`, runs `build_docx()`, and streams the bytes back.

---

## Data Model (Postgres)

```sql
CREATE TABLE users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    email      TEXT UNIQUE NOT NULL,
    color      TEXT NOT NULL DEFAULT '#3B82F6',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE documents (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title      TEXT NOT NULL,
    created_by UUID REFERENCES users(id),
    status     TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'review', 'final')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE document_versions (
    id         BIGSERIAL PRIMARY KEY,
    doc_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content    JSONB NOT NULL,
    author_id  UUID REFERENCES users(id),
    message    TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_doc_versions_doc ON document_versions(doc_id, created_at DESC);

CREATE TABLE document_images (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    filename   TEXT NOT NULL,
    data       BYTEA NOT NULL,
    mime_type  TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_doc_images_doc ON document_images(doc_id);

CREATE TABLE comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    thread_id  UUID,
    anchor     JSONB NOT NULL,
    author_id  UUID NOT NULL REFERENCES users(id),
    body       TEXT NOT NULL,
    resolved   BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_comments_doc ON comments(doc_id);
CREATE INDEX idx_comments_thread ON comments(thread_id);
```

---

## API Design (FastAPI)

```
# Auth (demo user switching)
POST   /api/auth/switch                    {user_id}
GET    /api/users

# Documents
POST   /api/documents                      {title}
GET    /api/documents
GET    /api/documents/:id
DELETE /api/documents/:id

# DOCX Upload + Import
POST   /api/documents/upload               multipart file
GET    /api/documents/:id/images/:filename  serve stored image

# Document Content (JSON block schema)
GET    /api/documents/:id/content           latest version JSON
POST   /api/documents/:id/content           save new version {content, message?}

# Version History
GET    /api/documents/:id/versions          list versions (id, author, message, created_at)
GET    /api/documents/:id/versions/:vid     get specific version content

# Export
POST   /api/documents/:id/export            returns .docx file bytes as download

# Comments
GET    /api/documents/:id/comments
POST   /api/documents/:id/comments          {anchor, body, thread_id?}
PATCH  /api/documents/:id/comments/:cid     {body?, resolved?}
DELETE /api/documents/:id/comments/:cid
```

---

## Frontend Architecture

### Editor Toolbar

Full word-processor toolbar:
- **Text**: Bold, Italic, Underline, Strikethrough, Subscript, Superscript
- **Font**: Family picker, Size picker, Color picker, Highlight
- **Paragraph**: Alignment (left/center/right/justify), Line height, Indent/Outdent
- **Structure**: Heading level (H1-H6), Bullet list, Numbered list, Blockquote, Code block
- **Insert**: Image, Table, Horizontal rule, Page break
- **Actions**: Undo, Redo, Comment

### Sidebar Panels

- **Comments panel**: List all comments, click to scroll to anchor, reply, resolve
- **Version history panel**: Timeline of saves, click to preview, diff view between versions
- **User switcher**: Dropdown top-left to switch demo users

### Tiptap Extensions Required

```
@tiptap/starter-kit (provides: Document, Paragraph, Text, Bold, Italic, Strike,
                     Code, Heading, BulletList, OrderedList, ListItem, Blockquote,
                     HorizontalRule, HardBreak, History)
@tiptap/extension-underline
@tiptap/extension-text-style
@tiptap/extension-color
@tiptap/extension-highlight
@tiptap/extension-text-align
@tiptap/extension-font-family
@tiptap/extension-image
@tiptap/extension-table
@tiptap/extension-table-row
@tiptap/extension-table-cell
@tiptap/extension-table-header
@tiptap/extension-subscript
@tiptap/extension-superscript
@tiptap/extension-placeholder
@tiptap/extension-character-count
+ custom: FontSize extension (not in starter kit)
+ custom: CommentMark extension (highlight + anchor for comments)
+ custom: BlockId extension (adds blockId attr to all block nodes)
+ custom: PageBreak node
```

---

## Folder Structure

```
colab_doc/
├── README.md
├── docker-compose.yml
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/
│       │   ├── client.ts
│       │   ├── documents.ts
│       │   └── comments.ts
│       ├── editor/
│       │   ├── BlockEditor.tsx
│       │   ├── extensions/
│       │   │   ├── index.ts
│       │   │   ├── font-size.ts
│       │   │   ├── comment-mark.ts
│       │   │   ├── block-id.ts
│       │   │   └── page-break.ts
│       │   └── toolbar/
│       │       ├── EditorToolbar.tsx
│       │       ├── FontControls.tsx
│       │       ├── FormatButtons.tsx
│       │       ├── AlignmentButtons.tsx
│       │       ├── InsertMenu.tsx
│       │       └── ColorPicker.tsx
│       ├── components/
│       │   ├── Layout.tsx
│       │   ├── DocumentList.tsx
│       │   ├── UserSwitcher.tsx
│       │   ├── CommentsSidebar.tsx
│       │   └── VersionHistory.tsx
│       ├── hooks/
│       │   ├── useCurrentUser.ts
│       │   ├── useDocument.ts
│       │   └── useComments.ts
│       ├── stores/
│       │   └── userStore.ts
│       └── styles/
│           ├── globals.css
│           └── editor.css
│
├── backend/
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── alembic.ini
│   ├── alembic/
│   │   └── versions/
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── database.py
│       ├── models/
│       │   ├── user.py
│       │   ├── document.py
│       │   ├── version.py
│       │   ├── image.py
│       │   └── comment.py
│       ├── schemas/
│       │   ├── user.py
│       │   ├── document.py
│       │   ├── version.py
│       │   └── comment.py
│       ├── routers/
│       │   ├── auth.py
│       │   ├── documents.py
│       │   ├── versions.py
│       │   ├── comments.py
│       │   └── images.py
│       ├── services/
│       │   ├── document_service.py
│       │   ├── docx_parser.py        # DOCX → JSON block converter (import)
│       │   ├── docx_builder.py       # JSON blocks → DOCX file (export)
│       │   ├── version_service.py
│       │   └── comment_service.py
│       └── middleware/
│           └── user_context.py
│
└── docker-compose.yml
```

---

## Edge Cases

| Scenario | Mitigation |
|----------|-----------|
| Large DOCX (50+ pages, many images) | Stream image extraction, limit upload to 50MB, async processing with status polling |
| Unsupported DOCX features (SmartArt, charts, WordArt) | Skip gracefully, log warning, show placeholder block with "Unsupported element" |
| Merged table cells | python-docx exposes merge info; map to colspan/rowspan attrs |
| Nested lists (3+ levels) | python-docx tracks indentation level; map to nested list nodes |
| Two users save at same time | Last-write-wins on the version table; both versions preserved in history |
| Image references break after move | Images stored by doc_id + unique filename; URL is stable |
| DOCX with embedded fonts | Fall back to closest web-safe font; preserve font name in attrs for display if available |
| Very long single paragraphs | Tiptap handles these natively; no special handling needed |
