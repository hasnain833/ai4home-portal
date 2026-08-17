import { resolveAiConfig, recordAiUsage } from "./ai-config.js";

export { hasAi as hasLLM, aiUnavailableMessage } from "./ai-config.js";

async function callAnthropic({ cfg, companyId, system, user, maxTokens }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
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

// The OpenAI chat-completions contract.
async function callOpenAiCompatible({ cfg, companyId, endpoint, label, system, user, maxTokens, json }) {
  const attempt = async (useJsonMode) => {
    const body = {
      model: cfg.model,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    if (useJsonMode) body.response_format = { type: "json_object" };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { ok: false, err: await response.text() };
    const data = await response.json();
    recordAiUsage(companyId, cfg, data?.usage);
    return { ok: true, text: data?.choices?.[0]?.message?.content || null };
  };

  let res = await attempt(json);
  if (!res.ok && json) {
    console.error(`[LLM] ${label} JSON mode failed, retrying plain:`, (res.err || "").slice(0, 160));
    res = await attempt(false);
  }
  if (!res.ok) {
    console.error(`[LLM] ${label} error:`, res.err);
    return null;
  }
  return res.text;
}

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function chat({ companyId, system, user, maxTokens = 700, json = false }) {
  const cfg = await resolveAiConfig(companyId);
  if (!cfg.provider) {
    console.warn(`[LLM] No AI provider for company=${companyId} (${cfg.reason}).`);
    return null;
  }
  try {
    switch (cfg.provider) {
      case "ANTHROPIC":
        return await callAnthropic({ cfg, companyId, system, user, maxTokens });
      case "OPENAI":
        return await callOpenAiCompatible({
          cfg, companyId, endpoint: OPENAI_CHAT_URL, label: "OpenAI", system, user, maxTokens, json,
        });
      case "GROQ":
        return await callOpenAiCompatible({
          cfg, companyId, endpoint: GROQ_CHAT_URL, label: "Groq", system, user, maxTokens, json,
        });
      default:
        return null;
    }
  } catch (err) {
    console.error(`[LLM] ${cfg.provider} exception:`, err.message);
    return null;
  }
}

async function anthropicToolCall({ cfg, companyId, system, messages, tool, maxTokens }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: maxTokens,
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
  const block = data?.content?.find((b) => b.type === "tool_use" && b.name === tool.name);
  return block?.input || null;
}

// OpenAI exposes Anthropic-style tools as "functions".
async function openAiCompatibleToolCall({ cfg, companyId, endpoint, label, system, messages, tool, maxTokens }) {
  const body = {
    model: cfg.model,
    max_tokens: maxTokens,
    temperature: 0.3,
    messages: [{ role: "system", content: system }, ...messages],
    tools: [
      {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: tool.name } },
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error(`[LLM] ${label} tool error:`, await response.text());
    return null;
  }
  const data = await response.json();
  recordAiUsage(companyId, cfg, data?.usage);
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return null;
  try {
    return typeof args === "string" ? JSON.parse(args) : args;
  } catch (e) {
    console.error(`[LLM] ${label} tool args parse failed:`, e.message);
    return null;
  }
}

export async function toolCall({ companyId, system, messages, tool, maxTokens = 700, forcePlatformKey = false }) {
  const cfg = await resolveAiConfig(companyId, { forcePlatform: forcePlatformKey });
  if (!cfg.provider) {
    console.warn(
      `[LLM] No AI provider for ${forcePlatformKey ? "the platform" : `company=${companyId}`} (${cfg.reason}).`,
    );
    return null;
  }
  try {
    switch (cfg.provider) {
      case "ANTHROPIC":
        return await anthropicToolCall({ cfg, companyId, system, messages, tool, maxTokens });
      case "OPENAI":
        return await openAiCompatibleToolCall({
          cfg, companyId, endpoint: OPENAI_CHAT_URL, label: "OpenAI", system, messages, tool, maxTokens,
        });
      case "GROQ":
        return await openAiCompatibleToolCall({
          cfg, companyId, endpoint: GROQ_CHAT_URL, label: "Groq", system, messages, tool, maxTokens,
        });
      default:
        return null;
    }
  } catch (err) {
    console.error(`[LLM] ${cfg.provider} tool exception:`, err.message);
    return null;
  }
}
