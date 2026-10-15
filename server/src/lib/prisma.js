import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

function runtimeDatabaseUrl(rawUrl, serverless = Boolean(process.env.VERCEL)) {
  if (!rawUrl) throw new Error("DATABASE_URL is required");
  if (!serverless) return rawUrl;

  try {
    const url = new URL(rawUrl);
    const isSupabasePooler = url.hostname.endsWith(".pooler.supabase.com");
    if (isSupabasePooler && (url.port === "5432" || !url.port)) {
      url.port = "6543";
    }
    if (isSupabasePooler && url.port === "6543") {
      url.searchParams.set("pgbouncer", "true");
      if (!url.searchParams.has("sslmode")) {
        url.searchParams.set("sslmode", "require");
      }
      if (url.searchParams.get("sslmode") === "require") {
        url.searchParams.set("uselibpqcompat", "true");
      }
      return url.toString();
    }
  } catch {
  }

  return rawUrl;
}

function databasePoolMax(value, serverless = Boolean(process.env.VERCEL)) {
  const configured = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : serverless
      ? 4 
      : 6;
}

const serverless = Boolean(process.env.VERCEL);
const connectionString = runtimeDatabaseUrl(process.env.DATABASE_URL, serverless);
const pool = new Pool({
  connectionString,
  max: databasePoolMax(process.env.DATABASE_POOL_MAX, serverless),
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: serverless ? 10000 : 30000,
  keepAlive: true,
  allowExitOnIdle: serverless,
});

pool.on("error", (err) => {
  console.error("[Prisma Pool] Idle client error (evicted):", err.message);
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

export default prisma;
