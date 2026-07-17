import { supabase } from "../lib/supabase.js";
import prisma from "../lib/prisma.js";
import { verifySuperadminSessionToken } from "../lib/superadmin-session.js";
import { hasSalesPermission, SALES_PERMISSIONS } from "../lib/permissions.js";

export async function requireAuth(req, res, next) {
  try {
    if (req.user && req.user.id) return next();

    let token = "";
    let cookies = {};

    if (req.headers.cookie) {
      cookies = Object.fromEntries(
        req.headers.cookie.split(";").map((c) => {
          const parts = c.trim().split("=");
          return [parts[0], parts.slice(1).join("=")];
        }),
      );
    }

    const superadminCookie =
      cookies.superadmin_session || cookies["superadmin-session"];
    if (superadminCookie) {
      const payload = verifySuperadminSessionToken(superadminCookie);
      if (!payload) {
        return res
          .status(401)
          .json({ message: "Unauthorized: Invalid superadmin session" });
      }

      req.user = {
        id: payload.id,
        email: payload.email,
        name: payload.name,
        role: "ADMIN",
        companyId: payload.companyId || null,
        hasWarrantyAccess: true,
        hasSalesAccess: true,
        isSuperAdmin: true,
      };
      return next();
    }

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    if (!token && req.headers.cookie) {
      const cookies = Object.fromEntries(
        req.headers.cookie.split(";").map((c) => {
          const parts = c.trim().split("=");
          return [parts[0], parts.slice(1).join("=")];
        }),
      );

      let tokenKeys = Object.keys(cookies).filter(
        (k) => k.includes("auth-token") || k.includes("access-token"),
      );

      let projectRef = "";
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
      if (supabaseUrl) {
        try {
          const urlObj = new URL(supabaseUrl);
          projectRef = urlObj.hostname.split(".")[0];
        } catch (e) {
          console.error(
            "[Auth Middleware] Error parsing project reference:",
            e,
          );
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
            const decodedStr = Buffer.from(base64Str, "base64").toString(
              "utf-8",
            );
            const parsed = JSON.parse(decodedStr);
            token = parsed.access_token || parsed[0] || parsed;
          } catch (e) {
            console.error(
              "[Auth Middleware] Failed to decode base64 cookie:",
              e,
            );
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
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user || !user.email) {
      console.error(
        "[Auth Middleware] Supabase error / user not found:",
        error,
        !!user,
      );
      return res
        .status(401)
        .json({ message: "Unauthorized: Invalid token session" });
    }

    const dbUser = await prisma.user.findUnique({
      where: { email: user.email },
      include: { company: true },
    });

    if (!dbUser) {
      return res
        .status(404)
        .json({ message: "User profile not found in local database." });
    }

    const isSuperAdmin = dbUser.role === "SUPER_ADMIN";
    const isAdmin = dbUser.role === "ADMIN" || isSuperAdmin;
    const isStaff = dbUser.role === "STAFF";
    const companySalesEnabled = dbUser.company?.salesEnabled ?? true;
    const companyWarrantyEnabled = dbUser.company?.warrantyEnabled ?? true;

    const hasWarrantyAccess = isSuperAdmin
      ? true
      : (isAdmin || isStaff || dbUser.hasWarrantyAccess) &&
        companyWarrantyEnabled;
    const hasSalesAccess = isSuperAdmin
      ? true
      : (isAdmin || isStaff || dbUser.hasSalesAccess) && companySalesEnabled;

    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: isSuperAdmin ? "ADMIN" : dbUser.role,
      companyId: dbUser.companyId,
      hasWarrantyAccess,
      hasSalesAccess,
      isSuperAdmin,
      salesPermissions: Array.isArray(dbUser.salesPermissions)
        ? dbUser.salesPermissions
        : [],
    };

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res
      .status(500)
      .json({ message: "Internal server error during authentication" });
  }
}

export function requireWorkspace(workspace) {
  const key = workspace === "warranty" ? "hasWarrantyAccess" : "hasSalesAccess";
  const label = workspace === "warranty" ? "Warranty" : "Sales";
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (req.user.isSuperAdmin) return next();
    if (!req.user[key]) {
      return res.status(403).json({
        message: `Forbidden: your account does not have ${label} workspace access.`,
      });
    }
    next();
  };
}

export function requireRoles(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userRole = req.user.role.toUpperCase();
    const hasRole = allowedRoles.some(
      (role) => role.toUpperCase() === userRole,
    );

    if (!hasRole) {
      return res
        .status(403)
        .json({ message: "Forbidden: Insufficient privileges" });
    }

    next();
  };
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (hasSalesPermission(req.user, permission)) return next();

    const label = SALES_PERMISSIONS[permission]?.label || permission;
    return res.status(403).json({
      message: `Forbidden: you don't have permission to ${label.toLowerCase()}. Ask a company admin to grant it.`,
      missingPermission: permission,
    });
  };
}
