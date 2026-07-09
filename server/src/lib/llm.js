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

async function callAnthropic({ system, user, maxTokens }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
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
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
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
