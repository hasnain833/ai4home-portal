"use client"

import { CheckCircle2, FileText, Loader2, X, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import type { UploadItem } from "@/lib/use-upload-queue"
import { Button } from "@/components/ui/button"

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Per-file progress for a batch upload. While it runs: exact progress and a cancel for each file.
 * Once it's over: what uploaded and what didn't, listed separately with the reason.
 */
function UploadList({
  items,
  onCancel,
  onDismiss,
  className,
}: {
  items: UploadItem[]
  onCancel: (id: string) => void
  onDismiss: () => void
  className?: string
}) {
  if (!items.length) return null
  const busy = items.some((x) => x.status === "queued" || x.status === "uploading")
  const done = items.filter((x) => x.status === "done")
  const failed = items.filter((x) => x.status === "failed" || x.status === "cancelled")

  return (
    <div className={cn("rounded-lg border border-border bg-card p-3 text-sm", className)} aria-live="polite">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-medium">
          {busy
            ? `Uploading… ${done.length + failed.length} of ${items.length} finished`
            : failed.length === 0
              ? `${done.length} file${done.length === 1 ? "" : "s"} uploaded`
              : `${done.length} uploaded, ${failed.length} not uploaded`}
        </p>
        {!busy && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </div>

      {busy ? (
        <ul className="space-y-2">
          {items.map((x) => (
            <Row key={x.id} item={x} onCancel={onCancel} />
          ))}
        </ul>
      ) : (
        <div className="space-y-3">
          {failed.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-destructive">Not uploaded</p>
              <ul className="space-y-1.5">
                {failed.map((x) => (
                  <Row key={x.id} item={x} onCancel={onCancel} />
                ))}
              </ul>
            </div>
          )}
          {done.length > 0 && (
            <div>
              {failed.length > 0 && <p className="mb-1 text-xs font-medium text-muted-foreground">Uploaded</p>}
              <ul className="space-y-1.5">
                {done.map((x) => (
                  <Row key={x.id} item={x} onCancel={onCancel} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ item, onCancel }: { item: UploadItem; onCancel: (id: string) => void }) {
  const pct = item.size ? Math.min(100, Math.round((item.loaded / item.size) * 100)) : 0
  const active = item.status === "queued" || item.status === "uploading"
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-muted-foreground">
        {item.status === "done" ? (
          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
        ) : item.status === "failed" || item.status === "cancelled" ? (
          <XCircle className="size-4 text-destructive" aria-hidden />
        ) : item.status === "uploading" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <FileText className="size-4" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate" title={item.name}>{item.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {item.status === "uploading"
              ? `${formatBytes(item.loaded)} of ${formatBytes(item.size)} · ${pct}%`
              : item.status === "queued"
                ? `Waiting · ${formatBytes(item.size)}`
                : formatBytes(item.size)}
          </span>
        </div>
        {item.status === "uploading" && (
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={`Uploading ${item.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        )}
        {(item.status === "failed" || item.status === "cancelled") && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.status === "cancelled" ? "Cancelled" : item.error || "Upload failed"}
          </p>
        )}
      </div>
      {active && (
        <button
          type="button"
          onClick={() => onCancel(item.id)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Cancel ${item.name}`}
        >
          <X className="size-4" />
        </button>
      )}
    </li>
  )
}

export { UploadList }
