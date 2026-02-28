import { useState, useEffect } from "react";
import { Layout } from "./components/Layout";
import { DocumentList } from "./components/DocumentList";
import { VersionHistory } from "./components/VersionHistory";
import { CommentsSidebar } from "./components/CommentsSidebar";
import { BlockEditor } from "./editor/BlockEditor";
import { useUserStore } from "./stores/userStore";
import { apiFetch } from "./api/client";
import type { User } from "./stores/userStore";
import { documentsApi } from "./api/documents";
import { ArrowLeft, Download, History, MessageSquare } from "lucide-react";

type View = { type: "list" } | { type: "editor"; docId: string };

function App() {
  const [view, setView] = useState<View>({ type: "list" });
  const { setUsers, switchUser, currentUser } = useUserStore();

  useEffect(() => {
    apiFetch<User[]>("/api/users").then((users) => {
      setUsers(users);
      const savedId = localStorage.getItem("userId");
      const saved = users.find((u) => u.id === savedId);
      switchUser(saved || users[0]);
    });
  }, []);

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-paper)]">
        <div className="w-6 h-6 border-2 border-stone-200 border-t-[var(--color-coral)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Layout onNavigateHome={() => setView({ type: "list" })}>
      {view.type === "list" && (
        <DocumentList onOpenDocument={(docId) => setView({ type: "editor", docId })} />
      )}
      {view.type === "editor" && (
        <EditorView docId={view.docId} onBack={() => setView({ type: "list" })} />
      )}
    </Layout>
  );
}

function EditorView({ docId, onBack }: { docId: string; onBack: () => void }) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [contentToLoad, setContentToLoad] = useState<unknown | null>(null);

  useEffect(() => { setContentToLoad(null); }, [docId]);

  const openHistory = () => {
    setCommentsOpen(false);
    setHistoryVisible((v) => !v);
  };
  const openComments = () => {
    setHistoryVisible(false);
    setCommentsOpen((o) => !o);
  };

  const handleExport = async () => {
    try {
      const blob = await documentsApi.exportDocx(docId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "document.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed:", e);
    }
  };

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      <BlockEditor
        documentId={docId}
        toolbar={true}
        headerLeft={
          <button onClick={onBack} className="btn-ghost">
            <ArrowLeft size={14} />
            Back
          </button>
        }
        headerRight={
          <div className="flex items-center gap-1">
            <button
              onClick={openComments}
              className={`btn-ghost ${commentsOpen ? "active" : ""}`}
              title="Comments"
            >
              <MessageSquare size={14} />
            </button>
            <button
              onClick={openHistory}
              className={`btn-ghost ${historyVisible ? "active" : ""}`}
              title="Version history"
            >
              <History size={14} />
            </button>
            <div className="w-px h-4 bg-stone-200 mx-1" />
            <button onClick={handleExport} className="btn-ghost" style={{ color: "var(--color-coral)" }}>
              <Download size={14} />
              Export
            </button>
          </div>
        }
        sidebar={
          commentsOpen ? (
            <CommentsSidebar docId={docId} visible={true} />
          ) : historyVisible ? (
            <VersionHistory
              docId={docId}
              visible={true}
              onRestore={(content) => setContentToLoad(content)}
            />
          ) : null
        }
        contentToLoad={contentToLoad}
      />
    </div>
  );
}

export default App;
