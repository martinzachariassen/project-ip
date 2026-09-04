(() => {
  "use strict";

  /* ---------- static placeholder data (dev) ---------- */
  const DATA = {
    v4: {
      ip: "84.212.19.77",
      meta: "Oslo · Norway · Telenor",
    },
    v6: {
      ip: "2a01:79c:cebd:8e40:1c2b:9f3a:44de:1",
      meta: "Oslo · Norway · Telenor",
    },
  };

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
  const statusEl = document.getElementById("status");
  const toggleBtns = [...document.querySelectorAll(".toggle-btn")];

  const state = { version: "v4", failed: false };

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

  ipBtn.addEventListener("click", async () => {
    if (state.failed) return;
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
    announce(ok ? "IP address copied" : "Copy failed");
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
    toggleBtns.forEach((btn) => {
      const active = btn.dataset.version === version;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  function render(version, { animate = true, fast = false } = {}) {
    const { ip, meta } = DATA[version];
    state.version = version;

    ipBtn.dataset.version = version;
    ipBtn.classList.remove("is-failed");
    // Final value goes to the accessible name immediately — never announce
    // the intermediate scramble frames.
    ipLabel.textContent = `Copy IP address ${ip}`;
    metaEl.textContent = meta;

    setToggle(version);

    if (!animate) {
      scramble(ipText, ip, { duration: 0, hold: 0, charDuration: 0 });
      return;
    }

    scramble(ipText, ip, TIMING[fast ? "switch" : "boot"][version]);
  }

  function renderFailure() {
    state.failed = true;
    ipBtn.classList.add("is-failed");
    ipBtn.dataset.version = "v4";
    ipLabel.textContent = "IP address unavailable";
    metaEl.textContent = "no route · can't see you from here";
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

    ipBtn.classList.add("is-switching");
    await new Promise((resolve) => setTimeout(resolve, EXIT_MS));
    // A newer click already owns the animation — it re-added the class and is
    // running its own clock, so bail without touching anything.
    if (token !== switchToken) return;

    // Swapped while invisible: the v4/v6 font-size change never reads as a jump.
    render(version, { fast: true });
    ipBtn.classList.remove("is-switching");
  }

  toggleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.version;
      if (state.failed || next === state.version) return;

      // The pill answers the click immediately — waiting out the exit would
      // make the control itself feel laggy. Only the IP value animates.
      state.version = next;
      setToggle(next);
      switchTo(next);
    });
  });

  /* ---------- boot ---------- */
  // ?fail exercises the failure state while the data is still static.
  if (new URLSearchParams(location.search).has("fail")) {
    renderFailure();
  } else {
    render("v4");
  }
})();
