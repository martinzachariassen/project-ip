(() => {
  "use strict";

  const DATA = {
    v4: { ip: "84.212.19.77" },
    v6: { ip: "2a01:79c:cebd:8e40:1c2b:9f3a:44de:1" },
  };

  const params = new URLSearchParams(location.search);
  if (params.has("nov4")) DATA.v4 = null;
  if (params.has("nov6")) DATA.v6 = null;

  const DIGITS = "0123456789";
  const HEX = "0123456789abcdef";
  const SEPARATOR = /[.:]/;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  function groupCells(cells) {
    const groups = [];
    let group = null;
    for (const cell of cells) {
      if (!group) {
        group = document.createElement("span");
        group.className = "group";
        groups.push(group);
      }
      group.appendChild(cell);
      if (cell.classList.contains("sep")) group = null;
    }
    return groups;
  }

  function buildCells(target) {
    return [...target].map((ch, i) => {
      const span = document.createElement("span");
      span.className = SEPARATOR.test(ch) ? "cell sep" : "cell";
      span.style.setProperty("--i", i);
      span.textContent = ch;
      return span;
    });
  }

  function buildWordCell(text) {
    const span = document.createElement("span");
    span.className = "cell word";
    span.style.setProperty("--i", 0);
    span.textContent = text;
    return span;
  }

  function scramble(el, target, opts = {}) {
    const {
      duration = 900,
      charDuration = 380,
      churn = 50,
      hold = 80,
      perpetual = false,
      pool = /[a-f]/i.test(target) ? HEX : DIGITS,
    } = opts;

    cancelAnimationFrame(el._scrambleRAF);

    const chars = [...target];
    const n = chars.length;

    const cells = buildCells(target);
    el.replaceChildren(...groupCells(cells));

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
          if (!s) continue;

          const locked = !perpetual && t >= s.end;
          if (locked) {
            if (cells[i].textContent !== chars[i]) cells[i].textContent = chars[i];
            cells[i].classList.remove("is-scrambling");
            continue;
          }

          if (perpetual || t >= s.start) {
            if (reroll || !glyph[i]) {
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

  const state = { version: "v4", failed: false, copyable: false, meta: "" };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function setCopyable(copyable) {
    state.copyable = copyable;
    if (copyable) ipBtn.dataset.copyable = "";
    else delete ipBtn.dataset.copyable;
  }

  function dropPointerFocus(e) {
    if (e.detail > 0) e.currentTarget.blur();
  }

  [ipBtn, curlBtn, ...toggleBtns].forEach((btn) =>
    btn?.addEventListener("click", dropPointerFocus),
  );

  let announceTimer;
  function announce(message) {
    clearTimeout(announceTimer);
    statusEl.textContent = "";
    announceTimer = setTimeout(() => {
      statusEl.textContent = message;
    }, 100);
  }

  let metaToken = 0;
  let metaRevertTimer;

  function setMeta(text) {
    clearTimeout(metaRevertTimer);
    metaToken++;
    delete metaEl.dataset.copied;
    state.meta = text;
    metaText.textContent = text;
  }

  async function fadeMetaTo(text) {
    const token = ++metaToken;
    metaEl.classList.add("is-swapping");
    await wait(EXIT_MS);
    if (token !== metaToken) return;
    metaText.textContent = text;
    metaEl.classList.remove("is-swapping");
  }

  function flashMeta(text) {
    clearTimeout(metaRevertTimer);
    metaEl.dataset.copied = "";
    fadeMetaTo(text);
    metaRevertTimer = setTimeout(() => {
      delete metaEl.dataset.copied;
      fadeMetaTo(state.meta);
    }, 1500);
  }

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

    ipBtn.dataset.copied = "";
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      delete ipBtn.dataset.copied;
    }, 1500);

    const ok = await copyText(ip);
    flashMeta(ok ? "copied to clipboard" : "copy failed");
    announce(ok ? "IP address copied" : "Copy failed");
  }

  ipBtn.addEventListener("click", copyIP);

  const CURL_CMD = curlLabel?.textContent.trim() ?? "";

  let curlTimer;
  let curlToken = 0;

  async function swapCurlLabel(text) {
    const token = ++curlToken;
    curlBtn.classList.add("is-swapping");
    await wait(EXIT_MS);
    if (token !== curlToken) return;
    curlLabel.textContent = text;
    curlBtn.classList.remove("is-swapping");
  }

  curlBtn?.addEventListener("click", async () => {
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
    toggleEl.dataset.version = version;
    toggleBtns.forEach((btn) => {
      const active = btn.dataset.version === version;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  function setToggleEnabled(enabled) {
    toggleEl.classList.toggle("is-disabled", !enabled);
    toggleBtns.forEach((btn) => btn.setAttribute("aria-disabled", String(!enabled)));
  }

  const STATIC = { duration: 0, hold: 0, charDuration: 0 };

  const EMPTY = {
    v4: { word: "no IPv4", label: "No IPv4 address on this network", other: "v6" },
    v6: { word: "no IPv6", label: "No IPv6 address on this network", other: "v4" },
  };

  function emptyMeta(empty) {
    const cause = DATA[empty.other] ? `${empty.other}-only network` : "no address either way";
    return `${cause} · nothing to copy`;
  }

  function setWord(el, text) {
    cancelAnimationFrame(el._scrambleRAF);
    el.replaceChildren(...groupCells([buildWordCell(text)]));
  }

  const heroEl = document.querySelector(".hero");

  const RULER_PX = 100;

  const rulerBox = document.createElement("span");
  rulerBox.className = "ip-display";
  rulerBox.setAttribute("aria-hidden", "true");
  rulerBox.style.cssText =
    "position:absolute;left:-9999px;top:0;visibility:hidden;" +
    `font-size:${RULER_PX}px;height:auto;max-width:none;padding:0;`;

  const ruler = document.createElement("span");
  ruler.className = "ip-text";
  ruler.style.cssText = "flex-wrap:nowrap;max-width:none;";
  rulerBox.appendChild(ruler);
  heroEl.appendChild(rulerBox);

  function advanceOf(version, cells) {
    rulerBox.dataset.version = version;
    ruler.replaceChildren(...groupCells(cells));
    return ruler.getBoundingClientRect().width / RULER_PX;
  }

  const gridAdvance = (text, version) => advanceOf(version, buildCells(text));
  const wordAdvance = (text) => advanceOf("v4", [buildWordCell(text)]);

  function twoLineAdvance(ip) {
    const parts = ip.split(":");
    const widths = parts.map((g, i) =>
      gridAdvance(i < parts.length - 1 ? `${g}:` : g, "v6"),
    );
    const total = widths.reduce((a, b) => a + b, 0);
    let best = total;
    let head = 0;
    for (let i = 0; i < widths.length - 1; i++) {
      head += widths[i];
      best = Math.min(best, Math.max(head, total - head));
    }
    return best;
  }

  function shownValue(version) {
    if (state.failed) return { text: "0.0.0.0", size: "v4" };
    const entry = DATA[version];
    return entry
      ? { text: entry.ip, size: version }
      : { text: EMPTY[version].word, size: "word" };
  }

  function measureAdvances() {
    const advance = (v) =>
      v.size === "word" ? wordAdvance(v.text) : gridAdvance(v.text, v.size);

    const sized6 = !state.failed && !!DATA.v6;
    const atV4 = [advance(shownValue("v4"))];
    if (!sized6) atV4.push(advance(shownValue("v6")));

    const set = (name, value) => heroEl.style.setProperty(name, value.toFixed(4));
    set("--adv4", Math.max(...atV4));

    heroEl.dataset.v6 = sized6 ? "address" : "none";
    if (sized6) {
      set("--adv6", advance(shownValue("v6")));
      set("--adv6h", twoLineAdvance(DATA.v6.ip));
    } else {
      heroEl.style.removeProperty("--adv6");
      heroEl.style.removeProperty("--adv6h");
    }
  }

  document.fonts?.ready.then(measureAdvances);

  function render(version, { animate = true, fast = false } = {}) {
    const entry = DATA[version];
    state.version = version;

    ipBtn.classList.remove("is-failed", "is-empty");
    setToggle(version);
    setToggleEnabled(true);

    if (!entry) {
      const empty = EMPTY[version];
      setCopyable(false);
      ipBtn.dataset.version = "v4";
      ipBtn.classList.add("is-empty");
      ipLabel.textContent = empty.label;
      setMeta(emptyMeta(empty));
      setWord(ipText, empty.word);
      if (fast) announce(empty.label);
      return;
    }

    const { ip } = entry;
    setCopyable(true);
    ipBtn.dataset.version = version;
    ipLabel.textContent = `Copy IP address ${ip}`;
    setMeta("");

    if (fast) announce(ip);

    if (!animate) {
      scramble(ipText, ip, STATIC);
      return;
    }

    scramble(ipText, ip, TIMING[fast ? "switch" : "boot"][version]);
  }

  function renderFailure() {
    state.failed = true;
    measureAdvances();
    setCopyable(false);
    ipBtn.classList.add("is-failed");
    ipBtn.dataset.version = "v4";
    ipLabel.textContent = "IP address unavailable";
    setToggleEnabled(false);
    setMeta("no route · can't see you from here");
    scramble(ipText, "0.0.0.0", { perpetual: true });
    announce("Could not determine your IP address");
  }

  const EXIT_MS =
    parseFloat(getComputedStyle(ipBtn).getPropertyValue("--ip-exit")) || 0;

  let switchToken = 0;

  async function switchTo(version) {
    const token = ++switchToken;

    ipBtn.classList.add("is-switching");
    metaEl.classList.add("is-swapping");
    await wait(EXIT_MS);
    if (token !== switchToken) return;

    render(version, { fast: true });
    ipBtn.classList.remove("is-switching");
    metaEl.classList.remove("is-swapping");
  }

  function selectVersion(next) {
    if (state.failed || next === state.version) return;

    state.version = next;
    setToggle(next);
    switchTo(next);
  }

  toggleBtns.forEach((btn) => {
    btn.addEventListener("click", () => selectVersion(btn.dataset.version));
  });

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

  if (params.has("fail")) {
    renderFailure();
  } else {
    measureAdvances();
    const missing = ["v4", "v6"].find((v) => !DATA[v]);
    render(missing ?? "v4");
  }
})();
