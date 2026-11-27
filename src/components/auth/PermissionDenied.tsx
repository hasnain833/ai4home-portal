"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Shown instead of a page the signed-in user can't open: what's needed, who can grant it,
 * and a way back. Never a silent redirect.
 */
export function PermissionDenied({
  needed,
  grantedBy,
  exitHref,
  exitLabel = "Go to my dashboard",
  className,
}: {
  /** What the page requires, in plain words: "an admin or staff account", "the Manage campaigns permission". */
  needed: string;
  /** Who can give it: "your company's administrator", "the Super Admin". */
  grantedBy: string;
  exitHref: string;
  exitLabel?: string;
  className?: string;
}) {
  return (
    <main className={className ?? "flex min-h-[70vh] items-center justify-center bg-background p-4"}>
      <EmptyState
        icon={ShieldAlert}
        title="You don't have access to this page"
        description={
          <>
            This page needs <strong className="font-medium text-foreground">{needed}</strong>. If you need it, ask{" "}
            {grantedBy} to give you access.
          </>
        }
        action={
          <Button size="sm" asChild>
            <Link href={exitHref}>{exitLabel}</Link>
          </Button>
        }
      />
    </main>
  );
}
