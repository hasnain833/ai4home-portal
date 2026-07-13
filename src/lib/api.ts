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
          (body as Record<string, unknown>).error
        : null;
    const message =
      typeof serverMessage === "string" && serverMessage.trim()
        ? serverMessage
        : friendlyStatusMessage(res.status);
    console.error(`[api] ${res.status} ${input}`, body);
    throw new ApiError(message, res.status, body);
  }

  return body as T;
}
