# curbside

A provider-pluggable grocery CLI. **Authenticate once, then drive your curbside/delivery cart
from the terminal — no browser after auth.** First provider: H-E-B.

```
$ curbside search "whole milk" -n 3
 1. $4.43  H-E-B Whole Milk, 1 gal  · 1 gal
     314130:4122075377
 2. $2.81  H-E-B Whole Milk, 1/2 gal  · 1/2 gal
     314135:4122080612
 ...

$ curbside add "whole milk" 2 -y
✓ set to 2: H-E-B Whole Milk, 1 gal

$ curbside cart
   2×   $4.43  H-E-B Whole Milk
        $8.86  Subtotal (2 items)
```

## How it works

The trick (via [@jlongster](https://x.com/jlongster) / [@thdxr](https://x.com/thdxr)): a website's
own network calls *are* its API. Record them once, derive a client, and you never need the browser
again for normal operations.

1. **`curbside auth`** launches a debug Chrome off a **side-copy** of your logged-in profile (your
   everyday browser is never touched), then reads the entire cookie jar — including `httpOnly`
   session cookies and the bot-protection cookies — straight off CDP (`Storage.getCookies`). Zero
   dependencies: Node 22+ ships both `fetch` and `WebSocket`.
2. Cookies are saved to `~/.config/curbside/<provider>/cookies.json` (mode `600`, **outside the
   repo**, gitignored).
3. Every other command is a plain Node `fetch` that replays those cookies. Search parses
   `__NEXT_DATA__` off the search page; cart read/write use H-E-B's GraphQL persisted queries.

### Auth lifetime

H-E-B sits behind **Imperva Incapsula**. The harvested cookies replay fine from Node until Incapsula
decides to re-challenge (new IP, staleness, risk score) — at which point a request comes back as a
tiny challenge stub instead of JSON. The client detects that and tells you to run `curbside auth`
again. In practice that's occasional, not daily. If Incapsula ever starts fingerprinting the TLS
handshake (it wasn't as of first build), the fix is a TLS-impersonating HTTP client — still no
browser for normal ops.

## Commands

| command | what it does |
|---|---|
| `curbside auth [-p heb]` | harvest / refresh the logged-in session |
| `curbside search <term> [-n N] [--json]` | search products, curbside pricing |
| `curbside cart [--json]` | show the current cart |
| `curbside add <term\|pid:sku> <qty> [-y]` | set a line to an **absolute** qty |
| `curbside rm <term\|pid:sku> [-y]` | remove a line (qty 0) |
| `curbside providers` | list providers |

**Writes are dry-run unless you pass `-y`.** They never check out, never change the pickup slot,
store, or time.

### The absolute-quantity trap

`add <term> <qty>` sets the line to that **absolute** quantity — it is not an increment. Sending the
quantity a line already holds returns `200` and changes nothing (a silent no-op). The CLI always
reads the cart to report the real before/after, and a stale persisted-query hash fails **loud**
(`PersistedQueryNotFound`) rather than looking like success.

## Adding a provider

Implement `GroceryProvider` (`src/providers/types.ts`) — `auth`, `checkAuth`, `search`, `getCart`,
`setItem` — and register it in `src/providers/registry.ts`. HEB (`src/providers/heb/`) is the
reference. Walmart / Kroger / Instacart are the obvious next ones.

## Refreshing the persisted-query hashes

The GraphQL hashes in `src/providers/heb/config.ts` belong to a deployed frontend build and rotate
without warning. When one goes stale you'll get `PersistedQueryNotFound`. To re-capture: open a
product page in the debug browser with a CDP network logger attached, do the action once in the UI,
and read the new `sha256Hash` off the wire.

## Develop

```
npm install
npm run typecheck        # tsc, strict
node src/cli.ts search milk   # Node 22+ runs .ts directly (type-stripping)
npm run build            # emit dist/ for the `curbside` bin
```

## ⚠️ Before you open-source this

This reverse-engineers H-E-B's private GraphQL and rides through their bot protection, which their
terms of service almost certainly prohibit, and the persisted-query hashes are brittle by design.
Publishing it is a legal gray area (C&D risk) and a maintenance treadmill. Decide with eyes open.
The cookie jar is a live logged-in session — it stays gitignored and never leaves the machine.
