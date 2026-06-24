import { supabase } from "../lib/supabase.js";
import prisma from "../lib/prisma.js";

export async function requireAuth(req, res, next) {
  try {
    let token = "";

    // 1. Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    // 2. Check Cookie (sb-access-token)
    if (!token && req.headers.cookie) {
      const cookies = Object.fromEntries(
        req.headers.cookie.split(";").map((c) => {
          const parts = c.trim().split("=");
          return [parts[0], parts.slice(1).join("=")];
        })
      );

      // Look for Supabase auth cookie keys (can be chunked as sb-<ref>-auth-token.0, sb-<ref>-auth-token.1)
      let tokenKeys = Object.keys(cookies)
        .filter((k) => k.includes("auth-token") || k.includes("access-token"));

      // Parse project reference ID from NEXT_PUBLIC_SUPABASE_URL to prevent local dev cookie collisions
      let projectRef = "";
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
      if (supabaseUrl) {
        try {
          const urlObj = new URL(supabaseUrl);
          projectRef = urlObj.hostname.split(".")[0];
        } catch (e) {
          console.error("[Auth Middleware] Error parsing project reference:", e);
        }
      }

      if (projectRef) {
        const filteredKeys = tokenKeys.filter((k) => k.includes(projectRef));
        if (filteredKeys.length > 0) {
          tokenKeys = filteredKeys;
        }
      }

      tokenKeys.sort((a, b) => {
        const aMatch = a.match(/\.(\d+)$/);
        const bMatch = b.match(/\.(\d+)$/);
        if (aMatch && bMatch) {
          return parseInt(aMatch[1], 10) - parseInt(bMatch[1], 10);
        }
        return a.localeCompare(b);
      });

      if (tokenKeys.length > 0) {
        let rawCookieValue = tokenKeys.map((k) => cookies[k]).join("");

        if (rawCookieValue.startsWith("base64-")) {
          try {
            const base64Str = rawCookieValue.substring(7);
            const decodedStr = Buffer.from(base64Str, "base64").toString("utf-8");
            const parsed = JSON.parse(decodedStr);
            token = parsed.access_token || parsed[0] || parsed;
          } catch (e) {
            console.error("[Auth Middleware] Failed to decode base64 cookie:", e);
          }
        } else {
          try {
            const parsed = JSON.parse(decodeURIComponent(rawCookieValue));
            token = parsed.access_token || parsed[0] || parsed;
          } catch {
            token = rawCookieValue;
          }
        }
      }
    }

    if (!token) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Missing authentication token" });
    }

    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user || !user.email) {
      console.error("[Auth Middleware] Supabase error / user not found:", error, !!user);
      return res
        .status(401)
        .json({ message: "Unauthorized: Invalid token session" });
    }

    // Find the user in database by email
    const dbUser = await prisma.user.findUnique({
      where: { email: user.email },
      include: { company: true },
    });

    if (!dbUser) {
      return res
        .status(404)
        .json({ message: "User profile not found in local database." });
    }

    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
      companyId: dbUser.companyId,
      hasWarrantyAccess: dbUser.hasWarrantyAccess,
      hasSalesAccess: dbUser.hasSalesAccess,
    };

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res
      .status(500)
      .json({ message: "Internal server error during authentication" });
  }
}

// Role-based verification helper middleware
export function requireRoles(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userRole = req.user.role.toUpperCase();
    const hasRole = allowedRoles.some(role => role.toUpperCase() === userRole);

    if (!hasRole) {
      return res.status(403).json({ message: "Forbidden: Insufficient privileges" });
    }

    next();
  };
}
