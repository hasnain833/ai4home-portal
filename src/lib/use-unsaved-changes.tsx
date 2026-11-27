"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/confirm-dialog";

/**
 * True once `value` differs from what it was when `active` last turned on (a dialog opening,
 * a form finishing its load). Pass a new `resetKey` after saving to make the current value the baseline.
 */
export function useDirty<T>(value: T, active = true, resetKey: unknown = null) {
  const snapshot = JSON.stringify(value);
  const [base, setBase] = useState<string | null>(active ? snapshot : null);
  const [prev, setPrev] = useState({ active, resetKey });
  // Adjusting state while rendering (React's "store info from previous renders" pattern), not in an effect.
  if (prev.active !== active || prev.resetKey !== resetKey) {
    setPrev({ active, resetKey });
    setBase(active ? snapshot : null);
  }
  return active && base !== null && snapshot !== base;
}
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Guards a form with edits that aren't saved yet.
 * - Closing or reloading the tab: the browser's own "Leave site?" prompt.
 * - Clicking a link inside the app: a dialog naming the item, with Save & continue / Discard / Stay.
 * ponytail: the browser Back button is not intercepted. The App Router has no navigation-blocking
 * API, and fighting its popstate handler is fragile; add it if Next ships one.
 *
 * Render the returned `dialog` anywhere in the component.
 */
export function useUnsavedChanges({
  dirty,
  itemName,
  onSave,
}: {
  dirty: boolean;
  /** What the user was editing, e.g. "the Warranty agent prompt". */
  itemName: string;
  /** Saves the edits; resolve false (or throw) if it failed, so we stay on the page. */
  onSave?: () => Promise<boolean | void>;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(dirty);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // older browsers need this to show the prompt
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    // Capture phase on document runs before React's handlers, so Next's <Link> never sees the click.
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // new tab/window: nothing is lost
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const leave = (href: string) => {
    dirtyRef.current = false; // the edits are saved or discarded; don't ask again on the way out
    setPendingHref(null);
    router.push(href);
  };

  const saveAndLeave = async () => {
    if (!onSave || !pendingHref) return;
    setSaving(true);
    try {
      const ok = await onSave();
      if (ok !== false) leave(pendingHref);
    } catch {
      /* the save shows its own error; stay so nothing is lost */
    } finally {
      setSaving(false);
    }
  };

  /**
   * For a form in a dialog: call before closing it (Esc, outside click, Cancel).
   * Resolves true when it's fine to close: nothing to lose, or the user chose to discard.
   */
  const confirmDiscard = useCallback(async () => {
    if (!dirtyRef.current) return true;
    return confirm({
      title: "Discard unsaved changes?",
      description: `You have unsaved changes to ${itemName}. If you close this now, they'll be lost.`,
      confirmText: "Discard changes",
      cancelText: "Keep editing",
      destructive: true,
    });
  }, [confirm, itemName]);

  const dialog = (
    <Dialog open={pendingHref !== null} onOpenChange={(open) => !open && !saving && setPendingHref(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" aria-hidden />
            Leave without saving?
          </DialogTitle>
          <DialogDescription>
            You have unsaved changes to <strong className="font-medium text-foreground">{itemName}</strong>. If you
            leave now, they&apos;ll be lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => setPendingHref(null)} disabled={saving}>
            Stay on page
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => pendingHref && leave(pendingHref)} disabled={saving}>
              Discard changes
            </Button>
            {onSave && (
              <Button onClick={saveAndLeave} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save &amp; continue
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { dialog, confirmDiscard };
}
