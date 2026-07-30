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
own network calls _are_ its API. Record them once, derive a client, and you never need the browser
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

| command                                   | what it does                            |
| ----------------------------------------- | --------------------------------------- |
| `curbside auth [-p heb]`                  | harvest / refresh the logged-in session |
| `curbside search <term> [-n N] [--json]`  | search products, curbside pricing       |
| `curbside cart [--json]`                  | show the current cart                   |
| `curbside add <term\|pid:sku> <qty> [-y]` | set a line to an **absolute** qty       |
| `curbside rm <term\|pid:sku> [-y]`        | remove a line (qty 0)                   |
| `curbside order [--place] [-y]`           | preview an order; `--place` submits     |
| `curbside providers`                      | list providers                          |

**Cart writes are dry-run unless you pass `-y`.** They never check out, never change the pickup
slot, store, or time.

### Placing an order

`curbside order` is **read-only by default** — it prints a preview and stops. Actual submission is
opt-in: it requires `--place`, and then a typed confirmation (skip with `-y`). Because a real order
spends real money, providers that haven't wired their checkout call return "not placed" rather than
firing blind — the HEB provider ships in exactly that state until its submit mutation is captured in
a supervised session.

## Config

| env var                 | default | meaning                                           |
| ----------------------- | ------- | ------------------------------------------------- |
| `CURBSIDE_HEB_STORE_ID` | `1`     | your H-E-B store number (find it in the site URL) |
| `CURBSIDE_HOME`         | —       | override where the cookie jar is stored (tests)   |

### The absolute-quantity trap

`add <term> <qty>` sets the line to that **absolute** quantity — it is not an increment. Sending the
quantity a line already holds returns `200` and changes nothing (a silent no-op). The CLI always
reads the cart to report the real before/after, and a stale persisted-query hash fails **loud**
(`PersistedQueryNotFound`) rather than looking like success.

## Layout

An npm-workspaces monorepo — providers are packages, so a third party can publish one without
forking the core:

```
packages/
  core/   @curbside/core   GroceryProvider interface + shared runtime (cookie jar, CDP harvest, side-copy Chrome)
  heb/    @curbside/heb    H-E-B provider — the reference implementation
  cli/    @curbside/cli    the `curbside` binary + provider registry (composition root)
```

Dependency direction is one-way: `core ← heb ← cli`. Only the CLI knows which providers exist.

## Adding a provider

Implement `GroceryProvider` from `@curbside/core` — `auth`, `checkAuth`, `search`, `getCart`,
`setItem` — in a new `packages/<name>/` (or a separately published `@yourorg/curbside-<name>`),
then register it in `packages/cli/src/registry.ts`. `@curbside/heb` is the reference. Walmart /
Kroger / Instacart are the obvious next ones.

## Refreshing the persisted-query hashes

The GraphQL hashes in `packages/heb/src/config.ts` belong to a deployed frontend build and rotate
without warning. When one goes stale you'll get `PersistedQueryNotFound` (the client fails loud, not
silent). To re-capture: open a product page in the debug browser with a CDP network logger attached,
do the action once in the UI, and read the new `sha256Hash` off the wire.

## Develop

Toolchain: **TypeScript 7** (native compiler, project references), **oxlint**, **Prettier**,
Node ≥ 22. Zero runtime dependencies.

```
npm install
npm run build          # tsc -b — builds core → heb → cli in order
npm run lint           # oxlint
npm run format         # prettier --write
npm run verify         # oxlint && tsc -b && prettier --check   (the full gate)
npm run curbside -- search milk

# put `curbside` on PATH:
npm run build && npm link -w @curbside/cli
```

## ⚠️ Disclaimer

This is an unofficial, personal project with no affiliation to H-E-B. It talks to H-E-B's private
GraphQL endpoints and rides through their bot protection, which their terms of service likely
prohibit; the reverse-engineered persisted-query hashes are brittle and rotate without notice. Use
it against your own account, at your own risk. It never places an order without `--place` and an
explicit confirmation. Your cookie jar is a live logged-in session — it is gitignored and never
committed; keep it that way.
