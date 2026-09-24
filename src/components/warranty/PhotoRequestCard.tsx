"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, X, ImagePlus } from "lucide-react";

export interface ChatPhoto {
  id: string;
  url: string | null;
  fileName: string;
}

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

/**
 * Shrinks a phone photo to at most MAX_EDGE px as a JPEG, so a 6–8 MB camera
 * shot uploads fast and fits the server's image limit. Anything the browser
 * cannot decode (some HEIC files outside Safari) is sent as-is and the server
 * says plainly if it cannot take it.
 */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/**
 * Shown when the warranty agent is ready to file a ticket: the homeowner adds
 * photos of the issue, then Done (or Skip) files it.
 */
export default function PhotoRequestCard({
  companyId,
  conversationId,
  max,
  themeColor,
  disabled,
  onFinish,
}: {
  companyId: string;
  conversationId: string | null;
  max: number;
  themeColor: string;
  disabled?: boolean;
  onFinish: (photoCount: number) => void;
}) {
  const [photos, setPhotos] = useState<ChatPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const remaining = max - photos.length;

  const upload = async (list: FileList | null) => {
    if (!list?.length || !conversationId) return;
    setError("");
    const picked = Array.from(list).slice(0, remaining);
    if (list.length > remaining) setError(`Only ${max} photos in total — added the first ${picked.length}.`);
    setBusy(true);
    try {
      const body = new FormData();
      body.append("companyId", companyId);
      body.append("conversationId", conversationId);
      for (const file of await Promise.all(picked.map(shrink))) body.append("photos", file);
      const res = await fetch("/api/public/warranty/chat/photos", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not upload the photos");
      setPhotos(data.photos || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the photos");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (photo: ChatPhoto) => {
    if (!conversationId) return;
    setBusy(true);
    setError("");
    try {
      const qs = new URLSearchParams({ companyId, conversationId });
      const res = await fetch(`/api/public/warranty/chat/photos/${photo.id}?${qs}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not remove the photo");
      setPhotos(data.photos || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the photo");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ml-8 w-full max-w-md space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <Camera className="h-4 w-4" style={{ color: themeColor }} />
        Add photos of the issue
        <span className="ml-auto text-xs font-normal text-slate-500">{photos.length}/{max}</span>
      </p>

      <div className="grid grid-cols-3 gap-2">
        {photos.map((p) => (
          <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
            {p.url && <img src={p.url} alt={p.fileName} className="h-full w-full object-cover" />}
            <button
              type="button"
              onClick={() => remove(p)}
              disabled={busy || disabled}
              aria-label={`Remove ${p.fileName}`}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy || disabled || !conversationId}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
            {busy ? "Uploading…" : "Add photo"}
          </button>
        )}
      </div>

      {/* image/* lets a phone offer the camera as well as the photo library. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => upload(e.target.files)}
      />

      {error && <p className="text-xs text-rose-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onFinish(photos.length)}
          disabled={busy || disabled || photos.length === 0}
          className="flex-1 rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: themeColor }}
        >
          Done
        </button>
        <button
          type="button"
          onClick={() => onFinish(0)}
          disabled={busy || disabled}
          className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Skip — can&apos;t take photos now
        </button>
      </div>
    </div>
  );
}
