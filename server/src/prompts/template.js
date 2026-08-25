const TOKEN_RE = /\{\{\s*(\w+)\s*\}\}/g;

export function renderTemplate(template, vars = {}) {
  return String(template).replace(TOKEN_RE, (match, token) =>
    Object.prototype.hasOwnProperty.call(vars, token) ? String(vars[token] ?? "") : match,
  );
}

export function usedTokens(template) {
  const found = new Set();
  for (const m of String(template).matchAll(TOKEN_RE)) found.add(m[1]);
  return [...found];
}


export function checkTokens(template, placeholders = []) {
  const known = new Set(placeholders.map((p) => p.token));
  const required = placeholders.filter((p) => p.required).map((p) => p.token);
  const tokens = usedTokens(template);
  const errors = [];

  for (const token of tokens) {
    if (!known.has(token)) {
      errors.push(
        `Unknown placeholder {{${token}}} — it would be sent to the model as literal text. ` +
          `Known placeholders: ${[...known].map((t) => `{{${t}}}`).join(", ")}.`,
      );
    }
  }

  const missing = required.filter((t) => !tokens.includes(t));
  return { errors, missing, tokens };
}
