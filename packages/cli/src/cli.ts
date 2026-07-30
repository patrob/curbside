#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { AuthRequiredError, type Candidate } from "@curbside/core";
import { getProvider, listProviders, DEFAULT_PROVIDER } from "./registry.ts";

interface Flags {
  provider: string;
  limit: number;
  json: boolean;
  execute: boolean;
  yes: boolean;
  _: string[];
}

function parse(argv: string[]): Flags {
  const f: Flags = {
    provider: DEFAULT_PROVIDER,
    limit: 8,
    json: false,
    execute: false,
    yes: false,
    _: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--provider" || a === "-p") f.provider = argv[++i]!;
    else if (a === "--limit" || a === "-n") f.limit = Number(argv[++i]);
    else if (a === "--json") f.json = true;
    else if (a === "--execute") f.execute = true;
    else if (a === "--yes" || a === "-y") {
      f.yes = true;
      f.execute = true;
    } else f._.push(a);
  }
  return f;
}

const money = (n: number | null): string => (n == null ? "  —  " : `$${n.toFixed(2)}`);

function printCandidate(c: Candidate, idx?: number): void {
  const tag = idx != null ? `${String(idx + 1).padStart(2)}. ` : "";
  const stock = c.stock && c.stock !== "IN_STOCK" ? ` [${c.stock}]` : "";
  const curb = c.curbside ? "" : " (no curbside)";
  console.log(
    `${tag}${money(c.price?.amount ?? null)}  ${c.name}${c.size ? `  · ${c.size}` : ""}${stock}${curb}`,
  );
  console.log(`     ${c.productId}:${c.skuId ?? "?"}`);
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return ans === "y" || ans === "yes";
}

/** Resolve an item argument to {productId, skuId, name}. Either "pid:sku" or a search term. */
async function resolveItem(
  flags: Flags,
  arg: string,
): Promise<{ productId: string; skuId: string; name: string } | null> {
  const direct = arg.match(/^([^:\s]+):([^:\s]+)$/);
  if (direct) return { productId: direct[1]!, skuId: direct[2]!, name: arg };

  const provider = getProvider(flags.provider);
  const hits = (await provider.search(arg, 8)).filter((c) => c.curbside && c.skuId);
  if (hits.length === 0) {
    console.error(`No curbside-eligible match for "${arg}".`);
    return null;
  }
  const top = hits[0]!;
  if (hits.length > 1 && !flags.yes) {
    console.log(
      `Multiple matches for "${arg}" — pick one and pass it as productId:sku, or re-run with -y to take #1:`,
    );
    hits.slice(0, 5).forEach((c, i) => printCandidate(c, i));
    return null;
  }
  return { productId: top.productId, skuId: top.skuId!, name: top.name };
}

async function cmdAuth(flags: Flags): Promise<number> {
  const provider = getProvider(flags.provider);
  console.log(`Authenticating ${provider.label}…`);
  const status = await provider.auth({ port: 9222 });
  console.log(
    status.authenticated
      ? `✓ ${provider.label} authenticated. ${status.detail ?? ""}`
      : `✗ ${status.detail ?? "not authenticated"}`,
  );
  return status.authenticated ? 0 : 1;
}

async function cmdSearch(flags: Flags): Promise<number> {
  const term = flags._.join(" ");
  if (!term) return usage('search needs a term: curbside search "whole milk"');
  const provider = getProvider(flags.provider);
  const hits = await provider.search(term, flags.limit);
  if (flags.json) {
    console.log(JSON.stringify(hits, null, 2));
    return 0;
  }
  if (hits.length === 0) {
    console.log(`No matches for "${term}".`);
    return 0;
  }
  hits.forEach((c, i) => printCandidate(c, i));
  return 0;
}

async function cmdCart(flags: Flags): Promise<number> {
  const provider = getProvider(flags.provider);
  const cart = await provider.getCart();
  if (flags.json) {
    console.log(JSON.stringify(cart, null, 2));
    return 0;
  }
  if (cart.lines.length === 0) {
    console.log("Cart is empty.");
    return 0;
  }
  for (const l of cart.lines) {
    console.log(
      `  ${String(l.quantity).padStart(2)}×  ${money(l.price?.amount ?? null)}  ${l.name}`,
    );
  }
  console.log(`      ${money(cart.subtotal)}  Subtotal (${cart.itemCount} items)`);
  return 0;
}

async function cmdSet(flags: Flags, verb: "add" | "rm"): Promise<number> {
  const provider = getProvider(flags.provider);
  const arg = flags._[0];
  if (!arg)
    return usage(`${verb} needs an item: curbside ${verb} "milk"${verb === "add" ? " 2" : ""}`);
  const qty = verb === "rm" ? 0 : Number(flags._[1] ?? "1");
  if (verb === "add" && (!Number.isFinite(qty) || qty < 1))
    return usage("add needs a quantity ≥ 1");

  const item = await resolveItem(flags, arg);
  if (!item) return 1;

  const action = qty === 0 ? `REMOVE ${item.name}` : `set ${item.name} → qty ${qty} (absolute)`;
  if (!flags.execute) {
    console.log(`[dry-run] would ${action}`);
    console.log(`          ${item.productId}:${item.skuId}`);
    console.log("Re-run with -y to execute, or --execute after a confirm prompt.");
    return 0;
  }
  if (!flags.yes && !(await confirm(`${action}?`))) {
    console.log("Aborted.");
    return 1;
  }

  const r = await provider.setItem(item.productId, item.skuId, qty);
  if (r.stale) {
    console.error(`✗ STALE persisted-query hash — nothing changed. ${r.errors.join("; ")}`);
    return 2;
  }
  if (!r.ok) {
    console.error(`✗ failed: ${r.errors.join("; ")}`);
    return 1;
  }
  console.log(`✓ ${qty === 0 ? "removed" : `set to ${qty}`}: ${item.name}`);
  return 0;
}

