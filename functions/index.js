const { onRequest } = require("firebase-functions/v2/https");

// ALLOW_INTERNAL_AND_GCLB would block this function's own cloudfunctions.net
// URL, which is also the path Firebase Hosting's rewrite uses internally —
// so ingress has to stay ALLOW_ALL. That means someone could hit the raw
// Cloud Run URL directly with a spoofed X-Forwarded-For; harmless here since
// nothing downstream trusts this endpoint's address for anything but display.
exports.ip = onRequest(
  {
    region: "europe-west1",
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
