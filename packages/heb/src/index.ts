import type {
  AuthOptions,
  AuthStatus,
  Candidate,
  Cart,
  GroceryProvider,
  SetItemResult,
} from "@curbside/core";
import { HebClient } from "./client.ts";
import { hebAuth } from "./auth.ts";

export class HebProvider implements GroceryProvider {
  readonly id = "heb";
  readonly label = "H-E-B";

  auth(opts?: AuthOptions): Promise<AuthStatus> {
    return hebAuth(opts);
  }

  async checkAuth(): Promise<AuthStatus> {
    try {
      const client = HebClient.load();
      await client.search("milk", 1); // cheapest read; throws AuthRequiredError if bounced
      return { authenticated: true };
    } catch (e) {
      return { authenticated: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  search(term: string, limit?: number): Promise<Candidate[]> {
    return HebClient.load().search(term, limit);
  }

  getCart(): Promise<Cart> {
    return HebClient.load().getCart();
  }

  setItem(productId: string, skuId: string, qty: number): Promise<SetItemResult> {
    return HebClient.load().setItem(productId, skuId, qty);
  }
}
