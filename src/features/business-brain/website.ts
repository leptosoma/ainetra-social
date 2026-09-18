import "server-only";

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { DomainError } from "@/lib/domain-error";

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 600_000;
const MAX_TEXT_CHARS = 15_000;
const REQUEST_TIMEOUT_MS = 6_000;

export type WebsiteDocument = {
  sourceUrl: string;
  fetchedAt: string;
  contentHash: string;
  title: string;
  description: string;
  text: string;
};

type ResolvedAddress = { address: string; family: number };
type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;
type WebsiteResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
type WebsiteTransport = (url: URL, address: ResolvedAddress, timeoutMs: number, maxBytes: number) => Promise<WebsiteResponse>;

export type WebsiteFetchOptions = {
  resolver?: Resolver;
  transport?: WebsiteTransport;
  timeoutMs?: number;
};

function ipv4Number(address: string) {
  return address.split(".").reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
}

function inV4Range(address: string, base: string, bits: number) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

export function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (isIP(normalized) === 4) {
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
      ["198.18.0.0", 15], ["224.0.0.0", 4],
    ].some(([base, bits]) => inV4Range(normalized, String(base), Number(bits)));
  }
  if (isIP(normalized) === 6) {
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized);
  }
  return true;
}

function parseWebsiteUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DomainError("Geçerli bir web sitesi adresi girin.", "VALIDATION_ERROR");
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password) {
    throw new DomainError("Yalnızca herkese açık http/https adresleri analiz edilebilir.", "VALIDATION_ERROR");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new DomainError("Yerel veya özel ağ adresleri analiz edilemez.", "VALIDATION_ERROR");
  }
  return url;
}

async function defaultResolver(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

export async function validatePublicWebsiteUrl(rawUrl: string, resolver: Resolver = defaultResolver) {
  const url = parseWebsiteUrl(rawUrl);
  const literalFamily = isIP(url.hostname);
  const addresses = literalFamily ? [{ address: url.hostname, family: literalFamily }] : await resolver(url.hostname);
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new DomainError("Yerel veya özel ağ adresleri analiz edilemez.", "VALIDATION_ERROR");
  }
  return { url, addresses };
}

function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return named[lower] ?? " ";
  });
}

function plainText(html: string) {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutNoise)
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !/(ignore (all |any )?(previous|prior) instructions|system prompt|developer message)/i.test(line))
    .join("\n")
    .slice(0, MAX_TEXT_CHARS);
}

function metaContent(html: string, name: string) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!new RegExp(`(?:name|property)=["']${name}["']`, "i").test(tag)) continue;
    const match = tag.match(/content=["']([^"']*)["']/i);
    if (match) return decodeEntities(match[1]).replace(/\s+/g, " ").trim().slice(0, 400);
  }
  return "";
}

function fetchPinned(url: URL, address: ResolvedAddress, timeoutMs: number, maxBytes: number) {
  return new Promise<WebsiteResponse>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      servername: url.hostname,
      headers: { Host: url.host, Accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "User-Agent": "AinetraBusinessBrain/1.0" },
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          request.destroy(new Error("WEBSITE_TOO_LARGE"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("WEBSITE_TIMEOUT")));
    request.on("error", reject);
    request.end();
  });
}

async function fetchWebsiteDocumentAt(rawUrl: string, options: WebsiteFetchOptions, redirectCount: number, deadline: number): Promise<WebsiteDocument> {
  if (redirectCount > MAX_REDIRECTS) throw new DomainError("Web sitesi çok fazla yönlendirme yaptı.", "VALIDATION_ERROR");
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error("WEBSITE_TIMEOUT");
  const { url, addresses } = await validatePublicWebsiteUrl(rawUrl, options.resolver ?? defaultResolver);
  const response = await (options.transport ?? fetchPinned)(url, addresses[0], remainingMs, MAX_RESPONSE_BYTES);
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.location;
    if (!location) throw new Error("WEBSITE_REDIRECT_WITHOUT_LOCATION");
    return fetchWebsiteDocumentAt(new URL(location, url).toString(), options, redirectCount + 1, deadline);
  }
  if (response.status < 200 || response.status >= 300) throw new Error(`WEBSITE_HTTP_${response.status}`);
  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml") && !contentType.includes("text/plain")) {
    throw new Error("WEBSITE_UNSUPPORTED_CONTENT_TYPE");
  }
  const html = response.body.toString("utf8");
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const text = plainText(html);
  return {
    sourceUrl: url.toString(),
    fetchedAt: new Date().toISOString(),
    contentHash: createHash("sha256").update(text).digest("hex"),
    title,
    description,
    text,
  };
}

export function fetchWebsiteDocument(rawUrl: string, options: WebsiteFetchOptions = {}) {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? REQUEST_TIMEOUT_MS, 100), 20_000);
  return fetchWebsiteDocumentAt(rawUrl, options, 0, Date.now() + timeoutMs);
}
