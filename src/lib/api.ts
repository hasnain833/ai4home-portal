export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function friendlyStatusMessage(status: number): string {
  switch (status) {
    case 400:
      return "Some of the information provided was invalid. Please review your input and try again.";
    case 401:
      return "Your session has expired. Please sign in again to continue.";
    case 403:
      return "You don't have permission to do that. Contact an administrator if you think this is a mistake.";
    case 404:
      return "We couldn't find what you were looking for. It may have been moved or deleted.";
    case 409:
      return "That action conflicts with the current state of the data. Refresh and try again.";
    case 413:
      return "The file or request is too large. Please try a smaller one.";
    case 429:
      return "Too many requests. Please wait a moment and try again.";
    default:
      if (status >= 500) {
        return "The server is temporarily unavailable. Please try again in a few moments.";
      }
      return "We couldn't complete your request. Please try again.";
  }
}

/** Status used for a request that ran out of time (no HTTP response arrived). */
export const TIMEOUT_STATUS = 408;
// ponytail: fixed budgets; pass `timeoutMs` for a call that is known to run long (AI drafting, big imports).
const READ_TIMEOUT_MS = 45_000;
const WRITE_TIMEOUT_MS = 120_000;

/** Window events the connection banner listens for. */
export const CONNECTION_LOST_EVENT = "app:connection-lost";
export const RECONNECTED_EVENT = "app:reconnected";

export type ApiInit = RequestInit & { timeoutMs?: number };

export async function apiFetch<T = unknown>(input: string, init?: ApiInit): Promise<T> {
  const { timeoutMs, ...rest } = init ?? {};
  const method = (rest.method || "GET").toUpperCase();
  const budget = timeoutMs ?? (method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
  const timeout = AbortSignal.timeout(budget);
  // Keep a caller's own cancel working alongside the time budget.
  const signal = rest.signal
    ? typeof AbortSignal.any === "function"
      ? AbortSignal.any([rest.signal, timeout])
      : rest.signal
    : timeout;

  let res: Response;
  try {
    res = await fetch(input, { ...rest, signal });
  } catch (err) {
    if (rest.signal?.aborted) throw err; // the caller cancelled on purpose; nothing to show
    if (timeout.aborted) {
      throw new ApiError(
        method === "GET"
          ? "The server is taking longer than usual to answer. Please try again."
          : "The server took too long to confirm this. It may still have gone through, so refresh and check before trying again.",
        TIMEOUT_STATUS,
      );
    }
    console.error("[api] Network request failed:", input, err);
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CONNECTION_LOST_EVENT));
    throw new ApiError(
      "We couldn't reach the server. Please check your connection and try again.",
      0,
    );
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const serverMessage =
      body && typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).message ||
          (body as Record<string, unknown>).error ||
          (body as Record<string, unknown>).reason
        : null;
    const message =
      typeof serverMessage === "string" && serverMessage.trim()
        ? serverMessage
        : friendlyStatusMessage(res.status);
    // A 4xx is an expected answer (bad input, taken slot, logged out) that the screen shows itself;
    // only a server failure is worth an error in the console (and Next's dev overlay).
    if (res.status >= 500) console.error(`[api] ${res.status} ${input}`, body);
    throw new ApiError(message, res.status, body);
  }

  return body as T;
}

const send =
  (method: string) =>
  <T = unknown>(url: string, body?: unknown) =>
    apiFetch<T>(url, {
      method,
      ...(body === undefined
        ? {}
        : body instanceof FormData
          ? { body }
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });

/**
 * JSON in, JSON out: `await api.post("/api/properties", form)`.
 * Throws ApiError with a message that is safe to show, so a catch can `toast.error(e.message)`.
 */
export const api = {
  get: <T = unknown>(url: string) => apiFetch<T>(url),
  post: send("POST"),
  put: send("PUT"),
  patch: send("PATCH"),
  delete: send("DELETE"),
};

/** The server's own message for a failed request, or `fallback`, for screens that word their errors themselves. */
export const serverMessageOr = (e: unknown, fallback: string) => {
  const body = e instanceof ApiError ? (e.body as { message?: unknown } | null) : null;
  return typeof body?.message === "string" && body.message ? body.message : fallback;
};

/** True when the server refused because the time slot was just taken. */
export const isSlotTaken = (e: unknown) => e instanceof ApiError && e.status === 409;

/**
 * Multipart upload with progress. fetch can't report upload progress, so this uses XHR,
 * with the same error shape as apiFetch. Abort `signal` to cancel.
 */
export function uploadWithProgress<T = unknown>(
  url: string,
  body: FormData,
  {
    method = "POST",
    onProgress,
    signal,
  }: { method?: string; onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.withCredentials = true;
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(parsed as T);
      const msg = (parsed as { message?: unknown } | null)?.message;
      reject(
        new ApiError(typeof msg === "string" && msg.trim() ? msg : friendlyStatusMessage(xhr.status), xhr.status, parsed),
      );
    };
    xhr.onerror = () => {
      window.dispatchEvent(new Event(CONNECTION_LOST_EVENT));
      reject(new ApiError("We couldn't reach the server. Please check your connection and try again.", 0));
    };
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** True for the error a cancelled request or upload throws. */
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** The message to show for anything a request threw. */
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
