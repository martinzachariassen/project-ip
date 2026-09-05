const SVG_NS = "http://www.w3.org/2000/svg";

// qrcode-generator has no auto version — the smallest one an address
// actually fits in depends on its length, so this tries each in turn.
function buildQR(text) {
  for (let type = 1; type <= 40; type++) {
    try {
      const qr = qrcode(type, "M");
      qr.addData(text);
      qr.make();
      return qr;
    } catch {
      // Doesn't fit at this version yet — the next one will.
    }
  }
  return null;
}

export function renderQR(qrPlate, ip) {
  qrPlate.replaceChildren();
  const qr = buildQR(ip);
  if (!qr) return;

  const n = qr.getModuleCount();
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `QR code for ${ip}`);

  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", String(n));
  bg.setAttribute("height", String(n));
  bg.setAttribute("fill", "#fff");
  svg.appendChild(bg);

  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  const modules = document.createElementNS(SVG_NS, "path");
  modules.setAttribute("d", d);
  modules.setAttribute("fill", "#000");
  svg.appendChild(modules);

  qrPlate.appendChild(svg);
}
