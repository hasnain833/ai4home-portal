"use client";

import { useQuery, QUERY_KEYS } from "./use-query";

export interface MessagingCapabilities {
  email: { configured: boolean; senderEmail: string | null };
  sms: { configured: boolean; provider: string | null };
}

/**
 * Whether the platform can currently deliver on each channel. Since messaging
 * moved to platform-owned accounts this is no longer a tenant setting — an
 * unavailable channel means a platform outage or missing platform credentials,
 * not something the tenant can fix.
 *
 * While loading, both channels are reported as available: a slow request must
 * not flash an "unavailable" warning when everything is fine.
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
  "Temporarily unavailable — this is a platform issue, please contact support.";
