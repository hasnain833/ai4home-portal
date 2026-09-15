import prisma from "../lib/prisma.js";
import { AGENT_TYPES, defaultsFor } from "./registry.js";

const CACHE_TTL_MS = 30_000;
const cache = new Map();

export function invalidateLivePrompts(agentType = null) {
  if (agentType) cache.delete(agentType);
  else cache.clear();
}

function codeDefaults(agentType) {
  return {
    ...defaultsFor(agentType),
    meta: { source: "code-default", versionId: null, label: null, setLiveAt: null },
  };
}

async function loadLiveRow(agentType) {
  if (agentType === AGENT_TYPES.SALES) {
    return prisma.salesAgentPromptVersion.findFirst({
      where: { isLive: true },
      orderBy: { setLiveAt: "desc" },
    });
  }
  if (agentType === AGENT_TYPES.WARRANTY) {
    return prisma.warrantyAgentPromptVersion.findFirst({
      where: { isLive: true },
      orderBy: { setLiveAt: "desc" },
    });
  }
  return null;
}

export async function getLivePrompts(agentType = AGENT_TYPES.SALES) {
  const fallback = codeDefaults(agentType);
  if (!fallback.systemTemplate && !Object.keys(defaultsFor(agentType) || {}).length) {
    return fallback;
  }

  const hit = cache.get(agentType);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value = fallback;
  try {
    const row = await loadLiveRow(agentType);
    if (row) {
      const merged = { ...defaultsFor(agentType) };
      let usable = true;
      for (const key of Object.keys(merged)) {
        const v = row[key];
        if (typeof v === "string" && v.trim()) merged[key] = v;
        else if (key in row) usable = false;
      }
      if (usable) {
        value = {
          ...merged,
          meta: {
            source: "live-version",
            versionId: row.id,
            label: row.label,
            setLiveAt: row.setLiveAt,
          },
        };
      } else {
        console.warn(
          `[Prompts] Live version ${row.id} is missing fields — running code defaults instead.`,
        );
      }
    }
  } catch (err) {
    console.error(`[Prompts] Live lookup failed for "${agentType}", using code defaults:`, err.message);
    return fallback;
  }

  cache.set(agentType, { at: Date.now(), value });
  return value;
}
