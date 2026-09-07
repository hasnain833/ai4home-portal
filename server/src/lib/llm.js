import { resolveAiConfig, recordAiUsage, toFastTier } from "./ai-config.js";

export { hasAi as hasLLM, aiUnavailableMessage } from "./ai-config.js";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

function anthropicHeaders(cfg) {
  return {
    "x-api-key": cfg.apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
}

async function callAnthropic({ cfg, companyId, system, user, maxTokens }) {
  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: anthropicHeaders(cfg),
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!response.ok) {
    console.error("[LLM] Anthropic error:", await response.text());
    return null;
  }
  const data = await response.json();
  recordAiUsage(companyId, cfg, data?.usage);
  return data?.content?.[0]?.text || null;
}

export async function chat({ companyId, system, user, maxTokens = 700, json = false }) {
  const cfg = resolveAiConfig();
  if (!cfg.provider) {
    console.warn(`[LLM] No AI provider available for company=${companyId} (${cfg.reason}).`);
    return null;
  }
  try {
    return await callAnthropic({ cfg, companyId, system, user, maxTokens });
  } catch (err) {
    console.error("[LLM] Anthropic exception:", err.message);
    return null;
  }
}

async function anthropicToolCall({ cfg, companyId, system, messages, tool, maxTokens, temperature }) {
  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: anthropicHeaders(cfg),
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
      ...(temperature == null ? {} : { temperature }),
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages,
    }),
  });
  if (!response.ok) {
    console.error("[LLM] Anthropic tool error:", await response.text());
    return null;
  }
  const data = await response.json();
  recordAiUsage(companyId, cfg, data?.usage);
  if (data?.stop_reason === "max_tokens") {
    console.warn(
      `[LLM] Anthropic tool call "${tool.name}" hit max_tokens (${maxTokens}); arguments are truncated.`,
    );
  }
  const block = data?.content?.find((b) => b.type === "tool_use" && b.name === tool.name);
  return block?.input || null;
}

export async function toolCall({
  companyId,
  system,
  messages,
  tool,
  maxTokens = 700,
  forcePlatformKey = false,
  fast = false,
  temperature,
}) {
  let cfg = resolveAiConfig();
  if (!cfg.provider) {
    console.warn(`[LLM] No AI provider available for company=${companyId} (${cfg.reason}).`);
    return null;
  }
  if (fast) cfg = toFastTier(cfg);
  try {
    return await anthropicToolCall({ cfg, companyId, system, messages, tool, maxTokens, temperature });
  } catch (err) {
    console.error("[LLM] Anthropic tool exception:", err.message);
    return null;
  }
}
