"use client";

import "./globals.css";

/** Last resort when the root layout itself crashes: it replaces the layout, so no providers or theme here. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-background p-4 font-sans text-foreground antialiased">
        <div role="alert" className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The app couldn&apos;t load. Try again, and if it keeps happening, contact support
            {error.digest ? ` and quote reference ${error.digest}` : ""}.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
