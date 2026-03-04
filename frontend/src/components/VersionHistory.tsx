import { useVersions } from "../hooks/useVersions";
import { useUserStore } from "../stores/userStore";
import { timeAgo } from "../utils/time";
import { History, Eye } from "lucide-react";

interface VersionHistoryProps {
  docId: string;
  visible: boolean;
  onRestore?: (content: unknown) => void;
}

export function VersionHistory({ docId, visible, onRestore }: VersionHistoryProps) {
  const { versions, loading, getVersionContent } = useVersions(docId);
  const { users } = useUserStore();

  const getAuthorName = (authorId: string | null) => {
    if (!authorId) return "Unknown";
    const user = users.find((u) => u.id === authorId);
    return user?.name ?? "Unknown";
  };

  const handlePreview = async (versionId: string) => {
    try {
      const { content } = await getVersionContent(versionId);
      onRestore?.(content);
    } catch (e) {
      console.error("Failed to load version:", e);
    }
  };

  if (!visible) return null;

  return (
    <div className="w-[320px] h-full flex flex-col bg-white border-l border-stone-200 shadow-lg font-[var(--font-body)]">
      <div className="flex items-center gap-2 px-4 py-4 border-b border-stone-200 bg-[#FAFAF8]">
        <History size={18} className="text-[#F97066]" strokeWidth={2} />
        <h2 className="font-semibold text-[#0F172A] tracking-tight">Version History</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        {loading ? (
          <VersionHistorySkeleton />
        ) : versions.length === 0 ? (
          <VersionHistoryEmpty />
        ) : (
          <div className="relative">
            {/* Vertical timeline line */}
            <div
              className="absolute left-[7px] top-2 bottom-2 w-px bg-stone-200"
              aria-hidden
            />
            <ul className="space-y-0">
              {versions.map((v) => (
                <li key={v.version_id} className="relative flex gap-4 pl-8 pb-6 last:pb-0 group">
                  {/* Timeline dot */}
                  <div
                    className="absolute left-0 w-4 h-4 rounded-full border-2 border-[#F97066] bg-white z-10 shrink-0 mt-0.5 group-hover:bg-[#FEF2F2] transition-colors"
                    aria-hidden
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[#0F172A]">
                        {v.version_id}
                      </span>
                      <span className="text-xs text-stone-500">
                        {timeAgo(v.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-stone-600 mt-0.5">
                      {getAuthorName(v.author_id)}
                    </p>
                    <p className="text-sm text-stone-500 mt-1 line-clamp-2">
                      {v.message || "No message"}
                    </p>
                    {onRestore && (
                      <button
                        onClick={() => handlePreview(v.version_id)}
                        className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-[#F97066] hover:bg-[#FEF2F2] transition-colors"
                      >
                        <Eye size={14} />
                        Preview
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function VersionHistorySkeleton() {
  return (
    <div className="space-y-5">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex gap-4">
          <div className="w-4 h-4 rounded-full bg-stone-200 shrink-0 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-16 bg-stone-200 rounded animate-pulse" />
            <div className="h-3 w-24 bg-stone-100 rounded animate-pulse" />
            <div className="h-3 w-full max-w-[180px] bg-stone-100 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function VersionHistoryEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <History size={32} className="text-stone-300 mb-3" strokeWidth={1.5} />
      <p className="text-sm text-stone-500 font-medium">No versions yet</p>
      <p className="text-xs text-stone-400 mt-1 max-w-[200px]">
        Versions appear when the document is saved or imported.
      </p>
    </div>
  );
}
