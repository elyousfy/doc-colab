import type { Editor } from "@tiptap/react";
import { FormatButtons } from "./FormatButtons";
import { FontControls } from "./FontControls";
import { AlignmentButtons } from "./AlignmentButtons";
import { InsertMenu } from "./InsertMenu";
import { HistoryButtons } from "./HistoryButtons";

interface ToolbarProps {
  editor: Editor;
}

export function EditorToolbar({ editor }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 px-3 py-1.5 bg-[#FAFAF8] border-b border-stone-200 sticky top-0 z-20">
      <HistoryButtons editor={editor} />
      <Separator />
      <FontControls editor={editor} />
      <Separator />
      <FormatButtons editor={editor} />
      <Separator />
      <AlignmentButtons editor={editor} />
      <Separator />
      <InsertMenu editor={editor} />
    </div>
  );
}

function Separator() {
  return <div className="w-px h-6 bg-stone-200 mx-1" />;
}