async function cmdSlots(flags: Flags): Promise<number> {
  const provider = getProvider(flags.provider);
  if (!provider.listTimeslots) {
    console.error(`✗ ${provider.label} has no timeslot support.`);
    return 1;
  }
  const tiers = await provider.listTimeslots();
  if (flags.json) {
    console.log(JSON.stringify(tiers, null, 2));
    return 0;
  }
  const tz = "America/Chicago";
  const startFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const endFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  });
  let shown = 0;
  for (const t of tiers) {
    if (!t.slots.length) continue;
    console.log(`\n${t.title}${t.subtitle ? ` — ${t.subtitle}` : ""}`);
    for (const s of t.slots.slice(0, flags.limit)) {
      const cost = s.isFree ? "FREE " : money(s.price?.amount ?? null);
      console.log(
        `  ${startFmt.format(new Date(s.start))}–${endFmt.format(new Date(s.end))}  ${cost.padEnd(6)} ${s.id}`,
      );
      shown++;
    }
    if (t.slots.length > flags.limit) console.log(`  … +${t.slots.length - flags.limit} more`);
  }
  if (!shown) console.log("No timeslots available.");
  return 0;
}

async function cmdOrder(flags: Flags): Promise<number> {
  const provider = getProvider(flags.provider);
  if (!provider.previewOrder || !provider.placeOrder) {
    console.error(`✗ ${provider.label} does not support ordering.`);
    return 1;
  }

  const preview = await provider.previewOrder();
  console.log(
    `Order preview (${provider.label}): ${preview.itemCount} items, ${money(preview.subtotal)}` +
      (preview.slot ? `, slot ${preview.slot}` : ""),
  );

  const place = flags._.includes("--place") || flags.execute;
  if (!place) {
    console.log("Order placement is OFF. Re-run with --place to enable (this spends real money).");
    return 0;
  }
  if (preview.itemCount === 0) {
    console.error("✗ Cart is empty — nothing to place.");
    return 1;
  }

  // --place still requires an explicit confirmation unless -y.
  if (
    !flags.yes &&
    !(await confirm(`Place a REAL ${provider.label} order for ${money(preview.subtotal)}?`))
  ) {
    console.log("Aborted — no order placed.");
    return 1;
  }

  const result = await provider.placeOrder();
  if (!result.placed) {
    console.error(`✗ Not placed: ${result.detail}`);
    return 2;
  }
  console.log(`✓ Order placed${result.orderId ? ` (#${result.orderId})` : ""}. ${result.detail}`);
  return 0;
}

function usage(msg?: string): number {
  if (msg) console.error(`error: ${msg}\n`);
  console.log(`curbside — provider-pluggable grocery CLI

Usage:
  curbside auth [-p <provider>]              Harvest / refresh the logged-in session
  curbside search <term> [-n N] [--json]     Search products (curbside price)
  curbside cart [--json]                     Show the current cart
  curbside add <term|pid:sku> <qty> [-y]     Set a line to an absolute qty (dry-run without -y)
  curbside rm  <term|pid:sku> [-y]           Remove a line (dry-run without -y)
  curbside slots [-n N] [--json]             List available curbside pickup timeslots
  curbside order [--place] [-y]              Preview an order; --place submits (real money, OFF by default)
  curbside providers                         List providers

Flags:
  -p, --provider <id>   default: ${DEFAULT_PROVIDER} (${listProviders().join(", ")})
  -n, --limit <N>       search result cap (default 8)
  -y, --yes             execute writes without a prompt
      --execute         execute writes (still prompts unless -y)
      --json            machine-readable output

Writes never check out and never change the pickup slot or store.`);
  return msg ? 1 : 0;
}

async function main(): Promise<number> {
  const [, , cmd, ...rest] = process.argv;
  const flags = parse(rest);
  try {
    switch (cmd) {
      case "auth":
        return await cmdAuth(flags);
      case "search":
        return await cmdSearch(flags);
      case "cart":
        return await cmdCart(flags);
      case "add":
        return await cmdSet(flags, "add");
      case "rm":
      case "remove":
        return await cmdSet(flags, "rm");
      case "slots":
        return await cmdSlots(flags);
      case "order":
        return await cmdOrder(flags);
      case "providers":
        console.log(listProviders().join("\n"));
        return 0;
      case undefined:
      case "help":
      case "-h":
      case "--help":
        return usage();
      default:
        return usage(`unknown command "${cmd}"`);
    }
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      console.error(`✗ ${e.message}`);
      return 3;
    }
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

main().then((code) => process.exit(code));
