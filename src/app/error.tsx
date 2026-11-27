"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** Shown when a page crashes while rendering, instead of a blank screen. */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-background p-4">
      <EmptyState
        icon={AlertTriangle}
        title="This page hit a problem"
        description={
          <>
            Something went wrong while showing this page. Try again, and if it keeps happening, contact support
            {error.digest ? <> and quote reference <code className="font-mono">{error.digest}</code></> : null}.
          </>
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={reset}>
              <RotateCw className="size-4" />
              Try again
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/">Go to the home page</Link>
            </Button>
          </div>
        }
      />
    </main>
  );
}
