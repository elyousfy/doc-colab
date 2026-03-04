import type { Editor } from "@tiptap/react";
import { useRef } from "react";
import { Image as ImageIcon, Table2, Minus, List, ListOrdered, Code2 } from "lucide-react";
import { ToolbarButton } from "./ToolbarButton";

export function InsertMenu({ editor }: { editor: Editor }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInsertTable = () => {
    const rowsRaw = window.prompt("Table rows (1-20):", "3");
    if (rowsRaw === null) return;
    const colsRaw = window.prompt("Table columns (1-20):", "3");
    if (colsRaw === null) return;

    const rows = Number.parseInt(rowsRaw, 10);
    const cols = Number.parseInt(colsRaw, 10);
    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1 || rows > 20 || cols > 20) {
      window.alert("Please enter valid table size between 1 and 20.");
      return;
    }

    const withHeaderRow = window.confirm("Include header row?");
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run();
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      editor.chain().focus().setImage({ src: dataUrl }).run();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="flex items-center gap-0.5">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageSelect}
      />
      <ToolbarButton
        onClick={() => fileInputRef.current?.click()}
        title="Insert image"
      >
        <ImageIcon size={16} />
      </ToolbarButton>
      <ToolbarButton
        onClick={handleInsertTable}
        title="Insert table"
      >
        <Table2 size={16} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
      >
        <Minus size={16} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet list"
      >
        <List size={16} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Ordered list"
      >
        <ListOrdered size={16} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive("codeBlock")}
        title="Code block"
      >
        <Code2 size={16} />
      </ToolbarButton>
    </div>
  );
}
