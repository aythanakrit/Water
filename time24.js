/*
 * 24-hour time fields (HH:MM) that look the same on every phone and computer.
 * The browser's own <input type="time"> follows the device language and may show AM/PM,
 * so time fields are plain text with class "t24": digits only, the colon is added while typing,
 * and leaving the field tidies it ("948" → "09:48", "7" → "07:00"). Anything else is marked red.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Time24 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** While typing: keep digits, at most 4; the last two are minutes ("633" → "6:33", "1048" → "10:48"). */
  function typing(v) {
    const d = String(v || "").replace(/\D/g, "").slice(0, 4);
    return d.length > 2 ? d.slice(0, -2) + ":" + d.slice(-2) : d;
  }

  /** On leaving the field: a full HH:MM, "" for empty, or null when it is not a time. */
  function normalize(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    const ok = (h, m) => (h <= 23 && m <= 59 ? String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") : null);
    const c = /^(\d{1,2})[:.](\d{1,2})$/.exec(s);
    if (c && c[2].length === 2 && ok(+c[1], +c[2])) return ok(+c[1], +c[2]);
    if (!/^[\d:.]+$/.test(s)) return null;
    // digits only: "7" → 07:00, "633" → 06:33, "2248" → 22:48
    const d = s.replace(/\D/g, "");
    if (d.length <= 2) return ok(+d, 0);
    if (d.length === 3) return ok(+d[0], +d.slice(1));
    if (d.length === 4) return ok(+d.slice(0, 2), +d.slice(2));
    return null;
  }

  /**
   * On touch screens the system keyboard is kept closed (inputmode="none") and a small 0–9 pad
   * opens under the field instead: iPad has no number-only keyboard of its own.
   */
  function keypad(doc) {
    const win = doc.defaultView;
    if (!win.matchMedia || !win.matchMedia("(pointer: coarse)").matches) return;
    const st = doc.createElement("style");
    st.textContent = `.t24pad{position:absolute;z-index:60;display:grid;grid-template-columns:repeat(3,64px);gap:6px;padding:8px;
      background:var(--card,#fff);border:1px solid var(--line,#ccc);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.2)}
      .t24pad button{font:600 22px/1 system-ui,sans-serif;height:52px;border-radius:8px;border:1px solid var(--line,#ccc);
      background:var(--bg,#f6f7f9);color:var(--text,#111);touch-action:manipulation}
      .t24pad button.ok{background:var(--accent,#1f5fbf);color:#fff;border-color:var(--accent,#1f5fbf);font-size:17px}
      .t24pad button.sm{font-size:17px} .t24pad[hidden]{display:none}`;
    doc.head.appendChild(st);
    const pad = doc.createElement("div");
    pad.className = "t24pad"; pad.hidden = true;
    pad.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join("") +
      '<button type="button" class="sm" data-k="del">⌫</button><button type="button" data-k="0">0</button><button type="button" class="ok" data-k="ok">เสร็จ</button>';
    doc.body.appendChild(pad);
    let field = null;
    const place = () => {
      const r = field.getBoundingClientRect(), w = pad.offsetWidth;
      const left = Math.max(8, Math.min(r.left + win.scrollX, win.scrollX + doc.documentElement.clientWidth - w - 8));
      pad.style.left = left + "px"; pad.style.top = r.bottom + win.scrollY + 6 + "px";
    };
    doc.addEventListener("focusin", (e) => {
      const el = e.target;
      if (!el.classList || !el.classList.contains("t24") || el.readOnly || el.disabled) return;
      el.setAttribute("inputmode", "none");
      field = el; pad.hidden = false; place();
    });
    doc.addEventListener("focusout", (e) => { if (e.target === field) { field = null; pad.hidden = true; } });
    // keep the focus in the field while the pad is tapped
    pad.addEventListener("pointerdown", (e) => e.preventDefault());
    pad.addEventListener("click", (e) => {
      const k = e.target.dataset && e.target.dataset.k;
      if (!k || !field) return;
      if (k === "ok") { field.blur(); return; }
      const d = field.value.replace(/\D/g, "");
      field.value = k === "del" ? typing(d.slice(0, -1)) : typing(d + k);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /** Attach to a page once: works for fields added later too. */
  function bind(doc) {
    keypad(doc);
    // capture phase, so the page's own input listeners already see the tidied value
    doc.addEventListener("input", (e) => {
      const el = e.target;
      if (!el.classList || !el.classList.contains("t24") || e.t24) return;
      const v = typing(el.value);
      if (v !== el.value) el.value = v;
      el.classList.remove("bad-time");
    }, true);
    doc.addEventListener("focusout", (e) => {
      const el = e.target;
      if (!el.classList || !el.classList.contains("t24")) return;
      const n = normalize(el.value);
      if (n == null) { el.classList.add("bad-time"); return; }
      el.classList.remove("bad-time");
      if (n !== el.value) {
        el.value = n;
        const ev = new Event("input", { bubbles: true });
        ev.t24 = true;
        el.dispatchEvent(ev);
      }
    });
  }

  /** Attributes for a time field in a template string. */
  const attrs = 'type="text" class="t24" inputmode="numeric" maxlength="5" placeholder="ชช:นน" autocomplete="off"';

  return { typing, normalize, bind, attrs };
});
