import { NextRequest, NextResponse } from "next/server";

const BASE_CONFIG_URL =
  process.env.NEXT_PUBLIC_BOTPRESS_CONFIG_URL ||
  "https://files.bpcontent.cloud/2026/06/24/12/20260624123527-XY5YMA41.js";

const EMBED_CONTAINER_ID = "bp-embedded-webchat";


const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { config: Record<string, any>; ts: number } | null = null;

async function getBaseConfig(): Promise<Record<string, any> | null> {
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.config;
  try {
    const res = await fetch(BASE_CONFIG_URL, { cache: "no-store" });
    const text = await res.text();
    // The file is `window.botpress.init({ ...JSON... });` — extract the object.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return cached?.config ?? null;
    const config = JSON.parse(text.slice(start, end + 1));
    cached = { config, ts: Date.now() };
    return config;
  } catch (err) {
    console.error("[bp-config] Failed to load Botpress config:", err);
    // Fall back to a stale cache if we have one.
    return cached?.config ?? null;
  }
}
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const botColor = searchParams.get("botColor");
  const botName = searchParams.get("botName");
  const botLogo = searchParams.get("botLogo");

  const base = await getBaseConfig();
  if (!base) {
    return new NextResponse("/* Failed to load Botpress config */", {
      status: 502,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }

  // Clone so per-request branding overrides don't pollute the shared cache.
  const config: Record<string, any> = JSON.parse(JSON.stringify(base));
  config.configuration = config.configuration || {};
  if (botColor) config.configuration.color = botColor;
  if (botName) config.configuration.botName = botName;
  if (botLogo) config.configuration.botAvatar = botLogo;
  // Force inline rendering into the portal container.
  config.configuration.embeddedChatId = EMBED_CONTAINER_ID;

  const js = `window.botpress.init(${JSON.stringify(config)});`;
  return new NextResponse(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Let the browser/CDN cache the branded script too.
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
}
