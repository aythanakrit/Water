/*
 * Top bar for every tool page: the page's "← หน้าหลัก" link becomes a large back button
 * in a bar that stays at the top while scrolling (thumb-sized, like a phone app).
 * Pages keep their own <a class="back" href="index.html">; this script only moves and styles it.
 */
(function () {
  const back = document.querySelector("a.back[href='index.html']");
  if (!back) return;
  const st = document.createElement("style");
  st.textContent = `
    .topbar { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 10px;
      padding: max(8px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) 8px max(12px, env(safe-area-inset-left, 0px));
      background: color-mix(in srgb, var(--bg, #f6f7f9) 88%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--line, #dde1e7); }
    .topbar a.back { display: inline-flex !important; align-items: center; gap: 4px; min-height: 44px; padding: 6px 16px 6px 10px !important;
      margin: 0 !important; border-radius: 999px; background: var(--card, #fff); border: 1px solid var(--line, #dde1e7);
      color: var(--accent, #1f5fbf) !important; font: 600 1.05rem/1 system-ui, "Sarabun", sans-serif !important; text-decoration: none; }
    /* iPad home-screen app: the iPadOS window buttons (three dots) sit over the top-left corner */
    .topbar.ipadwin { padding-left: max(92px, env(safe-area-inset-left, 0px)); }
    .topbar a.back .chev { font-size: 1.6rem; line-height: .8; margin-top: -2px; }
    .topbar a.back:active { transform: scale(.97); }
    .topbar a.back:focus-visible { outline: 2px solid var(--accent, #1f5fbf); outline-offset: 2px; }
    .topbar .ttl { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted, #5d6675); font-size: .95rem; }
    @media print { .topbar { display: none !important; } }`;
  document.head.appendChild(st);
  const bar = document.createElement("div");
  bar.className = "topbar";
  const iPad = /iPad/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const homeScreen = navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  if (iPad && homeScreen) bar.classList.add("ipadwin");
  back.innerHTML = '<span class="chev" aria-hidden="true">‹</span>หน้าหลัก';
  back.setAttribute("aria-label", "กลับหน้าหลัก");
  bar.appendChild(back);
  const title = document.title.replace(/\s*[—–-]\s*Production.*$/, "");
  if (title) { const t = document.createElement("span"); t.className = "ttl"; t.textContent = title; bar.appendChild(t); }
  document.body.insertBefore(bar, document.body.firstChild);
})();
