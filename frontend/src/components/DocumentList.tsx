import { useState, useEffect, useRef } from "react";
import { documentsApi, type DocMeta } from "../api/documents";
import { Upload, Plus, FileText, Trash2, Clock } from "lucide-react";
import { useUserStore } from "../stores/userStore";

interface DocumentListProps {
  onOpenDocument: (docId: string) => void;
}

export function DocumentList({ onOpenDocument }: DocumentListProps) {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const currentUser = useUserStore((s) => s.currentUser);

  const refresh = async () => {
    setLoading(true);
    try {
      setDocs(await documentsApi.list());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [currentUser]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const result = await documentsApi.upload(file);
      onOpenDocument(result.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed. Please try again.";
      setUploadError(msg);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleCreate = async () => {
    const title = prompt("Document title:", "Untitled Document");
    if (!title) return;
    try {
      const doc = await documentsApi.create(title);
      onOpenDocument(doc.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    if (!confirm("Delete this document?")) return;
    await documentsApi.delete(docId);
    refresh();
  };

  const formatDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 animate-fade-up">
      {/* Hero */}
      <div className="doc-list-hero">
        <h1 className="doc-list-title">Documents</h1>
        <p className="doc-list-subtitle">Create, upload, and collaborate on your documents.</p>
      </div>

      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-2.5 mb-7">
        <button onClick={handleCreate} disabled={uploading} className="btn-primary">
          <Plus size={15} />
          New Document
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="btn-secondary"
          style={{ opacity: uploading ? 0.5 : 1, cursor: uploading ? "not-allowed" : "pointer" }}
        >
          <Upload size={15} />
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.doc,.pptx,.html,.htm,.md,.txt,.jpg,.jpeg,.png,.tiff"
          onChange={handleUpload}
          className="hidden"
        />
      </div>

      {/* Upload progress */}
      {uploading && (
        <div className="upload-banner">
          <span className="upload-spinner" />
          Processing document — this can take 1–2 minutes for large files…
        </div>
      )}
      {uploadError && (
        <div className="error-banner">{uploadError}</div>
      )}

      {/* Document list */}
      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[68px] rounded-[10px] animate-pulse"
              style={{
                background: "linear-gradient(90deg, #e8e4da 0%, #f0ece3 50%, #e8e4da 100%)",
                backgroundSize: "200% 100%",
                animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite`,
              }}
            />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center py-24">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5"
            style={{ background: "var(--color-canvas)", border: "1px solid var(--color-border-strong)" }}
          >
            <FileText size={28} style={{ color: "var(--color-text-muted)" }} />
          </div>
          <p className="text-base font-medium" style={{ color: "var(--color-text-secondary)" }}>
            No documents yet
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
            Create a new document or upload a file to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc, i) => (
            <div
              key={doc.id}
              onClick={() => onOpenDocument(doc.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onOpenDocument(doc.id)}
              className="doc-card group"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              {/* Document icon */}
              <div className="doc-card-icon">
                <FileText size={16} style={{ color: "var(--color-coral)" }} />
              </div>

              {/* Doc info */}
              <div className="flex-1 min-w-0">
                <div
                  className="text-sm font-semibold truncate"
                  style={{ color: "var(--color-navy)", letterSpacing: "-0.01em" }}
                >
                  {doc.title}
                </div>
                <div className="flex items-center gap-2 mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                  <Clock size={11} />
                  <span className="text-xs">{formatDate(doc.updated_at)}</span>
                  <span
                    className="text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded-full"
                    style={{ background: "var(--color-canvas)", color: "var(--color-text-secondary)" }}
                  >
                    {doc.status}
                  </span>
                </div>
              </div>

              {/* Delete */}
              <button
                onClick={(e) => handleDelete(e, doc.id)}
                className="opacity-0 group-hover:opacity-100 p-2 rounded-lg transition-all"
                style={{}}
                title="Delete"
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "#fef2f2";
                  (e.currentTarget as HTMLElement).style.color = "#ef4444";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "#94a3b8";
                }}
              >
                <Trash2 size={15} style={{ color: "inherit" }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
