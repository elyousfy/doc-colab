import { apiFetch } from "./client";

export interface DocMeta {
  id: string;
  title: string;
  created_by: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface Version {
  version_id: string;
  version_number: number;
  author_id: string | null;
  message: string | null;
  created_at: number;
}

export const documentsApi = {
  list: () => apiFetch<DocMeta[]>("/api/documents"),
  get: (id: string) => apiFetch<DocMeta>(`/api/documents/${id}`),
  create: (title: string) =>
    apiFetch<DocMeta>("/api/documents", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  delete: (id: string) =>
    apiFetch<void>(`/api/documents/${id}`, { method: "DELETE" }),
  getContent: (id: string) =>
    apiFetch<{ version_id: number; content: any }>(`/api/documents/${id}/content`),
  saveContent: (id: string, content: any, message?: string) =>
    apiFetch<{ version_id: number }>(`/api/documents/${id}/content`, {
      method: "POST",
      body: JSON.stringify({ content, message }),
    }),
  listVersions: (id: string) => apiFetch<Version[]>(`/api/documents/${id}/versions`),
  getVersion: (id: string, versionId: string) =>
    apiFetch<{ content: unknown; meta: Version }>(
      `/api/documents/${id}/versions/${versionId}`
    ),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<{ id: string; title: string; images_count: number }>(
      "/api/documents/upload",
      { method: "POST", body: form }
    );
  },
  exportDocx: async (id: string) => {
    const userId = localStorage.getItem("userId") || "";
    const res = await fetch(`/api/documents/${id}/export`, {
      method: "POST",
      headers: { "X-User-Id": userId },
    });
    if (!res.ok) throw new Error("Export failed");
    return res.blob();
  },
};
