import fs from "node:fs";
import {
  AuthRequiredError,
  cookieHeaderFor,
  loadJar,
  debugDumpPath,
  type Candidate,
  type Cart,
  type CookieJar,
  type SetItemResult,
  type Timeslot,
  type TimeslotTier,
} from "@curbside/core";
import { HEB, PERSISTED_QUERIES, storeId } from "./config.ts";
import { HebParse } from "./parse.ts";

const PROVIDER = "heb";

// Incapsula serves a tiny JS-redirect stub instead of the real page when it wants a
// browser challenge. Real HEB HTML always carries __NEXT_DATA__.
function looksLikeChallenge(status: number, body: string): boolean {
  if (status === 403) return true;
  if (/_Incapsula_Resource|window\.location\.reload|Incapsula incident/i.test(body)) return true;
  if (body.length < 1024 && !body.includes("__NEXT_DATA__")) return true;
  return false;
}

export class HebClient {
  #jar: CookieJar;
  #buildId: string = HEB.fallbackBuildId;

  private constructor(jar: CookieJar) {
    this.#jar = jar;
  }

  static load(): HebClient {
    const jar = loadJar(PROVIDER);
    if (!jar || jar.cookies.length === 0) {
      throw new AuthRequiredError(PROVIDER, "no stored cookie jar");
    }
    return new HebClient(jar);
  }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "user-agent": HEB.userAgent,
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      cookie: cookieHeaderFor(this.#jar, HEB.origin),
      ...extra,
    };
  }

  /** GET the search page, scrape live buildId + product candidates from __NEXT_DATA__. */
  async search(term: string, limit = 12): Promise<Candidate[]> {
    const res = await fetch(HEB.search(term), { headers: this.#headers() });
    const body = await res.text();
    if (looksLikeChallenge(res.status, body)) {
      throw new AuthRequiredError(PROVIDER, `search bounced (status ${res.status})`);
    }
    const data = HebParse.nextData(body);
    if (!data) {
      fs.writeFileSync(debugDumpPath(PROVIDER, "search.html"), body);
      throw new Error("No __NEXT_DATA__ in search response (dumped to debug/search.html)");
    }
    if (data.buildId) this.#buildId = data.buildId;
    return HebParse.candidates(data, limit);
  }

  async #graphql<T>(operationName: string, variables: object, hash: string): Promise<T> {
    const res = await fetch(HEB.graphql, {
      method: "POST",
      headers: this.#headers({
        "content-type": "application/json",
        "apollographql-client-name": HEB.clientName,
        "apollographql-client-version": this.#buildId,
      }),
      body: JSON.stringify({
        operationName,
        variables,
        extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
      }),
    });
    const text = await res.text();
    if (looksLikeChallenge(res.status, text)) {
      throw new AuthRequiredError(PROVIDER, `${operationName} bounced (status ${res.status})`);
    }
    let json: { data?: T; errors?: Array<{ message: string }> };
    try {
      json = JSON.parse(text);
    } catch {
      fs.writeFileSync(debugDumpPath(PROVIDER, `${operationName}.txt`), text);
      throw new Error(`${operationName}: non-JSON response (dumped to debug/${operationName}.txt)`);
    }
    const errs = (json.errors ?? []).map((e) => e.message);
    if (errs.some((m) => /PersistedQueryNotFound/i.test(m))) {
      throw new Error(
        `${operationName}: persisted-query hash is STALE (PersistedQueryNotFound). ` +
          `Re-capture the hash — see README "Refreshing the persisted-query hashes". This did NOT run.`,
      );
    }
    if (errs.length) throw new Error(`${operationName}: ${errs.join("; ")}`);
    if (json.data === undefined) throw new Error(`${operationName}: empty data`);
    return json.data;
  }

  async getCart(): Promise<Cart> {
    const data = await this.#graphql<unknown>(
      "cartEstimated",
      { shoppingContext: HEB.shoppingContext, storeId: String(storeId()) },
      PERSISTED_QUERIES.cartEstimated,
    );
    const cart = HebParse.cart(data);
    if (!cart) {
      fs.writeFileSync(debugDumpPath(PROVIDER, "cart.json"), JSON.stringify(data, null, 2));
      throw new Error("Could not parse cartEstimated shape (dumped to debug/cart.json)");
    }
    return cart;
  }

  /** List available curbside PICKUP timeslots for a store (read-only). */
  async listTimeslots(storeNumber: number = storeId()): Promise<TimeslotTier[]> {
    const data = await this.#graphql<{ listPickupTimeslotsV2?: { slotsByTier?: unknown[] } }>(
      "listPickupTimeslotsV2",
      { preCheckout: true, isHebNowEstimatesEnabled: true, storeNumber, limit: 2147483647 },
      PERSISTED_QUERIES.listPickupTimeslotsV2,
    );
    const tiers = (data?.listPickupTimeslotsV2?.slotsByTier ?? []) as Array<Record<string, any>>;
    return tiers.map((t): TimeslotTier => ({
      tier: String(t.tier ?? ""),
      title: String(t.title ?? ""),
      subtitle: String(t.subtitle ?? ""),
      slots: ((t.slots ?? []) as Array<Record<string, any>>).map((s): Timeslot => ({
        id: String(s.id ?? s.recordId ?? ""),
        start: String(s.start ?? ""),
        end: String(s.end ?? ""),
        fulfillmentType: String(s.fulfillmentType ?? "PICKUP"),
        daysInAdvance: Number(s.daysInAdvance ?? 0),
        isFree: Boolean(s.isFree) || (s.totalPrice?.amount ?? 0) === 0,
        price: s.totalPrice
          ? { amount: s.totalPrice.amount ?? null, formatted: s.totalPrice.formattedAmount ?? null }
          : null,
      })),
    }));
  }

  /** qty is ABSOLUTE. 0 removes the line. Always compute from the current cart first. */
  async setItem(productId: string, skuId: string, qty: number): Promise<SetItemResult> {
    try {
      await this.#graphql(
        "cartItemV2",
        { userIsLoggedIn: true, productId: String(productId), skuId: String(skuId), quantity: qty },
        PERSISTED_QUERIES.cartItemV2,
      );
      return { productId, skuId, quantity: qty, ok: true, stale: false, status: 200, errors: [] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        productId,
        skuId,
        quantity: qty,
        ok: false,
        stale: /PersistedQueryNotFound|STALE/i.test(msg),
        status: 0,
        errors: [msg],
      };
    }
  }
}
