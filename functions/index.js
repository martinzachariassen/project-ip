const { onRequest } = require("firebase-functions/v2/https");

// Reachable only through the Hosting rewrite for /ip — ingress is locked to
// internal+GCLB traffic, so nobody can hit this function's own Cloud Run URL
// directly with a spoofed X-Forwarded-For. Hosting puts the real client
// address first in that header.
exports.ip = onRequest(
  {
    region: "europe-west1",
    ingressSettings: "ALLOW_INTERNAL_AND_GCLB",
    cors: false,
  },
  (req, res) => {
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

    res.set("Cache-Control", "no-store, private");

    if (!address) {
      res.status(502);
      if (wantsJson(req)) {
        res.json({ error: "could not determine address" });
      } else {
        res.type("text/plain").send("error: could not determine address\n");
      }
      return;
    }

    const family = address.includes(":") ? "v6" : "v4";

    if (wantsJson(req)) {
      res.json({ ip: address, family });
    } else {
      res.type("text/plain").send(`${address}\n`);
    }
  },
);

// curl's default Accept is `*/*`, so it gets plain text; the front end asks
// for JSON explicitly.
function wantsJson(req) {
  return (req.headers.accept || "").includes("application/json");
}
