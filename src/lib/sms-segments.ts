// Mirrors the server-side segment maths in server/src/lib/usage.js. Kept here
// so the compose screens can warn before sending rather than after billing.

// The GSM-7 alphabet as code points. Anything outside it forces the whole
// message to UCS-2, which more than halves how much fits in a segment.
const GSM7_EXTRA = new Set([
  0x40, 0xa3, 0x24, 0xa5, 0xe8, 0xe9, 0xf9, 0xec, 0xf2, 0xc7, 0x0a, 0xd8, 0xf8,
  0x0d, 0xc5, 0xe5, 0x394, 0x5f, 0x3a6, 0x393, 0x39b, 0x3a9, 0x3a0, 0x3a8,
  0x3a3, 0x398, 0x39e, 0xc6, 0xe6, 0xdf, 0xc9, 0xa4, 0xa1, 0xc4, 0xd6, 0xd1,
  0xdc, 0xa7, 0xbf, 0xe4, 0xf6, 0xf1, 0xfc, 0xe0,
]);

function isGsm7(text: string) {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) continue;
    if (GSM7_EXTRA.has(code)) continue;
    return false;
  }
  return true;
}

export function countSegments(body: string) {
  const text = String(body || "");
  if (!text) return 0;
  const unicode = !isGsm7(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

const OPT_OUT_SUFFIX = " Reply STOP to opt out.";

/**
 * What a composed body will actually cost once the server has added the
 * company-name prefix and the mandatory opt-out suffix. Both are invisible in
 * the editor, and together they take ~36 characters off the first segment.
 */
export function describeSmsCost(body: string, companyName?: string | null) {
  const text = String(body || "").trim();

  const prefix =
    companyName && !text.toLowerCase().startsWith(companyName.toLowerCase())
      ? `${companyName}: `
      : "";
  const suffix = text.toLowerCase().includes("reply stop") ? "" : OPT_OUT_SUFFIX;

  const full = `${prefix}${text}${suffix}`;
  const segments = countSegments(full);
  const unicode = !isGsm7(full);
  // A lone segment holds more than a concatenated one, which carries a header.
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const capacity = segments <= 1 ? single : segments * multi;

  return {
    segments,
    characters: full.length,
    unicode,
    overhead: prefix.length + suffix.length,
    // How much more will fit before this costs another segment.
    remaining: Math.max(0, capacity - full.length),
  };
}
