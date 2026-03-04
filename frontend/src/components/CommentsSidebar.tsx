import { useState } from "react";
import { useComments } from "../hooks/useComments";
import { useUserStore } from "../stores/userStore";
import type { Comment } from "../api/comments";
import { MessageSquare, Send, Check, Reply, Trash2 } from "lucide-react";

interface CommentsSidebarProps {
  docId: string;
  visible: boolean;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getUserForComment(authorId: string, users: { id: string; name: string; color: string }[]) {
  const user = users.find((u) => u.id === authorId);
  return user ?? { id: authorId, name: "Unknown", color: "#94a3b8" };
}

function CommentItem({
  comment,
  users,
  currentUserId,
  isReply,
  onResolve,
  onUnresolve,
  onDelete,
  replyingToId,
  setReplyingToId,
  replyBody,
  setReplyBody,
  submitReply,
}: {
  comment: Comment;
  users: { id: string; name: string; color: string }[];
  currentUserId: string;
  isReply: boolean;
  onResolve: () => void;
  onUnresolve: () => void;
  onDelete: () => void;
  replyingToId: string | null;
  setReplyingToId: (id: string | null) => void;
  replyBody: string;
  setReplyBody: (s: string) => void;
  submitReply: () => void;
}) {
  const user = getUserForComment(comment.author_id, users);
  const initial = user.name.charAt(0).toUpperCase();
  const isOwn = comment.author_id === currentUserId;
  const isReplying = replyingToId === comment.id;

  return (
    <div
      className={`group ${isReply ? "ml-6 pl-4 border-l-2 border-stone-200" : ""} ${
        comment.resolved ? "opacity-60" : ""
      }`}
    >
      <div className="flex gap-3 py-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-sm font-medium"
          style={{ backgroundColor: user.color }}
        >
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-[var(--color-navy)]">{user.name}</span>
            <span className="text-xs text-stone-400">{formatTime(comment.created_at)}</span>
            {isOwn && (
              <button
                onClick={onDelete}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-stone-400 hover:text-[var(--color-coral)] hover:bg-[var(--color-coral-light)] transition-all"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
          <p className="text-sm text-stone-600 mt-0.5 whitespace-pre-wrap">{comment.body}</p>
          {!isReply && (
            <div className="flex items-center gap-2 mt-1.5">
              <button
                onClick={() => (comment.resolved ? onUnresolve() : onResolve())}
                className="flex items-center gap-1 text-xs text-stone-500 hover:text-[var(--color-coral)] transition-colors"
              >
                <Check size={12} />
                {comment.resolved ? "Unresolve" : "Resolve"}
              </button>
              <button
                onClick={() => setReplyingToId(isReplying ? null : comment.id)}
                className="flex items-center gap-1 text-xs text-stone-500 hover:text-[var(--color-coral)] transition-colors"
              >
                <Reply size={12} />
                Reply
              </button>
            </div>
          )}
        </div>
      </div>
      {!isReply && isReplying && (
        <div className="ml-11 mt-2 flex gap-2">
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Write a reply…"
            className="flex-1 resize-none rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-coral)]/30 focus:border-[var(--color-coral)]"
            rows={2}
            autoFocus
          />
          <button
            onClick={submitReply}
            disabled={!replyBody.trim()}
            className="self-end p-2 rounded-lg bg-[var(--color-coral)] text-white hover:bg-[var(--color-coral)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export function CommentsSidebar({ docId, visible }: CommentsSidebarProps) {
  const { users, currentUser } = useUserStore();
  const {
    comments,
    loading,
    addComment,
    resolveComment,
    unresolveComment,
    deleteComment,
  } = useComments(docId);

  const [showAddInput, setShowAddInput] = useState(false);
  const [newCommentBody, setNewCommentBody] = useState("");
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const rootComments = comments.filter((c) => !c.thread_id);
  const repliesByThread = comments.reduce<Record<string, Comment[]>>((acc, c) => {
    if (c.thread_id) {
      if (!acc[c.thread_id]) acc[c.thread_id] = [];
      acc[c.thread_id].push(c);
    }
    return acc;
  }, {});

  const handleAddComment = async () => {
    const body = newCommentBody.trim();
    if (!body || !currentUser) return;
    try {
      await addComment({}, body);
      setNewCommentBody("");
      setShowAddInput(false);
    } catch (e) {
      console.error("Failed to add comment:", e);
    }
  };

  const handleReply = async (threadId: string) => {
    const body = replyBody.trim();
    if (!body) return;
    try {
      await addComment({}, body, threadId);
      setReplyBody("");
      setReplyingToId(null);
    } catch (e) {
      console.error("Failed to reply:", e);
    }
  };

  if (!visible) return null;

  return (
    <aside className="w-[320px] flex-shrink-0 h-full flex flex-col bg-white border-l border-stone-200 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
        <h2 className="font-[var(--font-display)] text-lg text-[var(--color-navy)]">
          Comments
        </h2>
        <span className="text-sm text-stone-500">{comments.length}</span>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <button
          onClick={() => setShowAddInput(!showAddInput)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-stone-300 text-stone-500 hover:border-[var(--color-coral)] hover:text-[var(--color-coral)] transition-colors text-sm mb-4"
        >
          <MessageSquare size={16} />
          Add Comment
        </button>

        {showAddInput && (
          <div className="flex gap-2 mb-4">
            <textarea
              value={newCommentBody}
              onChange={(e) => setNewCommentBody(e.target.value)}
              placeholder="Write a comment…"
              className="flex-1 resize-none rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-coral)]/30 focus:border-[var(--color-coral)]"
              rows={3}
              autoFocus
            />
            <div className="flex flex-col gap-1">
              <button
                onClick={handleAddComment}
                disabled={!newCommentBody.trim()}
                className="p-2 rounded-lg bg-[var(--color-coral)] text-white hover:bg-[var(--color-coral)]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={16} />
              </button>
              <button
                onClick={() => {
                  setShowAddInput(false);
                  setNewCommentBody("");
                }}
                className="p-2 rounded-lg text-stone-400 hover:bg-stone-100 transition-colors text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-stone-400 text-sm">
            Loading comments…
          </div>
        ) : rootComments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare size={36} className="text-stone-300 mb-2" />
            <p className="text-sm text-stone-500">No comments yet</p>
            <p className="text-xs text-stone-400 mt-1">Add a comment to start the conversation</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rootComments.map((comment) => (
              <div key={comment.id}>
                <CommentItem
                  comment={comment}
                  users={users}
                  currentUserId={currentUser?.id ?? ""}
                  isReply={false}
                  onResolve={() => resolveComment(comment.id)}
                  onUnresolve={() => unresolveComment(comment.id)}
                  onDelete={() => deleteComment(comment.id)}
                  replyingToId={replyingToId}
                  setReplyingToId={setReplyingToId}
                  replyBody={replyBody}
                  setReplyBody={setReplyBody}
                  submitReply={() => handleReply(comment.id)}
                />
                {(repliesByThread[comment.id] ?? []).map((reply) => (
                  <CommentItem
                    key={reply.id}
                    comment={reply}
                    users={users}
                    currentUserId={currentUser?.id ?? ""}
                    isReply
                    onResolve={() => {}}
                    onUnresolve={() => {}}
                    onDelete={() => deleteComment(reply.id)}
                    replyingToId={replyingToId}
                    setReplyingToId={setReplyingToId}
                    replyBody={replyBody}
                    setReplyBody={setReplyBody}
                    submitReply={() => {}}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
