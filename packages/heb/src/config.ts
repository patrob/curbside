/**
 * Everything here is reverse-engineered from the live H-E-B site and is expected to rot.
 * The persisted-query hashes are tied to a deployed frontend build and WILL rotate; a
 * rotated hash surfaces as a `PersistedQueryNotFound` GraphQL error, which the client
 * turns into a loud, actionable failure rather than a silent no-op.
 */
export const HEB = {
  origin: "https://www.heb.com",
  graphql: "https://www.heb.com/graphql",
  search: (term: string) => `https://www.heb.com/search?q=${encodeURIComponent(term)}`,
  clientName: "WebPlatform-Solar (Production)",
  fallbackBuildId: "26326fc8754e2064814ac43e35c75829f2910496",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  defaultStoreId: 1, // generic default; override with CURBSIDE_HEB_STORE_ID
  shoppingContext: "CURBSIDE_PICKUP",
  priceContext: "CURBSIDE",
} as const;

/** Store selector — public, not a secret, but user-specific, so it's env-overridable. */
export function storeId(): number {
  const env = Number(process.env.CURBSIDE_HEB_STORE_ID);
  return Number.isFinite(env) && env > 0 ? env : HEB.defaultStoreId;
}

export const PERSISTED_QUERIES = {
  // MUTATION — add / set-qty / remove a cart line. quantity is ABSOLUTE; 0 removes.
  cartItemV2: "41798e22dc94f2ce6f483bde6e60638b1486c74f59f37e4b088b5627accf394b",
  // QUERY — read the current cart estimate (lines + subtotal).
  cartEstimated: "40a67f78dd7c214c120ee1dacaae52905541ac7ff9b30ed6dfafe6c2300bf2af",
  // QUERY — list available curbside PICKUP timeslots for a store (read-only).
  listPickupTimeslotsV2: "d6b90d098521c1bd6d88116834d86b325d5713c933cfddef3d0be0650e594d44",
} as const;
