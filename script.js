(() => {
  "use strict";

  /* ---------- copy helper ---------- */
  const toast = document.getElementById("copy-toast");
  let toastTimer;
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1200);
  }

  document.getElementById("ip").addEventListener("click", () => {
    const text = document.getElementById("ip-text").textContent.trim();
    if (text && !text.includes("loading")) copyText(text);
  });

  /* ---------- render ---------- */
  function render(ip) {
    document.getElementById("ip-text").textContent = ip;
  }

  async function fetchIP() {
    try {
      const res = await fetch("https://ipwho.is/", { cache: "no-store" });
      if (!res.ok) throw new Error("bad response");
      const json = await res.json();
      if (!json.success) throw new Error("lookup failed");
      render(json.ip);
    } catch (err) {
      render("203.0.113.42");
    }
  }

  fetchIP();
})();
