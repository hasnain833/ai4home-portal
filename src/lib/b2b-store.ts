"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

// Platform-level (B2B) prospecting: builders the platform wants to sign up as tenants.

export const B2B_LEAD_STATUSES = ["NEW", "CONTACTED", "INTERESTED", "SIGNED", "LOST"] as const;
export type B2BLeadStatus = (typeof B2B_LEAD_STATUSES)[number];

export interface B2BSegmentFilters {
  status: B2BLeadStatus | "ALL";
  query: string;
  nurtureOnly: boolean;
}
export interface B2BSegment {
  id: string;
  name: string;
  filters: B2BSegmentFilters;
  builtIn: boolean;
  count: number;
}
export function matchesB2BSegment(lead: B2BLead, filters: B2BSegmentFilters) {
  const query = filters.query.trim().toLowerCase();
  return (filters.status === "ALL" || lead.status === filters.status) &&
    (!filters.nurtureOnly || (lead.marketingOptIn && !lead.emailOptOut)) &&
    (!query || [lead.companyName, lead.contactName, lead.email, lead.city || ""].some((value) => value.toLowerCase().includes(query)));
}

export interface B2BLead {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  website: string | null;
  city: string | null;
  notes: string | null;
  status: B2BLeadStatus;
  source: "MANUAL" | "CSV" | "WEBSITE_CONTACT" | "WEBSITE_EBOOK" | "WEBSITE_DEMO" | "WEBSITE_SALES";
  marketingOptIn: boolean;
  marketingConsentAt: string | null;
  smsConsentAt: string | null;
  agentPausedAt: string | null;
  agentPauseReason: string | null;
  inquiries: { id: string; type: string; payload: Record<string, string | boolean | number>; marketingConsent: boolean; consentText: string; createdAt: string; adminSentAt: string | null; visitorSentAt: string | null; adminSmsSentAt: string | null; visitorSmsSentAt: string | null; lastError: string | null }[];
  emailOptOut: boolean;
  smsOptOut: boolean;
  createdAt: string;
  activeCampaigns: { id: string; name: string }[];
  nextAppointment: string | null;
}

export interface B2BTimeline {
  agentPausedAt: string | null;
  agentPausedUntil: string | null;
  agentPauseReason: string | null;
  waiting: number;
  items: { id: string; at: string; kind: "agent" | "lead" | "campaign" | "meeting" | "website"; title: string; body: string | null; status: string | null }[];
}

export interface CampaignStep {
  /** Stable across edits, so leads keep their place when steps are added or removed. */
  id?: string;
  channel: "EMAIL" | "SMS";
  delayDays: number;
  /** HH:mm on the lead's local clock, 8am–9pm. Empty sends as soon as the step is due. */
  sendTime?: string | null;
  subject: string;
  body: string;
  /** Editor-only prompt for "Write with AI"; the server drops it on save. */
  topic?: string;
}

export interface B2BCampaignTemplate {
  id: string;
  name: string;
  description: string;
  steps: CampaignStep[];
}

export interface B2BCampaign {
  id: string;
  name: string;
  steps: CampaignStep[];
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
  createdAt: string;
  stats: {
    enrolled: number;
    active: number;
    completed: number;
    booked: number;
    replied: number;
    unsubscribed: number;
    withIssues: number;
  };
}

export interface B2BEnrollment {
  id: string;
  status: "ACTIVE" | "COMPLETED" | "EXITED";
  exitedReason: string | null;
  currentStep: number;
  nextRunAt: string | null;
  sentCount: number;
  failedCount: number;
  lastError: string | null;
  lastSentAt: string | null;
  smsDelivery?: { status: "delivered" | "failed" | "unconfirmed"; providerMessageId: string | null } | null;
  emailDelivery?: { status: "clicked" | "opened" | "delivered" | "failed" | "unconfirmed"; providerMessageId: string | null } | null;
  lead: Pick<B2BLead, "id" | "companyName" | "contactName" | "email" | "phone" | "status">;
}

export const B2B_API = "/api/admin/b2b";

export const sendJson = <T = unknown>(url: string, method: string, body?: unknown) =>
  apiFetch<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** GETs a list and exposes a reload; pages call reload() after every write. */
export function useApiList<T>(url: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setItems(await apiFetch<T[]>(url));
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);
  return { items, loading, reload };
}

export const useB2BLeads = () => useApiList<B2BLead>(`${B2B_API}/leads`);
/** For pickers that only need basic lead details. */
export const useB2BLeadsLite = () => useApiList<B2BLead>(`${B2B_API}/leads?lite=1`);
export const useB2BCampaigns = () => useApiList<B2BCampaign>(`${B2B_API}/campaigns`);
export const useB2BSegments = () => useApiList<B2BSegment>(`${B2B_API}/segments`);
export const useB2BTemplates = () => useApiList<B2BCampaignTemplate>(`${B2B_API}/templates`);

export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
