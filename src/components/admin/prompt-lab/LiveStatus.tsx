"use client";

import { ChevronDown, Radio, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Live = {
  source?: string;
  label?: string | null;
  setLiveByName?: string | null;
  setLiveAt?: string | null;
} | null;

/** Header pill for versioned agents: what's live, plus revert / choose a version. */
export default function LiveStatus({
  live,
  busy,
  onRevert,
  onChooseVersion,
}: {
  live: Live;
  busy: boolean;
  onRevert: () => void;
  onChooseVersion: () => void;
}) {
  const isLive = live?.source === "live-version";
  const detail = isLive
    ? `Running ${live?.label || "an unlabelled version"}${live?.setLiveByName ? `, set live by ${live.setLiveByName}` : ""}${
        live?.setLiveAt ? ` on ${new Date(live.setLiveAt).toLocaleDateString()}` : ""
      }`
    : "Running the prompt that ships in code. No lab version has been set live.";

  return (
    <>
      <span
        title={detail}
        className={`flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${
          isLive
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
            : "bg-muted text-muted-foreground"
        }`}
      >
        <Radio className="h-3.5 w-3.5" />
        <span className="sr-only">{detail}</span>
        <span aria-hidden>Live · {isLive ? live?.label || "unlabelled" : "shipped prompt"}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={busy}>
            Set live <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onChooseVersion}>Choose a version to set live</DropdownMenuItem>
          {isLive && (
            <DropdownMenuItem onSelect={onRevert}>
              <Undo2 className="h-3.5 w-3.5" /> Revert to code
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
