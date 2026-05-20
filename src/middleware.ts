import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decrypt } from "@/lib/session";

// Define protected routes and their allowed roles
const routeAccess: Record<string, string[]> = {
  "/dashboard": ["admin", "staff", "homeowner"],
  "/tickets": ["admin", "staff", "homeowner"],
  "/tickets/": ["admin", "staff", "homeowner"],
  "/integrations": ["admin"],
  "/agent-config": ["admin"],
  "/knowledge-base": ["admin", "staff"],
  "/company": ["admin"],
  "/reports": ["admin", "staff"],
};

// Public routes (no auth required)
const publicRoutes = ["/login", "/signup", "/"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (
    publicRoutes.some(
      (route) => pathname === route || pathname.startsWith("/api/"),
    )
  ) {
    return NextResponse.next();
  }

  // Get user from cookie (set after login)
  const userCookie = request.cookies.get("warranty_user");
  if (!userCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const session = await decrypt(userCookie.value);
    if (!session || !session.user) {
      throw new Error("Invalid session");
    }

    const userRole = typeof session.user.role === 'string' 
      ? session.user.role.toLowerCase() 
      : session.user.role;

    // Find matching route pattern and check role access
    let allowedRoles: string[] | undefined;
    for (const [route, roles] of Object.entries(routeAccess)) {
      if (pathname === route || pathname.startsWith(route + "/")) {
        allowedRoles = roles;
        break;
      }
    }

    if (allowedRoles && !allowedRoles.includes(userRole)) {
      // Role not authorized – redirect to dashboard
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }

    return NextResponse.next();
  } catch {
    // Invalid cookie – redirect to login
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
