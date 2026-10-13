"use client";

import { useEffect, useState } from "react";

// Platform-level (B2B) prospecting: builders the platform wants to sign up as tenants.

export const B2B_LEAD_STATUSES = ["NEW", "CONTACTED", "INTERESTED", "SIGNED", "LOST"] as const;
export type B2BLeadStatus = (typeof B2B_LEAD_STATUSES)[number];

export interface B2BLead {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  notes: string;
  status: B2BLeadStatus;
  source: "MANUAL" | "CSV";
  createdAt: string;
}

export interface CampaignStep {
  delayDays: number;
  subject: string;
  body: string;
}

export interface B2BCampaign {
  id: string;
  name: string;
  channel: "EMAIL" | "SMS";
  /** Lead statuses this campaign targets. */
  audience: B2BLeadStatus[];
  steps: CampaignStep[];
  status: "DRAFT" | "ACTIVE" | "PAUSED";
  createdAt: string;
}

// ponytail: browser-only storage until the backend lands — swap this hook for
// fetches to /api/admin/b2b-leads and /api/admin/b2b-campaigns; the pages only use it.
function useStoredList<T>(key: string) {
  const [items, setItems] = useState<T[]>([]);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage after mount
      setItems(JSON.parse(localStorage.getItem(key) || "[]"));
    } catch {
      /* storage unavailable — start empty */
    }
  }, [key]);

  const save = (next: T[] | ((prev: T[]) => T[])) =>
    setItems((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage unavailable — keep in memory */
      }
      return value;
    });

  return [items, save] as const;
}

export const useB2BLeads = () => useStoredList<B2BLead>("admin-b2b-leads");
export const useB2BCampaigns = () => useStoredList<B2BCampaign>("admin-b2b-campaigns");
