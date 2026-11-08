/*
 * Shared helpers for every page:
 *  - uiAlert(text) · uiConfirm(text, { ok, cancel, danger }) → true/false · uiPrompt(text, value, { ok }) → text or null
 *    (app-styled dialogs instead of the browser's alert / confirm / prompt)
 *  - offline: registers sw.js, so pages open even without signal (data still saves on the device and syncs later)
 */
(function () {
  function dialog({ text, input, value, ok = "ตกลง", cancel, danger }) {
    return new Promise((done) => {
      const d = document.createElement("div");
      d.className = "uidlg"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
      d.innerHTML = `<div class="box"><p class="msg"></p>${input ? '<input type="text">' : ""}<div class="acts">${cancel ? '<button type="button" class="no"></button>' : ""}<button type="button" class="ok"></button></div></div>`;
      d.querySelector(".msg").textContent = text;
      const okB = d.querySelector(".ok"), noB = d.querySelector(".no"), inp = d.querySelector("input");
      okB.textContent = ok; if (danger) okB.classList.add("danger");
      if (noB) noB.textContent = cancel;
      if (inp) inp.value = value ?? "";
      const last = document.activeElement;
      const close = (v) => { d.remove(); document.removeEventListener("keydown", key, true); if (last && last.focus) try { last.focus(); } catch (e) {} done(v); };
      const key = (e) => { if (e.key === "Escape") { e.preventDefault(); close(input ? null : cancel ? false : undefined); } if (e.key === "Enter") { e.preventDefault(); okB.click(); } };
      okB.onclick = () => close(input ? inp.value : cancel ? true : undefined);
      if (noB) noB.onclick = () => close(input ? null : false);
      d.addEventListener("click", (e) => { if (e.target === d && cancel) close(input ? null : false); });
      document.addEventListener("keydown", key, true);
      document.body.appendChild(d);
      (inp || okB).focus(); if (inp) inp.select();
    });
  }
  window.uiAlert = (text, o = {}) => dialog({ text, ok: o.ok || "ตกลง" });
  // a question that starts with "ลบ" (delete) gets a red "ลบ" button unless told otherwise
  window.uiConfirm = (text, o = {}) => { const del = /^ลบ/.test(String(text)) && !o.ok; return dialog({ text, ok: o.ok || (del ? "ลบ" : "ตกลง"), cancel: o.cancel || "ยกเลิก", danger: o.danger ?? del }); };
  window.uiPrompt = (text, value = "", o = {}) => dialog({ text, input: true, value, ok: o.ok || "ตกลง", cancel: o.cancel || "ยกเลิก" });

  // a picture full screen; resolves "delete" when the delete button is used (only shown with { del: true })
  window.uiPhoto = (src, o = {}) => new Promise((done) => {
    const d = document.createElement("div");
    d.className = "uidlg uiph"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
    d.innerHTML = `<img alt=""><div class="acts">${o.del ? '<button type="button" class="del2">ลบภาพ</button>' : ""}<button type="button" class="ok">ปิด</button></div>`;
    d.querySelector("img").src = src;
    const close = (v) => { d.remove(); document.removeEventListener("keydown", key, true); done(v); };
    const key = (e) => { if (e.key === "Escape") close(); };
    d.querySelector(".ok").onclick = () => close();
    if (o.del) d.querySelector(".del2").onclick = async () => { if (await window.uiConfirm("ลบภาพนี้?", { ok: "ลบ", danger: true })) close("delete"); };
    d.addEventListener("click", (e) => { if (e.target === d) close(); });
    document.addEventListener("keydown", key, true);
    document.body.appendChild(d); d.querySelector(".ok").focus();
  });

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
