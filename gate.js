/*
 * Code lock for a card: <script src="gate.js" data-gate="core" data-hash="<sha-256 hex of the code>"></script>
 * placed right after <body>. The page stays covered until the right code is typed; this device then
 * remembers it. The check runs in the browser only — it keeps casual users out, it does not protect data.
 */
(function () {
  const me = document.currentScript;
  const name = me.dataset.gate, hash = me.dataset.hash;
  const KEY = "gate-" + name;
  try { if (localStorage.getItem(KEY) === hash) return; } catch {}

  const st = document.createElement("style");
  st.textContent = `
    html.gated body > *:not(#gate) { visibility: hidden !important; }
    #gate { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 16px;
      background: var(--bg, #f6f7f9); font: 15px/1.5 "Sarabun", system-ui, "Noto Sans Thai", sans-serif; color: var(--text, #1d2330); }
    #gate .box { width: 100%; max-width: 340px; background: var(--card, #fff); border: 1px solid var(--line, #dde1e7); border-radius: 12px; padding: 20px; text-align: center; }
    #gate h2 { margin: 0 0 4px; font-size: 1.15rem; }
    #gate p { margin: 0 0 14px; color: var(--muted, #5d6675); font-size: .9rem; }
    #gate input { width: 100%; box-sizing: border-box; font: inherit; font-size: 1.1rem; padding: 10px 12px; border: 1px solid var(--line, #dde1e7); border-radius: 8px;
      background: var(--bg, #f6f7f9); color: inherit; text-align: center; }
    #gate button { width: 100%; margin-top: 10px; min-height: 46px; font: inherit; font-size: 1.05rem; border-radius: 8px; border: 0; cursor: pointer;
      background: var(--accent, #1f5fbf); color: #fff; }
    #gate .err { color: var(--bad, #b42318); min-height: 1.4em; margin-top: 8px; font-size: .9rem; }
    #gate a { display: inline-block; margin-top: 12px; color: var(--accent, #1f5fbf); text-decoration: none; }`;
  document.head.appendChild(st);
  document.documentElement.classList.add("gated");

  const g = document.createElement("div");
  g.id = "gate";
  g.innerHTML = `<form class="box"><h2>🔒 ใส่รหัสเพื่อเข้าการ์ดนี้</h2><p>${document.title.replace(/\s*[—–-]\s*Production.*$/, "")}</p>
    <input type="password" autocomplete="current-password" placeholder="รหัส" aria-label="รหัส"><button type="submit">เข้า</button>
    <div class="err" role="alert"></div><a href="index.html">‹ กลับหน้าหลัก</a></form>`;
  const show = () => { document.body.appendChild(g); g.querySelector("input").focus(); };
  if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);

  const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((x) => x.toString(16).padStart(2, "0")).join("");
  g.addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = g.querySelector("input");
    if ((await sha(inp.value.trim())) !== hash) { g.querySelector(".err").textContent = "รหัสไม่ถูกต้อง"; inp.select(); return; }
    try { localStorage.setItem(KEY, hash); } catch {}
    g.remove(); document.documentElement.classList.remove("gated");
  });
})();
