import { useState, useEffect, useCallback } from "react";
import { commentsApi, type Comment } from "../api/comments";

export function useComments(docId: string) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await commentsApi.list(docId);
      setComments(data);
    } catch (e) {
      console.error("Failed to load comments:", e);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addComment = async (anchor: object, body: string, threadId?: string) => {
    const comment = await commentsApi.create(docId, {
      anchor,
      body,
      thread_id: threadId,
    });
    setComments((prev) => [...prev, comment]);
    return comment;
  };

  const resolveComment = async (commentId: string) => {
    await commentsApi.update(docId, commentId, { resolved: true });
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, resolved: true } : c))
    );
  };

  const unresolveComment = async (commentId: string) => {
    await commentsApi.update(docId, commentId, { resolved: false });
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, resolved: false } : c))
    );
  };

  const deleteComment = async (commentId: string) => {
    await commentsApi.delete(docId, commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
  };

  return {
    comments,
    loading,
    addComment,
    resolveComment,
    unresolveComment,
    deleteComment,
    refresh,
  };
}
