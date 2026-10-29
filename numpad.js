/*
 * Number entry that works the same on every phone, iPad and computer.
 *  - time  (class "t24"):  HH:MM in 24 hours — the browser's own time field may show AM/PM
 *  - date  (class "dth"):  shown as 29/10/2569 (Buddhist year); el.value still reads/writes ISO "2026-10-29"
 *  - int / dec (class "npad", data-pad="int" | "dec"): digits only / digits with one decimal point
 * Each field opens a 0–9 pad under it (iPad has no number-only keyboard). On touch screens the system
 * keyboard stays closed; on a computer the keyboard still types as usual.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else { root.NumPad = factory(); root.Time24 = root.NumPad; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- time ----------
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

  // ---------- date (dd/mm/yyyy, Buddhist year) ----------
  const pad2 = (n) => String(n).padStart(2, "0");
  /** "2026-10-29" → "29/10/2569" */
  function isoToTh(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? `${m[3]}/${m[2]}/${+m[1] + 543}` : "";
  }
  /** While typing: digits only, slashes added ("2910" → "29/10", "29102569" → "29/10/2569"). */
  function dateTyping(v) {
    const d = String(v || "").replace(/\D/g, "").slice(0, 8);
    return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  }
  /** "29/10/2569" (or a Christian year, 2026) → "2026-10-29"; "" for empty; null when it is not a date. */
  function thToIso(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (!m) return null;
    let y = +m[3];
    if (y > 2400) y -= 543;
    const dd = +m[1], mm = +m[2];
    const t = new Date(Date.UTC(y, mm - 1, dd));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mm - 1 || t.getUTCDate() !== dd) return null;
    return `${y}-${pad2(mm)}-${pad2(dd)}`;
  }

  // ---------- plain numbers ----------
  function numTyping(v, dec) {
    let s = String(v || "").replace(dec ? /[^\d.]/g : /\D/g, "");
    if (dec) { const i = s.indexOf("."); if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, ""); }
    return s;
  }

  const kindOf = (el) => !el || !el.classList ? null
    : el.classList.contains("t24") ? "time" : el.classList.contains("dth") ? "date"
    : el.classList.contains("npad") ? (el.dataset.pad === "dec" ? "dec" : "int") : null;

  // the native value property, so a date field can show Thai text while el.value stays ISO
  const nativeValue = (el) => Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value") ||
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  function shown(el) { return nativeValue(el).get.call(el); }
  function show(el, text) { nativeValue(el).set.call(el, text); }

  /** Make a date field show 29/10/2569 while el.value reads and writes "2026-10-29". */
  function enhanceDate(el) {
    if (el._dth) return;
    el._dth = true;
    const start = el.getAttribute("value") || el.value || "";
    el.type = "text"; el.setAttribute("maxlength", "10"); el.setAttribute("autocomplete", "off");
    if (!el.placeholder) el.placeholder = "วว/ดด/ปปปป";
    let iso = "";
    Object.defineProperty(el, "value", {
      configurable: true,
      get() { return iso; },
      set(v) { iso = /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : ""; show(el, isoToTh(iso)); el.classList.remove("bad-time"); },
    });
    el._setIso = (v) => { iso = v; };
    el.value = start;
  }

  const fire = (el, type, mark) => { const ev = new Event(type, { bubbles: true }); if (mark) ev.npad = true; el.dispatchEvent(ev); };

  /** Tidy what is in the field while typing; for a date, publish the ISO value once it is complete. */
  function onTyping(el) {
    const k = kindOf(el);
    if (k === "time") { const v = typing(el.value); if (v !== el.value) el.value = v; }
    else if (k === "int" || k === "dec") {
      let v = numTyping(el.value, k === "dec");
      const max = +el.getAttribute("maxlength");
      if (max > 0) v = v.slice(0, max);
      if (v !== el.value) el.value = v;
    } else if (k === "date") {
      const t = dateTyping(shown(el));
      if (t !== shown(el)) show(el, t);
      const iso = thToIso(t);
      if (iso && iso !== el.value) { el._setIso(iso); return "date"; }
      if (t === "" && el.value) { el._setIso(""); return "date"; }
    }
    el.classList.remove("bad-time");
    return null;
  }

  /** Leaving the field: tidy the time, check the date; mark it red when it is not valid. */
  function onLeave(el) {
    const k = kindOf(el);
    if (k === "time") {
      const n = normalize(el.value);
      if (n == null) { el.classList.add("bad-time"); return; }
      el.classList.remove("bad-time");
      if (n !== el.value) { el.value = n; fire(el, "input", true); }
    } else if (k === "date") {
      const t = shown(el), iso = thToIso(t);
      if (iso == null) { el.classList.add("bad-time"); return; }
      el.classList.remove("bad-time");
      show(el, isoToTh(el.value));
    } else if (k === "dec" && /\.$/.test(el.value)) { el.value = el.value.slice(0, -1); fire(el, "input", true); }
  }

  function keypad(doc) {
    const win = doc.defaultView;
    const touch = !!(win.matchMedia && win.matchMedia("(pointer: coarse)").matches);
    const st = doc.createElement("style");
    st.textContent = `.t24pad{position:absolute;z-index:60;display:grid;grid-template-columns:repeat(3,64px);gap:6px;padding:8px;
      background:var(--card,#fff);border:1px solid var(--line,#ccc);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.2)}
      .t24pad button{font:600 22px/1 system-ui,sans-serif;height:52px;border-radius:8px;border:1px solid var(--line,#ccc);
      background:var(--bg,#f6f7f9);color:var(--text,#111);touch-action:manipulation;cursor:pointer;padding:0}
      .t24pad button.ok{grid-column:1/-1;background:var(--accent,#1f5fbf);color:#fff;border-color:var(--accent,#1f5fbf);font-size:17px;height:44px}
      .t24pad button.sm{font-size:16px} .t24pad button:disabled{visibility:hidden} .t24pad[hidden]{display:none}
      @media (pointer:fine){.t24pad{grid-template-columns:repeat(3,52px)}.t24pad button{height:40px;font-size:18px}.t24pad button.ok{height:36px}}`;
    doc.head.appendChild(st);
    const pad = doc.createElement("div");
    pad.className = "t24pad"; pad.hidden = true;
    pad.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" tabindex="-1" data-k="${n}">${n}</button>`).join("") +
      '<button type="button" tabindex="-1" class="sm" data-k="x"></button><button type="button" tabindex="-1" data-k="0">0</button>' +
      '<button type="button" tabindex="-1" class="sm" data-k="del">⌫</button><button type="button" tabindex="-1" class="ok" data-k="ok">เสร็จ</button>';
    doc.body.appendChild(pad);
    const extra = pad.querySelector('[data-k="x"]');
    let field = null;
    const place = () => {
      const r = field.getBoundingClientRect(), w = pad.offsetWidth;
      const left = Math.max(8, Math.min(r.left + win.scrollX, win.scrollX + doc.documentElement.clientWidth - w - 8));
      pad.style.left = left + "px"; pad.style.top = r.bottom + win.scrollY + 6 + "px";
    };
    doc.addEventListener("focusin", (e) => {
      const el = e.target, k = kindOf(el);
      if (!k || el.readOnly || el.disabled) return;
      if (touch) el.setAttribute("inputmode", "none");
      field = el; el._padStart = el.value; el._padUsed = false;
      extra.textContent = k === "dec" ? "." : k === "date" ? "วันนี้" : "";
      extra.disabled = !(k === "dec" || k === "date");
      pad.hidden = false; place();
    });
    doc.addEventListener("focusout", (e) => {
      const el = e.target;
      if (el !== field) return;
      field = null; pad.hidden = true;
      // a value set from the pad does not raise "change" by itself
      if (el._padUsed && el.value !== el._padStart) fire(el, "change", true);
    });
    // keep the focus in the field while the pad is used
    pad.addEventListener("pointerdown", (e) => e.preventDefault());
    pad.addEventListener("mousedown", (e) => e.preventDefault());
    pad.addEventListener("click", (e) => {
      const b = e.target.closest("button"), el = field;
      if (!b || !el) return;
      const k = b.dataset.k, kind = kindOf(el);
      if (k === "ok") { el.blur(); return; }
      el._padUsed = true;
      if (kind === "date") {
        if (k === "x") { const d = new Date(); el.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; fire(el, "input", true); return; }
        const d = shown(el).replace(/\D/g, "");
        show(el, dateTyping(k === "del" ? d.slice(0, -1) : d + k));
      } else {
        const cur = kind === "time" ? el.value.replace(/\D/g, "") : el.value;
        el.value = k === "del" ? cur.slice(0, -1) : cur + (k === "x" ? "." : k);
      }
      fire(el, "input");
    });
  }

  /** Attach to a page once (call before the page sets any date values). Fields added later work too. */
  function bind(doc) {
    doc.querySelectorAll("input.dth").forEach(enhanceDate);
    keypad(doc);
    // capture phase, so the page's own listeners already see the tidied value
    doc.addEventListener("input", (e) => {
      if (e.npad) return;
      const el = e.target;
      if (!kindOf(el)) return;
      if (onTyping(el) === "date") {
        // the date is complete: let the page's own listeners see it as a normal edit
        e.stopImmediatePropagation();
        fire(el, "input", true); fire(el, "change", true);
      } else if (kindOf(el) === "date") e.stopImmediatePropagation(); // half-typed date: nothing to save yet
    }, true);
    doc.addEventListener("focusout", (e) => { if (kindOf(e.target)) onLeave(e.target); });
  }

  /** Attributes for fields in template strings. */
  const attrs = 'type="text" class="t24" inputmode="numeric" maxlength="5" placeholder="ชช:นน" autocomplete="off"';
  const intAttrs = 'type="text" class="npad" data-pad="int" inputmode="numeric" autocomplete="off"';
  const decAttrs = 'type="text" class="npad" data-pad="dec" inputmode="decimal" autocomplete="off"';

  return { typing, normalize, isoToTh, dateTyping, thToIso, numTyping, bind, attrs, intAttrs, decAttrs };
});
