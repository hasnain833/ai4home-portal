import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * One look for every "nothing here" screen. Two flavours, picked by the caller:
 * - first run (no data yet): say what this list is for and offer the first step;
 * - no results (filters/search hid everything): say so and offer to clear them.
 */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "default",
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  size?: "default" | "sm"
  className?: string
}) {
  const sm = size === "sm"
  return (
    <div
      data-slot="empty-state"
      role="status"
      className={cn(
        "flex flex-col items-center text-center",
        sm ? "gap-1.5 px-4 py-8" : "gap-2 px-6 py-14",
        className
      )}
    >
      {Icon && (
        <div
          className={cn(
            "mb-1 flex items-center justify-center rounded-full bg-muted text-muted-foreground",
            sm ? "size-9" : "size-12"
          )}
        >
          <Icon className={sm ? "size-4" : "size-5"} aria-hidden />
        </div>
      )}
      <h3 className={cn("font-semibold text-foreground", sm ? "text-sm" : "text-base")}>{title}</h3>
      {description && (
        <p className={cn("max-w-sm text-muted-foreground", sm ? "text-xs" : "text-sm")}>{description}</p>
      )}
      {action && <div className={sm ? "mt-2" : "mt-3"}>{action}</div>}
    </div>
  )
}

export { EmptyState }
