import { HEB } from "./config.ts";
import type { Candidate, Cart, CartLine, Price } from "../types.ts";

// H-E-B product names carry non-breaking spaces (`Fresh Beefsteak\xa0Tomatoes`).
export function normalizeName(s: string): string {
  return s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

interface NextData {
  buildId?: string;
  props?: { pageProps?: { layout?: { visualComponents?: Array<{ items?: unknown[] }> } } };
}

function priceFromSku(sku: any): Price | null {
  const cps: any[] = sku?.contextPrices ?? [];
  const cp = cps.find((p) => p?.context === HEB.priceContext) ?? cps[0];
  if (!cp) return null;
  return {
    amount: cp.salePrice?.amount ?? cp.listPrice?.amount ?? null,
    formatted: cp.salePrice?.formattedAmount ?? cp.listPrice?.formattedAmount ?? null,
    unitAmount: cp.unitSalePrice?.amount ?? cp.unitListPrice?.amount ?? null,
    unit: cp.unitSalePrice?.unit ?? cp.unitListPrice?.unit ?? null,
    isOnSale: cp.isOnSale ?? false,
  };
}

export const HebParse = {
  nextData(html: string): NextData | null {
    const m = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
    );
    if (!m || !m[1]) return null;
    try {
      return JSON.parse(m[1]) as NextData;
    } catch {
      return null;
    }
  },

  candidates(data: NextData, limit: number): Candidate[] {
    const comps = data.props?.pageProps?.layout?.visualComponents ?? [];
    // Take the first component with a non-empty items array — do NOT assume index 0.
    const comp = comps.find((c) => Array.isArray(c.items) && c.items.length > 0);
    const items = (comp?.items ?? []) as any[];
    return items.slice(0, limit).map((p): Candidate => {
      const sku = p?.SKUs?.[0];
      return {
        productId: String(p?.id ?? ""),
        skuId: sku?.id != null ? String(sku.id) : null,
        name: normalizeName(String(p?.fullDisplayName ?? "")),
        brand: p?.brand?.name ?? null,
        ownBrand: p?.brand?.isOwnBrand ?? false,
        category: p?.fullCategoryHierarchy,
        size: sku?.customerFriendlySize ?? null,
        stock: p?.inventory?.inventoryState ?? null,
        curbside: (sku?.productAvailability ?? []).includes("CURBSIDE_PICKUP"),
        minQty: p?.minimumOrderQuantity ?? null,
        maxQty: p?.maximumOrderQuantity ?? null,
        price: sku ? priceFromSku(sku) : null,
      };
    });
  },

  /**
   * Best-effort cart parser. The exact cartEstimated shape isn't documented, so we walk
   * the response for the first array of objects that look like cart lines and pull a
   * subtotal from any `*subtotal*`/`*estimatedTotal*` numeric field. If HEB's shape
   * differs, the caller dumps raw JSON to debug/cart.json so we can tighten this.
   */
  cart(data: unknown): Cart | null {
    const lines: CartLine[] = [];
    let subtotal: number | null = null;

    const visit = (node: any): void => {
      if (node == null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const el of node) visit(el);
        return;
      }
      for (const [k, v] of Object.entries(node)) {
        if (
          subtotal == null &&
          /subtotal|estimatedtotal|cartTotal/i.test(k) &&
          typeof (v as any)?.amount === "number"
        ) {
          subtotal = (v as any).amount;
        }
        if (subtotal == null && /subtotal/i.test(k) && typeof v === "number") subtotal = v;
      }
      // A cart line looks like it has a productId/skuId and a quantity.
      const pid = node.productId ?? node.product?.id;
      const qty = node.quantity ?? node.qty;
      if (pid != null && typeof qty === "number") {
        lines.push({
          productId: String(pid),
          skuId: node.skuId != null ? String(node.skuId) : (node.sku?.id ?? null),
          name: normalizeName(String(node.displayName ?? node.name ?? node.product?.fullDisplayName ?? "")),
          quantity: qty,
          price: node.SKUs?.[0] ? priceFromSku(node.SKUs[0]) : null,
        });
      }
      for (const v of Object.values(node)) visit(v);
    };

    visit(data);
    if (lines.length === 0 && subtotal == null) return null;
    // De-dupe lines that the walker may have visited twice.
    const seen = new Map<string, CartLine>();
    for (const l of lines) seen.set(`${l.productId}:${l.skuId}`, l);
    const deduped = [...seen.values()];
    return { lines: deduped, subtotal, itemCount: deduped.reduce((n, l) => n + l.quantity, 0) };
  },
};
