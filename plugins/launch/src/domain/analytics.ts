import { createHash } from "crypto";

const BOT_UA_RE =
  /bot|crawler|spider|headless|playwright|puppeteer|selenium|slurp|facebookexternalhit|twitterbot|googlebot|bingbot|yandexbot/i;

/** sha256(ip + "YYYY-MM-DD") — changes daily for privacy; never stored raw. */
export function hashIp(ip: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${ip}|${today}`)
    .digest("hex")
    .slice(0, 32);
}

export function hashUa(ua: string): string {
  return createHash("sha256").update(ua).digest("hex").slice(0, 16);
}

export function isBot(ua: string | null | undefined): boolean {
  if (!ua) return true;
  return BOT_UA_RE.test(ua);
}
