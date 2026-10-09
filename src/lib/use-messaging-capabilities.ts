"use client";

import { useQuery, QUERY_KEYS } from "./use-query";

export interface MessagingCapabilities {
  email: { configured: boolean; senderEmail: string | null };
  sms: { configured: boolean; provider: string | null };
}

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
