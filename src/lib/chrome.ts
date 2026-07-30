import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Is a CDP endpoint already listening on this port? */
export async function cdpAlive(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Chrome 136+ refuses --remote-debugging-port on the default profile and cannot have one
 * added at runtime, so we side-copy the logged-in profile and launch a SECOND instance
 * against the copy. Patrick's everyday browser is never touched.
 */
export function sideCopyProfile(): string {
  const home = os.homedir();
  const src = path.join(home, "Library/Application Support/Google/Chrome");
  const dst = path.join(home, ".config/curbside/chrome-debug-profile");
  fs.mkdirSync(path.join(dst, "Default"), { recursive: true });
  const copy = (rel: string, recursive = false) => {
    const from = path.join(src, rel);
    const to = path.join(dst, rel);
    if (!fs.existsSync(from)) return;
    fs.cpSync(from, to, { recursive, force: true });
  };
  copy("Local State");
  copy("Default/Cookies");
  copy("Default/Local Storage", true);
  copy("Default/Network", true); // where the encrypted cookie DB actually lives on newer Chrome
  return dst;
}

/** Launch (or reuse) a debug Chrome on `port`, returns when CDP answers. */
export async function ensureDebugChrome(port = 9222): Promise<{ reused: boolean }> {
  if (await cdpAlive(port)) return { reused: true };
  const profile = sideCopyProfile();
  const child = spawn(
    CHROME,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  for (let i = 0; i < 30; i++) {
    if (await cdpAlive(port)) return { reused: false };
    await sleep(500);
  }
  throw new Error(`Chrome did not expose CDP on port ${port} within 15s`);
}

/** Drive the debug browser to a URL using the agent-browser CLI (already installed). */
export function browserOpen(port: number, url: string): void {
  execFileSync("agent-browser", ["--cdp", String(port), "open", url], { stdio: "ignore" });
}

export function browserTitle(port: number): string {
  return execFileSync("agent-browser", ["--cdp", String(port), "get", "title"], {
    encoding: "utf8",
  }).trim();
}
