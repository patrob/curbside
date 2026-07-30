import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Secrets live OUTSIDE the repo by default so a cookie jar can never be committed.
// Override with CURBSIDE_HOME for tests.
export const CONFIG_HOME =
  process.env.CURBSIDE_HOME ??
  path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "curbside");

export function providerDir(providerId: string): string {
  const dir = path.join(CONFIG_HOME, providerId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function cookieJarPath(providerId: string): string {
  return path.join(providerDir(providerId), "cookies.json");
}

export function debugDumpPath(providerId: string, name: string): string {
  const dir = path.join(providerDir(providerId), "debug");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}
