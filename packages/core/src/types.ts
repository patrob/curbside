export interface Price {
  amount: number | null;
  formatted: string | null;
  unitAmount?: number | null;
  unit?: string | null;
  isOnSale?: boolean;
}

export interface Candidate {
  productId: string;
  skuId: string | null;
  name: string;
  brand: string | null;
  ownBrand: boolean;
  category?: string;
  size: string | null;
  stock: string | null;
  curbside: boolean;
  minQty: number | null;
  maxQty: number | null;
  price: Price | null;
}

export interface CartLine {
  productId: string;
  skuId: string | null;
  name: string;
  quantity: number;
  price: Price | null;
}

export interface Cart {
  lines: CartLine[];
  subtotal: number | null;
  itemCount: number;
}

export interface SetItemResult {
  productId: string;
  skuId: string;
  quantity: number; // ABSOLUTE quantity that was set; 0 = removed
  ok: boolean;
  /** Persisted-query hash rotated — this is NOT success, it did nothing. */
  stale: boolean;
  status: number;
  errors: string[];
}

export interface AuthStatus {
  authenticated: boolean;
  detail?: string;
}

export interface OrderPreview {
  itemCount: number;
  subtotal: number | null;
  slot?: string;
}

export interface OrderResult {
  placed: boolean;
  detail: string;
  orderId?: string;
}

export interface AuthOptions {
  /** Prompt for an emailed/OTP code when the provider requires a fresh interactive login. */
  onCodeNeeded?: (context: string) => Promise<string>;
  port?: number;
}

export interface GroceryProvider {
  readonly id: string;
  readonly label: string;
  /** Interactive: harvest / refresh credentials (may drive a browser). */
  auth(opts?: AuthOptions): Promise<AuthStatus>;
  /** Non-interactive: is the stored session still good? */
  checkAuth(): Promise<AuthStatus>;
  search(term: string, limit?: number): Promise<Candidate[]>;
  getCart(): Promise<Cart>;
  /** qty is ABSOLUTE. 0 removes the line. */
  setItem(productId: string, skuId: string, qty: number): Promise<SetItemResult>;
  /** Read-only summary of what an order would contain. Optional per provider. */
  previewOrder?(): Promise<OrderPreview>;
  /**
   * Submit a real order — real money. OFF by default in the CLI (gated behind --place +
   * confirmation). Optional per provider; a provider that hasn't wired checkout returns
   * `{ placed: false, ... }` rather than firing blind.
   */
  placeOrder?(): Promise<OrderResult>;
}

/** Thrown when the stored session is stale / bounced by bot protection. */
export class AuthRequiredError extends Error {
  providerId: string;
  constructor(providerId: string, detail: string) {
    super(
      `${providerId}: session expired or challenged (${detail}). Run: curbside auth ${providerId}`,
    );
    this.name = "AuthRequiredError";
    this.providerId = providerId;
  }
}
