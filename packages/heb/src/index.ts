import type {
  AuthOptions,
  AuthStatus,
  Candidate,
  Cart,
  GroceryProvider,
  OrderPreview,
  OrderResult,
  ReserveOptions,
  ReserveResult,
  SetItemResult,
  Timeslot,
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

  listTimeslots(storeNumber?: number): Promise<Timeslot[]> {
    return HebClient.load().listTimeslots(storeNumber);
  }

  reserveTimeslot(slotId: string, opts?: ReserveOptions): Promise<ReserveResult> {
    return HebClient.load().reserveTimeslot(slotId, opts);
  }

  async previewOrder(): Promise<OrderPreview> {
    const cart = await HebClient.load().getCart();
    return { itemCount: cart.itemCount, subtotal: cart.subtotal };
  }

  async placeOrder(): Promise<OrderResult> {
    // Deliberately not wired. HEB's checkout/submit mutation only appears on the wire
    // when a real order is actually placed, so it can't be captured without spending
    // real money. Wiring it is a joint, deliberate step — never fire blind.
    return {
      placed: false,
      detail:
        "HEB checkout is not wired. Placing a real order needs its submit mutation captured " +
        "in a supervised session (real money) — the CLI will not fire it blind.",
    };
  }
}
