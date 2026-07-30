import type { GroceryProvider } from "@curbside/core";
import { HebProvider } from "@curbside/heb";

// The composition root: the CLI is the only place that knows which providers exist.
// A third party ships `@yourorg/curbside-walmart` implementing @curbside/core's
// GroceryProvider and registers it here (or via a future plugin-discovery mechanism).
const PROVIDERS: Record<string, () => GroceryProvider> = {
  heb: () => new HebProvider(),
};

export const DEFAULT_PROVIDER = "heb";

export function getProvider(id: string = DEFAULT_PROVIDER): GroceryProvider {
  const make = PROVIDERS[id];
  if (!make) {
    throw new Error(`Unknown provider "${id}". Known: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return make();
}

export function listProviders(): string[] {
  return Object.keys(PROVIDERS);
}
