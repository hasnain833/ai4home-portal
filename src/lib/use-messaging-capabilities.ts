"use client";

import { useQuery, QUERY_KEYS } from "./use-query";

export interface MessagingCapabilities {
  email: { configured: boolean; senderEmail: string | null };
  sms: { configured: boolean; provider: string | null };
}

/**
 * Which channels this workspace can actually deliver on. Read it wherever a
 * channel can be chosen, so a tenant is told up front that a channel will not
 * send rather than discovering it from a report of zeros.
 *
 * While loading, both channels are reported as available: a slow request must
 * not flash a "not configured" warning at a tenant who is set up correctly.
 */
export function useMessagingCapabilities() {
  const { data, loading, error, refresh } = useQuery<MessagingCapabilities>(
    QUERY_KEYS.messagingCapabilities,
  );

  const optimistic = loading || !!error || !data;

  return {
    emailConfigured: optimistic ? true : data.email.configured,
    smsConfigured: optimistic ? true : data.sms.configured,
    smsProvider: data?.sms.provider ?? null,
    senderEmail: data?.email.senderEmail ?? null,
    loading,
    error,
    refresh,
  };
}

/** Label for a disabled channel option, e.g. in a dropdown. */
export const NOT_CONFIGURED_HINT =
  "Not configured — set this up in Settings > Messaging before using it.";
