import { HebProvider } from "./heb/index.ts";
import type { GroceryProvider } from "./types.ts";

const PROVIDERS: Record<string, () => GroceryProvider> = {
  heb: () => new HebProvider(),
  // Future: walmart, kroger, instacart — each implements GroceryProvider.
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
