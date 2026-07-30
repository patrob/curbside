// Minimal Chrome DevTools Protocol client over the built-in WebSocket (Node >=22).
// Zero dependencies. We only need two things: read all cookies, and eval a bit of JS
// on a page to confirm login state.
import type { StoredCookie } from "./cookies.ts";

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class CdpClient {
  #ws: WebSocket;
  #id = 0;
  #pending = new Map<number, Pending>();
  #sessionId?: string;

  private constructor(ws: WebSocket, sessionId?: string) {
    this.#ws = ws;
    this.#sessionId = sessionId;
    ws.addEventListener("message", (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (typeof msg.id !== "number") return; // event, ignore
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
  }

  static async connectBrowser(port = 9222): Promise<CdpClient> {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!res.ok) throw new Error(`CDP /json/version returned ${res.status} on port ${port}`);
    const { webSocketDebuggerUrl } = (await res.json()) as { webSocketDebuggerUrl: string };
    return CdpClient.#open(webSocketDebuggerUrl);
  }

  static async #open(wsUrl: string, sessionId?: string): Promise<CdpClient> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("CDP websocket error")), { once: true });
    });
    return new CdpClient(ws, sessionId);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.#id;
    const payload: Record<string, unknown> = { id, method, params };
    if (this.#sessionId) payload.sessionId = this.#sessionId;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.#ws.send(JSON.stringify(payload));
    });
  }

  /** All cookies in the default browser context, including httpOnly. */
  async getAllCookies(): Promise<StoredCookie[]> {
    const { cookies } = await this.send<{ cookies: StoredCookie[] }>("Storage.getCookies");
    return cookies;
  }

  /** First page target's URL, or null if only about:blank / no page open. */
  async firstPageUrl(port = 9222): Promise<string | null> {
    const res = await fetch(`http://127.0.0.1:${port}/json`);
    const targets = (await res.json()) as Array<{ type: string; url: string }>;
    const page = targets.find((t) => t.type === "page");
    return page?.url ?? null;
  }

  close(): void {
    this.#ws.close();
  }
}
