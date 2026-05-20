import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const secretKey = process.env.SESSION_SECRET || "default_super_secret_key_change_me_in_production";
const key = new TextEncoder().encode(secretKey);

export async function encrypt(payload: any) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
}

export async function decrypt(input: string): Promise<any> {
  try {
    const { payload } = await jwtVerify(input, key, {
      algorithms: ["HS256"],
    });
    return payload;
  } catch (error) {
    return null;
  }
}

export async function createSession(userData: any) {
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const session = await encrypt({ user: userData, expires });

  const cookieStore = await cookies();
  cookieStore.set("warranty_user", session, {
    expires,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.set("warranty_user", "", { expires: new Date(0), path: "/" });
}

/**
 * Server-side session helper.
 * Reads the `warranty_user` cookie, decrypts it,
 * and returns the parsed user object (with UPPERCASE role to match DB).
 */
export async function getServerSession(request?: Request) {
  try {
    let sessionCookie;
    
    if (request) {
      const cookieHeader = request.headers.get("cookie") || "";
      const cookiesObj = Object.fromEntries(
        cookieHeader.split("; ").map((c) => {
          const [k, ...v] = c.split("=");
          return [k, decodeURIComponent(v.join("="))];
        })
      );
      sessionCookie = cookiesObj["warranty_user"];
    } else {
      const cookieStore = await cookies();
      sessionCookie = cookieStore.get("warranty_user")?.value;
    }

    if (!sessionCookie) return null;

    const decryptedSession = await decrypt(sessionCookie);
    if (!decryptedSession || !decryptedSession.user) return null;

    const user = decryptedSession.user;
    
    return {
      ...user,
      role: typeof user.role === 'string' ? user.role.toUpperCase() : user.role,
    };
  } catch {
    return null;
  }
}
