import { apiFetch } from "./client";

export interface Comment {
  id: string;
  thread_id: string | null;
  anchor: { blockId?: string; from?: number; to?: number };
  author_id: string;
  body: string;
  resolved: boolean;
  created_at: number;
  updated_at: number;
}

export const commentsApi = {
  list: (docId: string) => apiFetch<Comment[]>(`/api/documents/${docId}/comments`),
  create: (docId: string, data: { anchor: any; body: string; thread_id?: string }) =>
    apiFetch<Comment>(`/api/documents/${docId}/comments`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (docId: string, commentId: string, data: { body?: string; resolved?: boolean }) =>
    apiFetch<Comment>(`/api/documents/${docId}/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  delete: (docId: string, commentId: string) =>
    apiFetch<void>(`/api/documents/${docId}/comments/${commentId}`, {
      method: "DELETE",
    }),
};
