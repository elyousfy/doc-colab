import type { Editor } from "@tiptap/react";
import { Undo2, Redo2 } from "lucide-react";
import { ToolbarButton } from "./ToolbarButton";

export function HistoryButtons({ editor }: { editor: Editor }) {
  return (
    <div className="flex items-center gap-0.5">
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo"
      >
        <Undo2 size={16} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo"
      >
        <Redo2 size={16} />
      </ToolbarButton>
    </div>
  );
}
