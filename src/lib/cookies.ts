import fs from "node:fs";
import { cookieJarPath } from "./paths.ts";

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: number; // unix seconds; -1 or undefined = session
}

export interface CookieJar {
  provider: string;
  capturedAt: string; // ISO
  cookies: StoredCookie[];
}

export function saveJar(providerId: string, cookies: StoredCookie[], capturedAt: string): string {
  const jar: CookieJar = { provider: providerId, capturedAt, cookies };
  const file = cookieJarPath(providerId);
  fs.writeFileSync(file, JSON.stringify(jar, null, 2) + "\n", { mode: 0o600 });
  return file;
}

export function loadJar(providerId: string): CookieJar | null {
  try {
    return JSON.parse(fs.readFileSync(cookieJarPath(providerId), "utf8")) as CookieJar;
  } catch {
    return null;
  }
}

// Does a stored cookie apply to this request host? Domain match, Chrome-style.
function domainMatches(cookieDomain: string, host: string): boolean {
  const d = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
  return host === d || host.endsWith("." + d);
}

/** Build a `Cookie:` header value for a given URL from the stored jar. */
export function cookieHeaderFor(jar: CookieJar, url: string): string {
  const host = new URL(url).hostname;
  const nowSec = Math.floor(Date.now() / 1000);
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const c of jar.cookies) {
    if (!domainMatches(c.domain, host)) continue;
    if (typeof c.expires === "number" && c.expires > 0 && c.expires < nowSec) continue;
    if (seen.has(c.name)) continue; // first match wins (most-specific ordering is caller's job)
    seen.add(c.name);
    parts.push(`${c.name}=${c.value}`);
  }
  return parts.join("; ");
}

export function jarAgeHours(jar: CookieJar): number {
  return (Date.now() - Date.parse(jar.capturedAt)) / 3_600_000;
}
