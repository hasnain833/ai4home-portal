import prisma from "./prisma.js";

export const NEWS_DEFAULTS_KEY = "news.defaultSources";
export const BUILTIN_NEWS_SOURCES = [
  {
    url: "https://news.google.com/rss/search?q=housing+market+real+estate&hl=en-US&gl=US&ceid=US:en",
    label: "Google News — Housing Market",
    enabled: true,
  },
];

const MAX_SOURCES = 20;

export function normalizeNewsSources(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const url = String(raw.url || "").trim();
    if (!url) continue;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const label =
      String(raw.label || parsed.hostname)
        .trim()
        .slice(0, 80) || parsed.hostname;
    out.push({
      url,
      label,
      enabled: raw.enabled === undefined ? true : !!raw.enabled,
    });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}
export async function getPlatformDefaultNewsSources() {
  try {
    if (!prisma.platformSetting) return BUILTIN_NEWS_SOURCES;
    const row = await prisma.platformSetting.findUnique({
      where: { key: NEWS_DEFAULTS_KEY },
    });
    const saved = normalizeNewsSources(row?.value).filter((s) => s.enabled);
    return saved.length ? saved : BUILTIN_NEWS_SOURCES;
  } catch (err) {
    console.warn(
      "[News] Could not read platform default sources:",
      err.message,
    );
    return BUILTIN_NEWS_SOURCES;
  }
}

export async function resolveNewsSources(company) {
  const configured = normalizeNewsSources(company?.newsSources);
  const enabled = configured.filter((s) => s.enabled);
  return enabled.length ? enabled : await getPlatformDefaultNewsSources();
}
