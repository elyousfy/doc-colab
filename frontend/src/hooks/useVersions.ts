import { useState, useEffect, useCallback } from "react";
import { documentsApi, type Version } from "../api/documents";

export function useVersions(docId: string) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!docId) return;
    setLoading(true);
    try {
      const data = await documentsApi.listVersions(docId);
      setVersions([...data].reverse());
    } catch (e) {
      console.error("Failed to load versions:", e);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const getVersionContent = async (versionId: string) => {
    return documentsApi.getVersion(docId, versionId);
  };

  return { versions, loading, refresh, getVersionContent };
}
