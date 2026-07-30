import {
  CdpClient,
  ensureDebugChrome,
  browserOpen,
  browserTitle,
  saveJar,
  type AuthOptions,
  type AuthStatus,
  type StoredCookie,
} from "@curbside/core";
import { HEB } from "./config.ts";

const PROVIDER = "heb";
const SIGNED_OUT_HINT = /sign in|log in|create account/i;

function isHebCookie(c: StoredCookie): boolean {
  const d = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
  return d === "heb.com" || d.endsWith(".heb.com");
}

/**
 * Harvest the logged-in session from the side-copied Chrome profile.
 *
 * The happy path needs no password and no emailed code: the everyday Chrome is already
 * signed in, so the side-copy inherits a live session and we read the jar (including
 * httpOnly cookies) straight off CDP. `onCodeNeeded` / interactive login is only reached
 * if that inherited session is dead.
 */
export async function hebAuth(opts: AuthOptions = {}): Promise<AuthStatus> {
  const port = opts.port ?? 9222;
  const { reused } = await ensureDebugChrome(port);

  browserOpen(port, `${HEB.origin}/`);
  const title = browserTitle(port);

  const cdp = await CdpClient.connectBrowser(port);
  try {
    const all = await cdp.getAllCookies();
    const cookies = all.filter(isHebCookie);
    const hasSession = cookies.some(
      (c) => c.name === "userId" || c.name === "SSO-EXP" || /session|auth|token/i.test(c.name),
    );

    if (cookies.length === 0 || SIGNED_OUT_HINT.test(title)) {
      return {
        authenticated: false,
        detail: `${reused ? "debug" : "inherited"} session is signed out — sign in to H-E-B in the debug window, then re-run auth`,
      };
    }

    const file = saveJar(PROVIDER, cookies, new Date().toISOString());
    const caveat = hasSession ? "" : " (no obvious session cookie — verify with `curbside cart`)";
    return { authenticated: true, detail: `saved ${cookies.length} cookies${caveat} → ${file}` };
  } finally {
    cdp.close();
  }
}
