import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useCallback, useRef, useState } from "react";
import { editorExtensions } from "./extensions";
import { documentsApi } from "../api/documents";
import { EditorToolbar } from "./toolbar";

interface BlockEditorProps {
  documentId: string;
  toolbar?: React.ReactNode | true;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  sidebar?: React.ReactNode;
  contentToLoad?: unknown | null;
}

export function BlockEditor({ documentId, toolbar, headerLeft, headerRight, sidebar, contentToLoad }: BlockEditorProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const editor = useEditor({
    extensions: editorExtensions,
    editorProps: {
      attributes: { class: "focus:outline-none" },
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (contentToLoad != null) {
      editor.commands.setContent(contentToLoad);
      return;
    }
    documentsApi.getContent(documentId).then(({ content }) => {
      editor.commands.setContent(content);
    }).catch(console.error);
  }, [editor, documentId, contentToLoad]);

  const autoSave = useCallback(() => {
    if (!editor) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const content = editor.getJSON();
        await documentsApi.saveContent(documentId, content, "Auto-save");
        setLastSaved(new Date());
      } catch (e) {
        console.error("Auto-save failed:", e);
      } finally {
        setSaving(false);
      }
    }, 2000);
  }, [editor, documentId]);

  useEffect(() => {
    if (!editor) return;
    editor.on("update", autoSave);
    return () => { editor.off("update", autoSave); };
  }, [editor, autoSave]);

  if (!editor) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-stone-200 border-t-[var(--color-coral)] rounded-full animate-spin" />
      </div>
    );
  }

  const toolbarContent = toolbar === true ? <EditorToolbar editor={editor} /> : toolbar;
  const hasHeaderExtras = headerLeft != null || headerRight != null;

  return (
    <div className="flex flex-col h-full flex-1 min-w-0">
      {/* Toolbar / sub-header row */}
      <div className="editor-header shrink-0">
        {headerLeft}
        {toolbarContent}
        <div className="flex-1 min-w-0" />
        {headerRight}
      </div>

      {/* Editor + sidebar */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-auto editor-canvas p-10 min-w-0">
          <div className="max-w-[816px] mx-auto editor-document-page pl-20 pr-16 py-14 editor-content animate-fade-up">
            <EditorContent editor={editor} />
          </div>
        </div>
        {sidebar}
      </div>

      {/* Status bar */}
      <div className="editor-statusbar shrink-0">
        {saving ? (
          <span className="save-indicator text-amber-500">
            <span className="upload-spinner inline-block w-3 h-3 mr-1" style={{ border: "2px solid #fcd34d", borderTopColor: "#f59e0b" }} />
            Saving…
          </span>
        ) : lastSaved ? (
          <span className="save-indicator">
            <span className="save-dot" />
            Saved {lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : null}
        <span className="ml-auto">
          {editor.storage.characterCount.characters().toLocaleString()} characters
        </span>
      </div>
    </div>
  );
}

export { type BlockEditorProps };
