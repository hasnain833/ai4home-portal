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

export async function apiFetch<T = unknown>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    console.error("[api] Network request failed:", input, err);
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

/** The message to show for anything a request threw. */
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
