/**
 * Server-side session helper.
 * Reads the `warranty_user` cookie that the client sets after login,
 * and returns the parsed user object (with UPPERCASE role to match DB).
 */
export async function getServerSession(request: Request) {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const cookies = Object.fromEntries(
      cookieHeader.split("; ").map((c) => {
        const [key, ...v] = c.split("=");
        return [key, decodeURIComponent(v.join("="))];
      })
    );

    const raw = cookies["warranty_user"];
    if (!raw) return null;

    const user = JSON.parse(raw);
    // Normalise role to UPPERCASE for DB comparisons
    return {
      ...user,
      role: (user.role as string).toUpperCase(),
    };
  } catch {
    return null;
  }
}
