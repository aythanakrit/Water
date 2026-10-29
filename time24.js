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

  /** While typing: keep digits, at most 4, with a colon after the hours. */
  function typing(v) {
    const d = String(v || "").replace(/\D/g, "").slice(0, 4);
    return d.length > 2 ? d.slice(0, 2) + ":" + d.slice(2) : d;
  }

  /** On leaving the field: a full HH:MM, "" for empty, or null when it is not a time. */
  function normalize(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    const ok = (h, m) => (h <= 23 && m <= 59 ? String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") : null);
    const c = /^(\d{1,2})[:.](\d{1,2})$/.exec(s);
    if (c && c[2].length === 2 && ok(+c[1], +c[2])) return ok(+c[1], +c[2]);
    if (!/^[\d:.]+$/.test(s)) return null;
    // digits only: "7" → 07:00, "633" (shown as "63:3" while typing) → 06:33, "2248" → 22:48
    const d = s.replace(/\D/g, "");
    if (d.length <= 2) return ok(+d, 0);
    if (d.length === 3) return ok(+d[0], +d.slice(1));
    if (d.length === 4) return ok(+d.slice(0, 2), +d.slice(2));
    return null;
  }

  /** Attach to a page once: works for fields added later too. */
  function bind(doc) {
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
