import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const publicRoutes = [
  "/login",
  "/signup",
  "/",
  "/forgot-password",
  "/widget",
  "/widget.js",
  "/bp-config",
  "/book",
  "/unsubscribe",
  "/lead-form",
  "/terms",
  "/privacy",
  "/blog",
];

const EXPECTED_AUTH_ERRORS = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_missing",
]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === "/" &&
    request.nextUrl.searchParams.get("mode") === "fullscreen"
  ) {
    const companyId = request.nextUrl.searchParams.get("company");

    if (companyId) {
      const widgetUrl = request.nextUrl.clone();
      widgetUrl.pathname = `/widget/${encodeURIComponent(companyId)}`;
      widgetUrl.searchParams.delete("company");
      return NextResponse.redirect(widgetUrl);
    }
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && !EXPECTED_AUTH_ERRORS.has(error.code ?? "")) {
    console.error("[proxy] Unexpected auth error:", error.code, error.message);
  }

  const isPublic =
    publicRoutes.some(
      (route) => pathname === route || pathname.startsWith(route + "/"),
    ) || pathname.startsWith("/api/");

  if (isPublic) {
    return supabaseResponse;
  }
  if (request.cookies.has("superadmin_session")) {
    return supabaseResponse;
  }

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
