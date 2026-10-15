"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

// Platform-level (B2B) prospecting: builders the platform wants to sign up as tenants.

export const B2B_LEAD_STATUSES = ["NEW", "CONTACTED", "INTERESTED", "SIGNED", "LOST"] as const;
export type B2BLeadStatus = (typeof B2B_LEAD_STATUSES)[number];

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
  source: "MANUAL" | "CSV";
  emailOptOut: boolean;
  smsOptOut: boolean;
  createdAt: string;
  activeCampaigns: { id: string; name: string }[];
  nextAppointment: string | null;
}

export interface CampaignStep {
  channel: "EMAIL" | "SMS";
  delayDays: number;
  subject: string;
  body: string;
  /** Editor-only prompt for "Write with AI"; the server drops it on save. */
  topic?: string;
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
export const useB2BCampaigns = () => useApiList<B2BCampaign>(`${B2B_API}/campaigns`);

export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
