"use client";

import { useCallback, useRef, useState } from "react";
import { errorMessage, isAbort } from "./api";

export type UploadStatus = "queued" | "uploading" | "done" | "failed" | "cancelled";

export type UploadItem = {
  id: string;
  name: string;
  size: number;
  loaded: number;
  status: UploadStatus;
  error?: string;
};

type Send<R> = (file: File, opts: { signal: AbortSignal; onProgress: (loaded: number, total: number) => void }) => Promise<R>;

/**
 * Uploads files one after another, tracking progress per file, with a cancel for each.
 * `validate` returns a reason to skip a file (wrong type, too big) before it is sent.
 */
export function useUploadQueue() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  // Files cancelled before their turn came; the loop checks this, since it can't see state updates.
  const cancelledEarly = useRef(new Set<string>());

  const update = (id: string, patch: Partial<UploadItem>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const run = useCallback(
    async <R>(files: File[], send: Send<R>, { validate, onUploaded }: { validate?: (f: File) => string | null; onUploaded?: (f: File, result: R) => void } = {}) => {
      const batch = files.map((file) => {
        const reason = validate?.(file) ?? null;
        return {
          file,
          item: {
            id: crypto.randomUUID(),
            name: file.name,
            size: file.size,
            loaded: 0,
            status: reason ? "failed" : "queued",
            error: reason ?? undefined,
          } as UploadItem,
        };
      });
      setItems(batch.map((b) => b.item));
      const counts = { done: 0, failed: batch.filter((b) => b.item.status === "failed").length, cancelled: 0 };

      for (const { file, item } of batch) {
        if (item.status === "failed") continue;
        if (cancelledEarly.current.delete(item.id)) {
          counts.cancelled++;
          continue;
        }
        const controller = new AbortController();
        controllers.current.set(item.id, controller);
        update(item.id, { status: "uploading" });
        try {
          const result = await send(file, {
            signal: controller.signal,
            onProgress: (loaded) => update(item.id, { loaded }),
          });
          update(item.id, { status: "done", loaded: item.size });
          counts.done++;
          onUploaded?.(file, result);
        } catch (e) {
          if (isAbort(e)) {
            update(item.id, { status: "cancelled" });
            counts.cancelled++;
          } else {
            update(item.id, { status: "failed", error: errorMessage(e) });
            counts.failed++;
          }
        } finally {
          controllers.current.delete(item.id);
        }
      }
      return counts;
    },
    [],
  );

  /** Cancels a file that is uploading, or drops one still waiting its turn. */
  const cancel = useCallback((id: string) => {
    const c = controllers.current.get(id);
    if (c) return c.abort();
    cancelledEarly.current.add(id);
    setItems((xs) => xs.map((x) => (x.id === id && x.status === "queued" ? { ...x, status: "cancelled" } : x)));
  }, []);

  const clear = useCallback(() => setItems([]), []);
  const busy = items.some((x) => x.status === "queued" || x.status === "uploading");

  return { items, busy, run, cancel, clear };
}
