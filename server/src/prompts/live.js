/**
 * Resolves the prompts the LIVE agent runs.
 *
 * Contract, and the reason this file is separate from ./sales-agent.js:
 *   - A prompt reaches real leads only when a Prompt Lab version is explicitly
 *     "Set Live" (isLive = true). Saving a version never does this.
 *   - If nothing is live, or the lookup fails for any reason, the agent runs the
 *     defaults that ship in code. A database problem must never take the agent
 *     down or hand it a half-built prompt.
 *
 * Results are cached briefly so a per-turn hot path does not hit the database on
 * every message. Set Live calls invalidateLivePrompts() so a deploy takes effect
 * immediately rather than after the TTL.
 */
import prisma from "../lib/prisma.js";
import { AGENT_TYPES, defaultsFor } from "./registry.js";

const CACHE_TTL_MS = 30_000;

/** @type {Map<string, { at: number, value: object }>} */
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
  // Only the sales agent has a versions table today. Warranty prompts ship in
  // code; giving them Set Live needs its own versions table and migration.
  if (agentType !== AGENT_TYPES.SALES) return null;

  return prisma.salesAgentPromptVersion.findFirst({
    where: { isLive: true },
    orderBy: { setLiveAt: "desc" },
  });
}

/**
 * The prompts to run for this agent right now.
 * Always resolves — never throws, never returns a partial prompt set.
 */
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
      // A live row must be complete. A missing field means the row predates a
      // prompt key or was written by hand — fall back rather than send a gap.
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
