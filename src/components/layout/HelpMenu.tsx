"use client";

import { LifeBuoy, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QUERY_KEYS, useQuery } from "@/lib/use-query";

type SupportContact = { phone: string; chatUrl: string };

// Edited by platform admins on Admin → Support.
export function useSupportContact() {
  return useQuery<SupportContact>(QUERY_KEYS.supportContact, { ttlMs: 5 * 60_000 }).data;
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

export function HelpMenu({ expanded = true }: { expanded?: boolean }) {
  const contact = useSupportContact();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`w-full text-white/80 hover:bg-white/10 hover:text-white ${
            expanded ? "justify-start" : "justify-center px-0"
          }`}
          title="Help"
        >
          <LifeBuoy className={`h-4 w-4 ${expanded ? "mr-2" : ""}`} />
          {expanded && "Help"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel className="text-xs">Need help? We&apos;re here.</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!contact ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DropdownMenuItem asChild className="cursor-pointer">
              <a href={contact.chatUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4 mr-2" />
                <div>
                  <p className="text-sm font-medium">Chat with support</p>
                  <p className="text-xs text-muted-foreground">AI4HB help assistant</p>
                </div>
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="cursor-pointer">
              <a href={telHref(contact.phone)}>
                <Phone className="h-4 w-4 mr-2" />
                <div>
                  <p className="text-sm font-medium">{contact.phone}</p>
                  <p className="text-xs text-muted-foreground">Support line</p>
                </div>
              </a>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Inline strip for pages where builders do self-serve work (Communities). */
export function SupportContactStrip({ text = "Need help adding a community?" }: { text?: string }) {
  const contact = useSupportContact();
  if (!contact) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
      <span className="flex items-center gap-2 font-medium">
        <LifeBuoy className="h-4 w-4 text-[#0F3B3D] dark:text-[#E8B86B]" />
        {text}
      </span>
      <a
        href={contact.chatUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-primary hover:underline dark:text-[#E8B86B]"
      >
        <MessageCircle className="h-4 w-4" /> Chat with support
      </a>
      <a
        href={telHref(contact.phone)}
        className="flex items-center gap-1.5 text-primary hover:underline dark:text-[#E8B86B]"
      >
        <Phone className="h-4 w-4" /> {contact.phone}
      </a>
    </div>
  );
}
