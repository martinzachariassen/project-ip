# ip.mlz.no

[![CI](https://github.com/martinzachariassen/what-is-my-ip/actions/workflows/ci.yml/badge.svg)](https://github.com/martinzachariassen/what-is-my-ip/actions/workflows/ci.yml)

A minimal "what is my IP" site — live at [ip.mlz.no](https://ip.mlz.no).

A static frontend (plain HTML, CSS, and JS in `public/`) served by Firebase
Hosting, backed by a single small Cloud Function that echoes the caller's
real address.

## Features

- No frontend build step — the files in `public/` are exactly what gets
  deployed
- A scrambled-digit reveal animation and click/tap-to-copy
- One dynamic endpoint, `/ip`, rewritten to a Cloud Function — everything
  else is static and CDN-cached
- Security headers (CSP, HSTS, and friends) and cache policy defined in
  [`firebase.json`](firebase.json)

## Requirements

- [Bun](https://bun.sh), version pinned in [`mise.toml`](mise.toml) — install
  via [mise](https://mise.jdx.dev), or install Bun yourself and match the
  version. The Firebase CLI is pulled in as a devDependency, so no separate
  install is needed.
- Node.js for `functions/` — it's a separate npm-managed package, since Cloud
  Functions' build only recognizes npm/yarn lockfiles.

## Getting started

```sh
bun install
cd functions && npm install && cd ..
bun run dev     # serves public/ and /ip via the Firebase emulators
```

```sh
bun run lint    # biome ci .
bun run format  # biome check --write .
```

A pre-commit hook (wired up by `bun install` via the `prepare` script) runs
`bun run lint` before each commit.

## Architecture

`public/` has no server and no client-side router — every page is a real
`.html` file at a fixed path, and `public/404.html` is served as an actual
404 for anything else.

The one exception is `/ip`, rewritten by Hosting to a Cloud Function
([`functions/index.js`](functions/index.js)) that reads the caller's address
off `X-Forwarded-For` and responds with plain text by default — so
`curl ip.mlz.no/ip` returns a bare address — or JSON when asked
(`Accept: application/json`), which is what the page's own script uses to
render the animation. Its response is always `Cache-Control: no-store`:
the answer is per-visitor by definition, so there is nothing a cache could
usefully hold.

Because `no-store` means every hit reaches the function rather than
Hosting's CDN, `/ip` is the one part of the site with a per-request cost,
and the abuse story is a cost story rather than a data one — the address is
only ever handed back to the caller who owns it. Three things bound it, in
`functions/index.js`:

- **`maxInstances: 3`** with **`concurrency: 250`** — the hard ceiling. The
  handler is a header read, so throughput is bought with concurrency (free,
  per-instance) instead of instances (billed). This is the limit that
  actually holds, and it is pinned in code so a redeploy can't drift off it.
- **`timeoutSeconds: 10`** — down from the platform's 60. Short timeouts are
  what stop a slow-reader flood from parking instances.
- **A per-instance rate limit**, 20 requests per minute per address, in
  memory: no Redis, no Firestore, no extra bill. Its ceiling is really
  20 × live instances, and on the raw Cloud Run URL the key is spoofable —
  it's a speed bump, and `maxInstances` is the wall behind it.

20/min is deliberately close to the bone: a page load costs exactly one
request (every other asset is static and CDN-served), so even someone
leaning on refresh doesn't approach it. What stops it going lower isn't the
individual user but carrier-grade NAT — a mobile network can put many
subscribers behind one IPv4, and they share a bucket.

Under the emulator the limiter skips loopback, so local dev and CI's
readiness polling don't throttle themselves. The exemption is gated on
`FUNCTIONS_EMULATOR`, so production has no loopback hole; CI proves the real
limit by flooding under a spoofed `X-Forwarded-For` instead.

Ingress stays `ALLOW_ALL`: `ALLOW_INTERNAL_AND_GCLB` would block the
`cloudfunctions.net` URL that Hosting's own rewrite goes through. The raw
Cloud Run URL is therefore reachable directly, and a request that arrives
that way can spoof `X-Forwarded-For` — which changes only what that caller
is told about themselves. Through Hosting, Google's front end overwrites the
header, so the address the page shows is the real one.

CI (`.github/workflows/ci.yml`) boots the Hosting + Functions emulators and
asserts that headers, cache rules, and `/ip` actually behave as configured —
`firebase.json`'s `headers` list is last-match-wins, so a reorder could
silently break a rule. It also floods `/ip` under a spoofed address to prove
the rate limit still answers 429 at its real production value. Deploys (`.github/workflows/deploy.yml`) run on every
push to `main`, authenticating to Google Cloud via Workload Identity
Federation — no long-lived secrets stored in the repo.

## Contributing

This is a personal project, not one soliciting new features — but bug
reports and small fixes are welcome via issue or PR.

## License

[MIT](LICENSE)
