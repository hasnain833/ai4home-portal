import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import { htmlToText } from "./sanitize-html.js";

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const MIN_ARTICLE_CHARS = 200;

const friendly = (message, status = 400) => Object.assign(new Error(message), { status });

/** Addresses a link must never reach: this server, its network, and cloud metadata services. */
export function isPrivateAddress(ip) {
  const address = String(ip).toLowerCase();
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(address)) {
    if (address === "::" || address === "::1") return true;
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    // A mapped address can also be written in hex, which is never a public website.
    if (address.startsWith("::ffff:")) return true;
    return /^(fc|fd|fe[89ab]|ff)/.test(address);
  }
  return true;
}

// Runs as the connection is made, so a site can't pass the check and then point elsewhere.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error("That address isn't allowed."), { code: "EPRIVATE" }));
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

export function parseArticleUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    throw friendly("Enter a full link, starting with https://.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw friendly("Only http and https links can be read.");
  if (url.username || url.password) throw friendly("Links with a username or password can't be read.");
  if (url.port && !["80", "443"].includes(url.port)) throw friendly("That link uses a port that isn't allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || (net.isIP(host) && isPrivateAddress(host))) {
    throw friendly("That address isn't allowed.");
  }
  return url;
}

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(
      url,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: { "User-Agent": "AI4HomeBuilders-SourceReader/1.0", Accept: "text/html,application/pdf,text/plain;q=0.9" },
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (redirects >= MAX_REDIRECTS) return reject(friendly("That link redirects too many times."));
          try {
            const next = parseArticleUrl(new URL(response.headers.location, url).toString());
            return resolve(download(next, redirects + 1));
          } catch (error) {
            return reject(error);
          }
        }
        if (status === 401 || status === 402 || status === 403) {
          response.resume();
          return reject(friendly("That page needs a login or blocks automated readers. Upload or paste the text instead."));
        }
        if (status !== 200) {
          response.resume();
          return reject(friendly(`That page couldn't be opened (status ${status}). Check the link, or paste the text instead.`));
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            request.destroy();
            return reject(friendly("That page is too large to read. Upload or paste the part you need."));
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ buffer: Buffer.concat(chunks), type: String(response.headers["content-type"] || "").toLowerCase(), url }));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(friendly("That page took too long to respond. Try again, or paste the text instead.")));
    request.on("error", (error) => {
      if (error.status) return reject(error);
      reject(friendly(error.code === "EPRIVATE" ? "That address isn't allowed." : "That page couldn't be opened. Check the link, or paste the text instead."));
    });
  });
}

/** The readable part of a web page. Menus, scripts and footers would only mislead the AI. */
export function articleFromHtml(html) {
  const source = String(html || "");
  const title = htmlToText(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 200);
  const cleaned = source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, " ");
  const main = cleaned.match(/<article\b[\s\S]*<\/article>/i)?.[0] || cleaned.match(/<main\b[\s\S]*<\/main>/i)?.[0] || cleaned.match(/<body\b[\s\S]*<\/body>/i)?.[0] || cleaned;
  const text = htmlToText(main.replace(/<\s*\/\s*(h[1-6]|section|blockquote|tr)\s*>/gi, "\n\n").replace(/<\s*\/\s*p\s*>/gi, "\n\n"))
    .split("\n").map((line) => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text };
}

/** Reads a public link once. `readFile` handles PDFs, using the same parser as uploads. */
export async function readArticle(rawUrl, readFile) {
  const { buffer, type, url } = await download(parseArticleUrl(rawUrl));
  const fallbackTitle = url.hostname.replace(/^www\./, "");
  if (type.includes("pdf")) {
    return { title: fallbackTitle, text: String(await readFile(buffer, "article.pdf")).trim(), url: url.toString() };
  }
  if (type && !type.includes("html") && !type.includes("text/plain")) {
    throw friendly("That link isn't a web page or PDF. Download the file and upload it instead.");
  }
  const { title, text } = type.includes("text/plain") ? { title: "", text: buffer.toString("utf8").trim() } : articleFromHtml(buffer.toString("utf8"));
  if (text.length < MIN_ARTICLE_CHARS) {
    throw friendly("Very little text could be read from that page. It may need a login or load its text with scripts. Upload or paste it instead.");
  }
  return { title: title || fallbackTitle, text, url: url.toString() };
}
