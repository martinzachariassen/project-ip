(() => {
  "use strict";

  /* ---------- static placeholder data (dev) ---------- */
  // No geo/ISP line. The page answers one question, and a city that GeoIP
  // guessed wrong would only undermine the one number it got right.
  const DATA = {
    v4: { ip: "84.212.19.77" },
    v6: { ip: "2a01:79c:cebd:8e40:1c2b:9f3a:44de:1" },
  };

  const params = new URLSearchParams(location.search);
  // ?nov4 / ?nov6 exercise a single-stack network while the data is still
  // static. Both together previews a machine that answered for neither family.
  if (params.has("nov4")) DATA.v4 = null;
  if (params.has("nov6")) DATA.v6 = null;

  /* ---------- scramble ---------- */
  const DIGITS = "0123456789";
  const HEX = "0123456789abcdef";
  const SEPARATOR = /[.:]/;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  /**
   * Time-based (not frame-based) so it runs identically at 60/120/144Hz.
   * Separators stay pinned — they're the skeleton that says "this is an IP"
   * from the first frame, and they make the reveal read as filling-in.
   */
  function scramble(el, target, opts = {}) {
    const {
      duration = 900, // whole animation
      charDuration = 380, // how long each char churns before locking
      churn = 50, // ms between glyph re-rolls (~20Hz)
      hold = 80, // ms of full static before the reveal front moves
      perpetual = false, // never lock in (failure state)
      pool = /[a-f]/i.test(target) ? HEX : DIGITS,
    } = opts;

    cancelAnimationFrame(el._scrambleRAF);

    const chars = [...target];
    const n = chars.length;

    // Build one span per character once; per frame we only touch textContent.
    const cells = chars.map((ch, i) => {
      const span = document.createElement("span");
      span.className = SEPARATOR.test(ch) ? "cell sep" : "cell";
      span.style.setProperty("--i", i);
      span.textContent = ch;
      return span;
    });
    el.replaceChildren(...cells);

    // Perpetual churn is exactly the kind of motion this guideline exists for,
    // so the failure state goes static too — the dimmed styling still reads.
    if (reduced.matches) {
      if (perpetual) cells.forEach((c) => c.classList.add("is-scrambling"));
      return Promise.resolve();
    }

    const live = [];
    for (let i = 0; i < n; i++) if (!SEPARATOR.test(chars[i])) live.push(i);
    const m = live.length;

    const span = Math.max(0, duration - hold - charDuration);
    const stagger = m > 1 ? span / (m - 1) : 0;

    const slot = new Array(n).fill(null);
    live.forEach((idx, k) => {
      const start = hold + k * stagger;
      slot[idx] = { start, end: start + charDuration };
    });

    const total = hold + (m - 1) * stagger + charDuration;
    const glyph = new Array(n).fill("");
    let lastChurn = -Infinity;
    let t0 = 0;

    return new Promise((resolve) => {
      const step = (now) => {
        if (!t0) t0 = now;
        const t = now - t0;
        const reroll = t - lastChurn >= churn;
        if (reroll) lastChurn = t;

        for (let i = 0; i < n; i++) {
          const s = slot[i];
          if (!s) continue; // separator: pinned for the whole animation

          const locked = !perpetual && t >= s.end;
          if (locked) {
            if (cells[i].textContent !== chars[i]) cells[i].textContent = chars[i];
            cells[i].classList.remove("is-scrambling");
            continue;
          }

          if (perpetual || t >= s.start) {
            if (reroll || !glyph[i]) {
              // Exclude the real digit, otherwise it flashes the answer ~10%
              // of frames and the lock-in reads as a stutter.
              let c;
              do {
                c = pool[(Math.random() * pool.length) | 0];
              } while (c === chars[i] && pool.length > 1);
              glyph[i] = c;
            }
            if (cells[i].textContent !== glyph[i]) cells[i].textContent = glyph[i];
            cells[i].classList.add("is-scrambling");
          }
        }

        if (perpetual || t < total) {
          el._scrambleRAF = requestAnimationFrame(step);
        } else {
          cells.forEach((c, i) => {
            c.textContent = chars[i];
            c.classList.remove("is-scrambling");
          });
          resolve();
        }
      };
      el._scrambleRAF = requestAnimationFrame(step);
    });
  }

  /* ---------- elements ---------- */
  const ipBtn = document.getElementById("ip");
  const ipText = document.getElementById("ip-text");
  const ipLabel = document.getElementById("ip-label");
  const metaEl = document.getElementById("meta");
  const metaText = document.getElementById("meta-text");
  const statusEl = document.getElementById("status");
  const toggleEl = document.querySelector(".toggle");
  const toggleBtns = [...document.querySelectorAll(".toggle-btn")];
  const curlBtn = document.getElementById("curl");
  const curlLabel = document.getElementById("curl-label");

  const BASE_TITLE = document.title;
  // index.html owns the wording; we only decide when it applies.
  const COPY_HINT = ipBtn.title;

  // `copyable` is not the same as `!failed`: a v4-only network is a successful
  // lookup with nothing to put on the clipboard.
  const state = { version: "v4", failed: false, copyable: false, meta: "" };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ---------- screen reader announcements ---------- */
  let announceTimer;
  function announce(message) {
    // Identical content isn't a change and won't re-announce, so clear first
    // — on a separate tick, or the clear itself gets swallowed.
    clearTimeout(announceTimer);
    statusEl.textContent = "";
    announceTimer = setTimeout(() => {
      statusEl.textContent = message;
    }, 100);
  }

  /* ---------- meta line ---------- */
  // Empty at rest. The slot exists so the page has somewhere to speak from
  // when it has something to say — copied, no IPv6, no route — and the
  // reserved row height means saying it never moves the IP.
  let metaToken = 0;
  let metaRevertTimer;

  function setMeta(text) {
    clearTimeout(metaRevertTimer);
    metaToken++; // any in-flight fade loses ownership of the slot
    delete metaEl.dataset.copied;
    state.meta = text;
    metaText.textContent = text;
  }

  // Fades the current text out before swapping. Tokenised because a version
  // switch or a second copy can land mid-fade, and the stale continuation
  // must not write its text over the newer one.
  async function fadeMetaTo(text) {
    const token = ++metaToken;
    metaEl.classList.add("is-swapping");
    await wait(EXIT_MS);
    if (token !== metaToken) return;
    metaText.textContent = text;
    metaEl.classList.remove("is-swapping");
  }

  // Borrow the slot for 1.5s, then hand it back to whatever belongs there.
  function flashMeta(text) {
    clearTimeout(metaRevertTimer);
    metaEl.dataset.copied = "";
    fadeMetaTo(text);
    metaRevertTimer = setTimeout(() => {
      delete metaEl.dataset.copied;
      fadeMetaTo(state.meta);
    }, 1500);
  }

  /* ---------- copy ---------- */
  let copyTimer;
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:absolute;left:-9999px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  async function copyIP() {
    if (!state.copyable) return;
    const ip = DATA[state.version].ip;

    // Optimistic: fire the visual before awaiting the clipboard promise.
    // Attribute-driven, so rapid clicks just push the deadline out — the
    // transition retargets mid-flight instead of restarting.
    ipBtn.dataset.copied = "";
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      delete ipBtn.dataset.copied;
    }, 1500);

    const ok = await copyText(ip);
    // The scanline says "something happened"; the word says what. Together
    // they also teach the affordance after the fact — which is the only way
    // touch users, who never get the hover colour, find out it's clickable.
    flashMeta(ok ? "copied to clipboard" : "copy failed");
    announce(ok ? "IP address copied" : "Copy failed");
  }

  ipBtn.addEventListener("click", copyIP);

  /* ---------- curl hint ---------- */
  // index.html owns the command string — read it back rather than duplicating
  // the hostname here. Captured once at boot, because the label itself gets
  // borrowed for the confirmation and can't be the source of truth after that.
  const CURL_CMD = curlLabel?.textContent.trim() ?? "";

  let curlTimer;
  let curlToken = 0;

  // Same fade-out-swap-fade-in as the meta line, tokenised for the same
  // reason: a second click can land mid-fade, and the stale continuation must
  // not write the command back over a newer "copied".
  async function swapCurlLabel(text) {
    const token = ++curlToken;
    curlBtn.classList.add("is-swapping");
    await wait(EXIT_MS);
    if (token !== curlToken) return;
    curlLabel.textContent = text;
    curlBtn.classList.remove("is-swapping");
  }

  curlBtn?.addEventListener("click", async () => {
    // Optimistic, like the IP copy: the colour lands on the click, the word
    // follows once the clipboard actually answers.
    clearTimeout(curlTimer);
    curlBtn.dataset.copied = "";

    const ok = await copyText(CURL_CMD);
    swapCurlLabel(ok ? "copied" : "copy failed");
    announce(ok ? "Command copied" : "Copy failed");

    curlTimer = setTimeout(() => {
      delete curlBtn.dataset.copied;
      swapCurlLabel(CURL_CMD);
    }, 1500);
  });

  /* ---------- render ---------- */
  // IPv6 has ~3x the characters; scaling the stagger linearly would take 2.5s,
  // so each version gets a fixed total instead.
  // Boot is a reveal and is allowed a beat of anticipation. A toggle is a
  // response to a click and has to feel like one — same animation, ~40%
  // quicker, and no `hold`, because the press already was the hold.
  const TIMING = {
    boot: {
      v4: { duration: 900, charDuration: 380 },
      v6: { duration: 1200, charDuration: 260 },
    },
    switch: {
      v4: { duration: 520, charDuration: 240, hold: 0 },
      v6: { duration: 680, charDuration: 180, hold: 0 },
    },
  };

  function setToggle(version) {
    // Drives the sliding pill in CSS.
    toggleEl.dataset.version = version;
    toggleBtns.forEach((btn) => {
      const active = btn.dataset.version === version;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  // `aria-disabled`, not the `disabled` attribute: a truly disabled button
  // drops out of the tab order and goes silent, so a screen reader user
  // sweeping the page finds nothing where the control was and can't tell
  // whether the page has a version switch at all. This way it stays reachable
  // and announces itself — as unavailable. selectVersion() already refuses the
  // click, so the attribute is describing a rule that's enforced elsewhere.
  function setToggleEnabled(enabled) {
    toggleEl.classList.toggle("is-disabled", !enabled);
    toggleBtns.forEach((btn) => btn.setAttribute("aria-disabled", String(!enabled)));
  }

  const STATIC = { duration: 0, hold: 0, charDuration: 0 };

  // Which family is missing decides the copy. A v6-only network is a real
  // place to be — mobile carriers, v6-only hosting — and telling someone
  // standing on one that they have "no IPv6" is worse than saying nothing.
  // Each side borrows its own family's unspecified address, which is that
  // family's own word for "no address" and keeps the slot honest without
  // inventing a sentence to put in it.
  // The slot says it in words rather than borrowing the family's unspecified
  // address. `::` and `0.0.0.0` are exact, but they're exact for people who
  // already know IPv6 — and those are precisely the people who never needed
  // this page. To everyone else two colons at 128px read as a failed render,
  // and `0.0.0.0` reads worse still: like a real answer they could repeat to
  // someone. The largest thing on screen should say what the screen reader
  // already says.
  const EMPTY = {
    v4: { word: "no IPv4", label: "No IPv4 address on this network", title: "no ipv4", other: "v6" },
    v6: { word: "no IPv6", label: "No IPv6 address on this network", title: "no ipv6", other: "v4" },
  };

  // The word above already carries "no IPv6", so the line underneath spends
  // itself on what the word can't say: why, and why clicking does nothing.
  // The "v4-only" half is a claim about the *other* family, so it's composed
  // from that family's data rather than baked into a string — hardcoded, it
  // silently became a lie when both came back empty, with each tab claiming
  // the other one worked.
  function emptyMeta(empty) {
    const cause = DATA[empty.other] ? `${empty.other}-only network` : "no address either way";
    return `${cause} · nothing to copy`;
  }

  // The empty state can't go through scramble(): those cells are a digit grid
  // pinned to `width: 1ch`, which stacks letters on top of each other. One
  // span that opts out of the grid — but still a `.cell`, so it inherits the
  // dimming the failure and empty states share.
  function setWord(el, text) {
    cancelAnimationFrame(el._scrambleRAF);
    const span = document.createElement("span");
    span.className = "cell word";
    span.style.setProperty("--i", 0);
    span.textContent = text;
    el.replaceChildren(span);
  }

  function render(version, { animate = true, fast = false } = {}) {
    const entry = DATA[version];
    state.version = version;

    ipBtn.classList.remove("is-failed", "is-empty");
    // A tooltip promising "click to copy" on a slot with nothing in it is
    // worse than no tooltip, so it comes and goes with the ability.
    if (entry) ipBtn.title = COPY_HINT;
    else ipBtn.removeAttribute("title");
    setToggle(version);
    // An empty family is still worth switching away from, so the control only
    // dies on a failed lookup — and comes back if a retry ever succeeds.
    setToggleEnabled(true);

    if (!entry) {
      // A missing address is not a failure — we know the answer, and the
      // answer is that there isn't one. So it stays still rather than churning
      // like renderFailure does: perpetual motion would claim we're still
      // looking. Sized as v4 either way: v6's smaller type exists to fit 39
      // characters, and a seven-character word doesn't need it.
      const empty = EMPTY[version];
      state.copyable = false;
      ipBtn.dataset.version = "v4";
      ipBtn.classList.add("is-empty");
      ipLabel.textContent = empty.label;
      setMeta(emptyMeta(empty));
      document.title = empty.title;
      setWord(ipText, empty.word);
      if (fast) announce(empty.label);
      return;
    }

    const { ip } = entry;
    state.copyable = true;
    ipBtn.dataset.version = version;
    // Final value goes to the accessible name immediately — never announce
    // the intermediate scramble frames.
    ipLabel.textContent = `Copy IP address ${ip}`;
    setMeta("");
    // Makes a pinned tab useful: the answer is readable without switching to it.
    document.title = ip;

    if (fast) announce(ip);

    if (!animate) {
      scramble(ipText, ip, STATIC);
      return;
    }

    scramble(ipText, ip, TIMING[fast ? "switch" : "boot"][version]);
  }

  function renderFailure() {
    state.failed = true;
    state.copyable = false;
    ipBtn.classList.add("is-failed");
    ipBtn.removeAttribute("title");
    ipBtn.dataset.version = "v4";
    ipLabel.textContent = "IP address unavailable";
    setToggleEnabled(false);
    setMeta("no route · can't see you from here");
    document.title = BASE_TITLE;
    // The digits never lock in. The page is honest about not knowing.
    scramble(ipText, "0.0.0.0", { perpetual: true });
    announce("Could not determine your IP address");
  }

  /* ---------- toggle ---------- */
  // The exit is CSS-driven; JS only needs to know when the value is gone.
  const EXIT_MS =
    parseFloat(getComputedStyle(ipBtn).getPropertyValue("--ip-exit")) || 0;

  let switchToken = 0;

  async function switchTo(version) {
    const token = ++switchToken;

    // Both leave together — sharing --ip-exit is what makes the value and its
    // status line read as one object changing rather than two elements
    // animating near each other.
    ipBtn.classList.add("is-switching");
    metaEl.classList.add("is-swapping");
    await wait(EXIT_MS);
    // A newer click already owns the animation — it re-added the class and is
    // running its own clock, so bail without touching anything.
    if (token !== switchToken) return;

    // Swapped while invisible: the v4/v6 font-size change never reads as a jump.
    render(version, { fast: true });
    ipBtn.classList.remove("is-switching");
    metaEl.classList.remove("is-swapping");
  }

  function selectVersion(next) {
    if (state.failed || next === state.version) return;

    // The pill answers the click immediately — waiting out the exit would
    // make the control itself feel laggy. Only the IP value animates.
    state.version = next;
    setToggle(next);
    switchTo(next);
  }

  toggleBtns.forEach((btn) => {
    btn.addEventListener("click", () => selectVersion(btn.dataset.version));
  });

  /* ---------- keyboard ---------- */
  // Invisible until used, so it costs the layout nothing. Bare keys only —
  // bailing on modifiers keeps Cmd/Ctrl+C working as ordinary selection copy.
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) {
      return;
    }

    const key = e.key.toLowerCase();
    if (key === "c") {
      e.preventDefault();
      copyIP();
    } else if (key === "v") {
      e.preventDefault();
      selectVersion(state.version === "v4" ? "v6" : "v4");
    }
  });

  /* ---------- boot ---------- */
  // ?fail exercises the failure state while the data is still static.
  if (params.has("fail")) {
    renderFailure();
  } else {
    // Real traffic always lands on v4. A ?noXX flag boots onto the family it
    // removed instead — the empty state is the whole reason you passed the
    // flag, and making you click the toggle to reach it just hides it.
    const missing = ["v4", "v6"].find((v) => !DATA[v]);
    render(missing ?? "v4");
  }
})();
