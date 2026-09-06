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
render the animation. Its response is always `Cache-Control: no-store` —
nothing here is per-visitor data worth caching, or worth restricting ingress
over, since the address is only ever displayed back to the caller.

CI (`.github/workflows/ci.yml`) boots the Hosting + Functions emulators and
asserts that headers, cache rules, and `/ip` actually behave as configured —
`firebase.json`'s `headers` list is last-match-wins, so a reorder could
silently break a rule. Deploys (`.github/workflows/deploy.yml`) run on every
push to `main`, authenticating to Google Cloud via Workload Identity
Federation — no long-lived secrets stored in the repo.

## Contributing

This is a personal project, not one soliciting new features — but bug
reports and small fixes are welcome via issue or PR.

## License

[MIT](LICENSE)
