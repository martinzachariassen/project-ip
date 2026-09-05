import { copyText } from "./clipboard.js";
import { buildCells, groupCells, scramble } from "./scramble.js";

const PLACEHOLDER_IP = {
  v4: "84.212.19.77",
  v6: "2a01:79c:cebd:8e40:1c2b:9f3a:44de:1",
};

const params = new URLSearchParams(location.search);

// The family is read off the address itself, not chosen — a single
// connection only ever tells you the one it came in on.
let DATA = { ip: "" };
let family = "v4";
const SHORTCUT_HINT = "press C to copy plain · R for CIDR";

// Dev-only shortcuts for exercising the v6 layout and the failure state
// without needing real dual-stack routing.
async function fetchIP() {
  if (params.has("fail")) throw new Error("forced failure");
  if (params.has("v6")) return PLACEHOLDER_IP.v6;
  if (params.has("v4")) return PLACEHOLDER_IP.v4;

  const res = await fetch("/ip", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`/ip responded ${res.status}`);
  const { ip } = await res.json();
  if (!ip) throw new Error("/ip returned no address");
  return ip;
}

const ipBtn = document.getElementById("ip");
const ipText = document.getElementById("ip-text");
const ipLabel = document.getElementById("ip-label");
const metaEl = document.getElementById("meta");
const metaText = document.getElementById("meta-text");
const statusEl = document.getElementById("status");
const curlBtn = document.getElementById("curl");
const curlLabel = document.getElementById("curl-label");

const state = { failed: false, copyable: false, meta: "" };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setCopyable(copyable) {
  state.copyable = copyable;
  if (copyable) ipBtn.dataset.copyable = "";
  else delete ipBtn.dataset.copyable;
}

function dropPointerFocus(e) {
  if (e.detail > 0) e.currentTarget.blur();
}

[ipBtn, curlBtn].forEach((btn) => {
  btn?.addEventListener("click", dropPointerFocus);
});

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
async function copyValue(text, confirmText, announceText) {
  if (!state.copyable) return;

  ipBtn.dataset.copied = "";
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    delete ipBtn.dataset.copied;
  }, 1500);

  const ok = await copyText(text);
  flashMeta(ok ? confirmText : "copy failed");
  announce(ok ? announceText : "Copy failed");
}

function copyIP() {
  return copyValue(DATA.ip, "copied to clipboard", "IP address copied");
}

function copyCIDR() {
  const cidr = `${DATA.ip}/${family === "v6" ? 128 : 32}`;
  return copyValue(cidr, `copied ${cidr}`, "IP address copied as CIDR");
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
};

const heroEl = document.querySelector(".hero");

// An offscreen clone of .ip-display, rendered at a fixed 100px so its
// measured width can be divided back down to an em multiplier — the one
// number CSS can't work out for itself (see --adv4/--adv6 in ip-display.css).
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

function advanceOf(family, cells) {
  rulerBox.dataset.version = family;
  ruler.replaceChildren(...groupCells(cells));
  return ruler.getBoundingClientRect().width / RULER_PX;
}

const gridAdvance = (text, family) => advanceOf(family, buildCells(text));

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

function shownValue() {
  return state.failed
    ? { text: "0.0.0.0", size: "v4" }
    : { text: DATA.ip, size: family };
}

function measureAdvances() {
  const value = shownValue();
  const advance = gridAdvance(value.text, value.size);
  const showingV6 = value.size === "v6";

  const set = (name, val) => heroEl.style.setProperty(name, val.toFixed(4));

  heroEl.dataset.v6 = showingV6 ? "address" : "none";
  if (showingV6) {
    set("--adv6", advance);
    set("--adv6h", twoLineAdvance(value.text));
  } else {
    set("--adv4", advance);
    heroEl.style.removeProperty("--adv6");
    heroEl.style.removeProperty("--adv6h");
  }
}

function render() {
  const { ip } = DATA;
  setCopyable(true);
  ipBtn.dataset.version = family;
  ipLabel.textContent = `Copy IP address ${ip}`;
  setMeta(SHORTCUT_HINT);
  scramble(ipText, ip, TIMING.boot[family]);
}

function renderFailure() {
  state.failed = true;
  measureAdvances();
  setCopyable(false);
  ipBtn.classList.add("is-failed");
  ipBtn.dataset.version = "v4";
  ipLabel.textContent = "IP address unavailable";
  setMeta("no route · can't see you from here");
  scramble(ipText, "0.0.0.0", { perpetual: true });
  announce("Could not determine your IP address");
}

const EXIT_MS =
  parseFloat(getComputedStyle(ipBtn).getPropertyValue("--ip-exit")) || 0;

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const t = e.target;
  if (
    t instanceof HTMLElement &&
    (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))
  ) {
    return;
  }

  const key = e.key.toLowerCase();
  if (key === "c") {
    e.preventDefault();
    copyIP();
  } else if (key === "r") {
    e.preventDefault();
    copyCIDR();
  }
});

function boot() {
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  fetchIP().then(
    (ip) => {
      DATA = { ip };
      family = ip.includes(":") ? "v6" : "v4";
      measureAdvances();
      fontsReady.then(measureAdvances);
      render();
    },
    () => {
      renderFailure();
      fontsReady.then(measureAdvances);
    },
  );
}

boot();
