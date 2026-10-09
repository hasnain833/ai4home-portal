"use client";

import { useState } from "react";
import { Bot, LifeBuoy, Phone } from "lucide-react";
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
import { HelpChatDialog } from "@/components/layout/HelpChat";

type SupportContact = { phone: string };

// Edited by platform admins on Admin → Support.
export function useSupportContact() {
  return useQuery<SupportContact>(QUERY_KEYS.supportContact, { ttlMs: 5 * 60_000 }).data;
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

export function HelpMenu({ expanded = true }: { expanded?: boolean }) {
  const contact = useSupportContact();
  const [chatOpen, setChatOpen] = useState(false);
  return (
    <>
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
          <DropdownMenuItem className="cursor-pointer" onSelect={() => setChatOpen(true)}>
            <Bot className="h-4 w-4 mr-2" />
            <div>
              <p className="text-sm font-medium">Ask the AI assistant</p>
              <p className="text-xs text-muted-foreground">How to do anything in the portal</p>
            </div>
          </DropdownMenuItem>
          {contact && (
            <DropdownMenuItem asChild className="cursor-pointer">
              <a href={telHref(contact.phone)}>
                <Phone className="h-4 w-4 mr-2" />
                <div>
                  <p className="text-sm font-medium">{contact.phone}</p>
                  <p className="text-xs text-muted-foreground">Support line</p>
                </div>
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <HelpChatDialog open={chatOpen} onOpenChange={setChatOpen} />
    </>
  );
}

/** Inline strip for pages where builders do self-serve work (Communities). */
export function SupportContactStrip({ text = "Need help adding a community?" }: { text?: string }) {
  const contact = useSupportContact();
  const [chatOpen, setChatOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
      <span className="flex items-center gap-2 font-medium">
        <LifeBuoy className="h-4 w-4 text-[#0F3B3D] dark:text-[#E8B86B]" />
        {text}
      </span>
      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="flex items-center gap-1.5 text-primary hover:underline dark:text-[#E8B86B]"
      >
        <Bot className="h-4 w-4" /> Ask the AI assistant
      </button>
      {contact && (
        <a
          href={telHref(contact.phone)}
          className="flex items-center gap-1.5 text-primary hover:underline dark:text-[#E8B86B]"
        >
          <Phone className="h-4 w-4" /> {contact.phone}
        </a>
      )}
      <HelpChatDialog open={chatOpen} onOpenChange={setChatOpen} />
    </div>
  );
}
