import { NextRequest, NextResponse } from "next/server";

// Base Botpress config (the published "embedded" deployment). The env var wins so
// the bot can be swapped without a code change.
const BASE_CONFIG_URL =
  process.env.NEXT_PUBLIC_BOTPRESS_CONFIG_URL ||
  "https://files.bpcontent.cloud/2026/06/24/12/20260624123527-XY5YMA41.js";

// The container element the webchat mounts into (must exist on the page).
const EMBED_CONTAINER_ID = "bp-embedded-webchat";

/**
 * Returns the Botpress init script with per-company branding baked in.
 *
 * The published config lives on a Botpress CDN that sends no CORS header, so the
 * browser can't fetch + modify it directly. We fetch it server-side, override the
 * branding (color / name / avatar), force embedded mode, and hand back a plain
 * `window.botpress.init(...)` script the page can load via a <script> tag. This
 * avoids proxying `window.botpress` (which breaks Botpress's inline mount).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const botColor = searchParams.get("botColor");
  const botName = searchParams.get("botName");
  const botLogo = searchParams.get("botLogo");

  let config: Record<string, any> | null = null;
  try {
    const res = await fetch(BASE_CONFIG_URL, { cache: "no-store" });
    const text = await res.text();
    // The file is `window.botpress.init({ ...JSON... });` — extract the object.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      config = JSON.parse(text.slice(start, end + 1));
    }
  } catch (err) {
    console.error("[bp-config] Failed to load Botpress config:", err);
  }

  if (!config) {
    return new NextResponse("/* Failed to load Botpress config */", {
      status: 502,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }

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
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
}
