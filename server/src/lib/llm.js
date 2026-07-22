const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

export function isRealAnthropicKey(k = ANTHROPIC_KEY) {
  return typeof k === "string" && k.startsWith("sk-ant-");
}

function getGroqKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  const openai = process.env.OPENAI_API_KEY || "";
  return openai.startsWith("gsk_") ? openai : "";
}

export function hasLLM() {
  return isRealAnthropicKey() || !!getGroqKey();
}

// Model choice is a code decision, not deployment config — changing it affects
// prompt behaviour and output quality, so it belongs in review, not in a .env.
const ANTHROPIC_MODEL = "claude-sonnet-5";
const GROQ_MODEL = "llama-3.3-70b-versatile";

async function callAnthropic({ system, user, maxTokens }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
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
  return data?.content?.[0]?.text || null;
}

async function callGroq({ system, user, maxTokens, json }) {
  const attempt = async (useJsonMode) => {
    const body = {
      model: GROQ_MODEL,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    // Groq's JSON mode requires the word "json" in the prompt (our JSON callers
    // already instruct "return JSON"), so only enable it when asked.
    if (useJsonMode) body.response_format = { type: "json_object" };

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getGroqKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      return { ok: false, err: await response.text() };
    }
    const data = await response.json();
    return { ok: true, text: data?.choices?.[0]?.message?.content || null };
  };

  let res = await attempt(json);
  // Strict JSON mode can hard-fail on a minor model formatting slip — retry once
  // in plain mode and let the caller parse leniently instead of failing outright.
  if (!res.ok && json) {
    console.error("[LLM] Groq JSON mode failed, retrying plain:", (res.err || "").slice(0, 160));
    res = await attempt(false);
  }
  if (!res.ok) {
    console.error("[LLM] Groq error:", res.err);
    return null;
  }
  return res.text;
}

export async function chat({ system, user, maxTokens = 700, json = false }) {
  if (isRealAnthropicKey()) {
    try {
      const out = await callAnthropic({ system, user, maxTokens });
      if (out) return out;
    } catch (err) {
      console.error("[LLM] Anthropic exception:", err.message);
    }
  }
  if (getGroqKey()) {
    try {
      return await callGroq({ system, user, maxTokens, json });
    } catch (err) {
      console.error("[LLM] Groq exception:", err.message);
    }
  }
  return null;
}

// ─── Tool / function calling ──────────────────────────────────────────────────
// Single-tool forced call, provider-agnostic. `tool` uses the Anthropic shape
// ({ name, description, input_schema }); it's adapted to Groq/OpenAI function
// calling automatically. `messages` is [{ role: "user"|"assistant", content }].
// Returns the parsed tool-input object, or null if no provider is available.

async function anthropicToolCall({ system, messages, tool, maxTokens }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
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
  const block = data?.content?.find((b) => b.type === "tool_use" && b.name === tool.name);
  return block?.input || null;
}

async function groqToolCall({ system, messages, tool, maxTokens }) {
  const body = {
    model: GROQ_MODEL,
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
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getGroqKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.error("[LLM] Groq tool error:", await response.text());
    return null;
  }
  const data = await response.json();
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return null;
  try {
    return typeof args === "string" ? JSON.parse(args) : args;
  } catch (e) {
    console.error("[LLM] Groq tool args parse failed:", e.message);
    return null;
  }
}

export async function toolCall({ system, messages, tool, maxTokens = 700 }) {
  if (isRealAnthropicKey()) {
    try {
      const out = await anthropicToolCall({ system, messages, tool, maxTokens });
      if (out) return out;
    } catch (err) {
      console.error("[LLM] Anthropic tool exception:", err.message);
    }
  }
  if (getGroqKey()) {
    try {
      return await groqToolCall({ system, messages, tool, maxTokens });
    } catch (err) {
      console.error("[LLM] Groq tool exception:", err.message);
    }
  }
  return null;
}
