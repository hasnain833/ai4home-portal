import { NextRequest, NextResponse } from "next/server";

const BASE_CONFIG_URL =
  process.env.NEXT_PUBLIC_BOTPRESS_CONFIG_URL ||
  "https://files.bpcontent.cloud/2026/06/24/12/20260624123527-XY5YMA41.js";

const EMBED_CONTAINER_ID = "bp-embedded-webchat";

type BotpressConfig = Record<string, unknown> & {
  configuration?: Record<string, unknown>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { config: BotpressConfig; ts: number } | null = null;

async function getBaseConfig(): Promise<BotpressConfig | null> {
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
  const companyName = searchParams.get("companyName");
  const botLogo = searchParams.get("botLogo");

  const base = await getBaseConfig();
  if (!base) {
    return new NextResponse("/* Failed to load Botpress config */", {
      status: 502,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }

  // Clone so per-request branding overrides don't pollute the shared cache.
  const config: BotpressConfig = JSON.parse(JSON.stringify(base));
  config.configuration = config.configuration || {};
  const configurationOverrides: Record<string, unknown> = {
    themeMode: "light",
    headerVariant: "solid",
    variant: "solid",
    embeddedChatId: EMBED_CONTAINER_ID,
  };
  if (botColor) {
    configurationOverrides.color = botColor;
    config.configuration.color = botColor;
  }
  if (botName) {
    configurationOverrides.botName = botName;
    config.configuration.botName = botName;
  }
  if (companyName) {
    const botDescription = `You are the Warranty Care Assistant for ${companyName}.`;
    configurationOverrides.botDescription = botDescription;
    configurationOverrides.description = botDescription;
    config.configuration.botDescription = botDescription;
    config.configuration.description = botDescription;
  }
  if (botLogo) {
    configurationOverrides.botAvatar = botLogo;
    config.configuration.botAvatar = botLogo;
  }
  // Force inline rendering into the portal container.
  config.configuration.embeddedChatId = EMBED_CONTAINER_ID;
  Object.assign(config.configuration, configurationOverrides);

  const js = `(function initBotpress(attempt) {
  if (window.botpress && typeof window.botpress.init === "function") {
    var configurationOverrides = ${JSON.stringify(configurationOverrides)};
    if (typeof window.botpress.on === "function" && typeof window.botpress.config === "function") {
      window.botpress.on("webchat:initialized", function() {
        window.botpress.config({ configuration: configurationOverrides });
      });
    }
    window.botpress.init(${JSON.stringify(config)});
    window.setTimeout(function() {
      if (window.botpress && typeof window.botpress.config === "function") {
        window.botpress.config({ configuration: configurationOverrides });
      }
    }, 250);
    return;
  }
  if (attempt > 100) {
    console.error("[bp-config] Botpress inject script did not expose window.botpress.init");
    return;
  }
  window.setTimeout(function() { initBotpress(attempt + 1); }, 50);
})(0);`;
  return new NextResponse(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
