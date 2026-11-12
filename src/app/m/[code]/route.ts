import { NextResponse, type NextRequest } from "next/server";

// A campaign text's short link. The API says which booking page it stands for; anything
// unknown still lands on the booking page, which explains that the link is no longer valid.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let path = "/meet/invalid";
  try {
    const res = await fetch(`${request.nextUrl.origin}/api/public/b2b/short/${encodeURIComponent(code)}`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { path?: string };
      // Only ever a path on this site, never somewhere else.
      if (data.path?.startsWith("/meet/")) path = data.path;
    }
  } catch {
    // The booking page shows its own "no longer valid" message.
  }
  return NextResponse.redirect(new URL(path, request.nextUrl.origin), 302);
}
