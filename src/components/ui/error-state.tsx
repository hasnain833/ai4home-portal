"use client"

import { AlertTriangle, Clock, RotateCw, WifiOff } from "lucide-react"

import { ApiError, TIMEOUT_STATUS, errorMessage } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"

/** apiFetch reports "couldn't reach the server" as status 0. */
export function isConnectionError(error: unknown) {
  return error instanceof ApiError && error.status === 0
}

/**
 * Shown in place of a list or panel whose data failed to load, so a failed
 * request never looks like "you have nothing yet".
 */
function ErrorState({
  error,
  title,
  onRetry,
  size = "default",
  className,
}: {
  error?: unknown
  title?: string
  onRetry?: () => void
  size?: "default" | "sm"
  className?: string
}) {
  const offline = isConnectionError(error)
  const timedOut = error instanceof ApiError && error.status === TIMEOUT_STATUS
  return (
    <EmptyState
      size={size}
      className={className}
      icon={offline ? WifiOff : timedOut ? Clock : AlertTriangle}
      title={title ?? (offline ? "You're offline" : timedOut ? "This is taking too long" : "Something went wrong")}
      description={
        offline
          ? "We couldn't reach the server. Check your internet connection, then try again."
          : error
            ? errorMessage(error)
            : "This couldn't be loaded. Please try again."
      }
      action={
        onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCw className="size-4" />
            Try again
          </Button>
        )
      }
    />
  )
}

export { ErrorState }
