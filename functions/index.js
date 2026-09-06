const { onRequest } = require("firebase-functions/v2/https");

// ALLOW_INTERNAL_AND_GCLB would block this function's own cloudfunctions.net
// URL, which is also the path Firebase Hosting's rewrite uses internally —
// so ingress has to stay ALLOW_ALL. That means someone could hit the raw
// Cloud Run URL directly with a spoofed X-Forwarded-For; harmless for the
// answer itself (nothing downstream trusts this endpoint's address for
// anything but display), but it does mean the rate limit below is only a
// speed bump on that path. `maxInstances` is the ceiling that actually
// holds, and it is a cost ceiling, not just a traffic one.
//
// Every one of these is set explicitly rather than left to the CLI's
// defaults: an unpinned maxInstances is the difference between a bad day
// and a bad invoice, and drift between deployed config and this file is
// invisible until it matters.
exports.ip = onRequest(
  {
    region: "europe-west1",
    cors: false,
    // The handler is a header read and a string split. One instance can
    // absorb a lot of it, so buy throughput with concurrency (cheap — it
    // is per-instance) rather than with instances (billed).
    concurrency: 250,
    maxInstances: 3,
    memory: "256MiB",
    // 60s is the platform default and far more than an echo needs. A short
    // timeout is what stops a slow-reader flood from parking instances.
    timeoutSeconds: 10,
    minInstances: 0,
  },
  (req, res) => {
    // Nothing here mutates anything, so anything but a read is a probe.
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.set("Allow", "GET, HEAD");
      res.status(405).type("text/plain").send("method not allowed\n");
      return;
    }

    const forwarded = req.headers["x-forwarded-for"];
    const address =
      (Array.isArray(forwarded) ? forwarded[0] : (forwarded ?? ""))
        .split(",")[0]
        .trim() ||
      req.socket?.remoteAddress ||
      // The emulator's local dispatch has no real socket, so there's no
      // X-Forwarded-For and no remoteAddress to fall back to either — only
      // real traffic through Google's front end sets those.
      (process.env.FUNCTIONS_EMULATOR === "true" ? "127.0.0.1" : "");

    // Never cached — by a browser, by Hosting's CDN, or by anything in
    // between. `Vary` because the same URL answers in two formats.
    res.set("Cache-Control", "no-store, private");
    res.set("Vary", "Accept");
    // The address is the caller's own, but there is no reason for it to
    // turn up in a search index via some proxy that mirrors the endpoint.
    res.set("X-Robots-Tag", "noindex");

    if (!address) {
      respond(req, res, 502, { error: "could not determine address" });
      return;
    }

    const retryAfter = rateLimit(address);
    if (retryAfter !== null) {
      res.set("Retry-After", String(retryAfter));
      respond(req, res, 429, { error: "too many requests" });
      return;
    }

    const family = address.includes(":") ? "v6" : "v4";
    respond(req, res, 200, { ip: address, family });
  },
);

// curl's default Accept is `*/*`, so it gets plain text; the front end asks
// for JSON explicitly. Errors follow the same rule, so a curl user gets a
// readable line rather than a JSON blob they didn't ask for.
function respond(req, res, status, body) {
  res.status(status);
  if ((req.headers.accept || "").includes("application/json")) {
    res.json(body);
  } else {
    const text = body.error ? `error: ${body.error}` : body.ip;
    res.type("text/plain").send(`${text}\n`);
  }
}

// ---- rate limiting ----
//
// Per-instance and in-memory: no Redis, no Firestore, no extra bill, and no
// dependency for a site whose whole backend is twelve lines of header
// reading. The cost is that the real ceiling is WINDOW_MAX × the number of
// live instances rather than WINDOW_MAX flat — which is why maxInstances is
// pinned low above. It is a mitigation, not a gate.
const WINDOW_MS = 60_000;
// One page load is exactly one request — the frontend fetches /ip once and
// every other asset comes off Hosting's CDN. So the honest budget for a
// human is single digits per minute, and 20 is already generous for someone
// leaning on refresh. The floor on how low this can go isn't the individual
// user, it's carrier-grade NAT: a mobile network can put a lot of people
// behind one IPv4, and they all key on the same bucket.
const WINDOW_MAX = 20;
// A flood from many distinct addresses would otherwise grow this map without
// bound and OOM the instance — which is the outage the limiter exists to
// prevent. Past the cap we stop tracking new addresses and fail open.
const MAX_TRACKED = 20_000;

let windowStart = Date.now();
let hits = new Map();

// Returns null when the caller is under the limit, or the number of seconds
// until the window rolls over when it isn't.
function rateLimit(address) {
  // No front end sets X-Forwarded-For in the emulator, so every local request
  // keys on the same loopback address — a dev session, or CI's readiness
  // polling, would rate limit itself before it got to what it was testing.
  // Requests that carry an explicit X-Forwarded-For are still counted, which
  // is how CI exercises the real limit rather than a relaxed one. Gated on
  // the emulator so production has no loopback hole to aim at.
  if (
    process.env.FUNCTIONS_EMULATOR === "true" &&
    (address === "127.0.0.1" || address === "::1")
  ) {
    return null;
  }

  const now = Date.now();

  // Whole-map rollover rather than per-key expiry: one allocation a minute,
  // and it doubles as the eviction pass the map would otherwise need.
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    hits = new Map();
  }

  const count = hits.get(address);

  if (count === undefined) {
    if (hits.size < MAX_TRACKED) hits.set(address, 1);
    return null;
  }

  if (count >= WINDOW_MAX) {
    return Math.max(1, Math.ceil((windowStart + WINDOW_MS - now) / 1000));
  }

  hits.set(address, count + 1);
  return null;
}
