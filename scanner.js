/*
 * D/O barcode scanner shared by pages that take a ticket number (same reading as the field report):
 *   DOScanner.start(onText)  — live camera; reads the framed strip until the same number is seen twice.
 *   Falls back to taking a photo (enlarged crops are tried; then the user taps the barcode).
 * Uses the browser's BarcodeDetector where there is one, else ZXing (loaded on first use).
 */
(function () {
  const ZX_SRC = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
  const css = `
  #dosLive { position: fixed; inset: 0; z-index: 2000; background: #000; display: flex; flex-direction: column; }
  #dosLive[hidden], #dosShot[hidden] { display: none; }
  #dosLive .cam { position: relative; flex: 1; overflow: hidden; }
  #dosLive video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  #dosLive .box { position: absolute; left: 6%; right: 6%; top: 50%; height: 18%; transform: translateY(-50%); border: 3px solid #fff; border-radius: 10px; box-shadow: 0 0 0 100vmax rgba(0,0,0,.45); }
  #dosLive .box.hit { border-color: #4ade80; }
  #dosLive .hint { position: absolute; left: 0; right: 0; top: calc(50% + 12%); text-align: center; color: #fff; font-size: 1rem; padding: 0 16px; }
  #dosLive .bar, #dosShot .bar { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; padding: 12px 12px max(12px, env(safe-area-inset-bottom, 0px)); background: #000; }
  #dosLive .bar button, #dosShot .bar button { font: inherit; font-size: 1rem; min-height: 48px; padding: 8px 18px; border-radius: 999px; border: 1px solid #555; background: #222; color: #fff; }
  #dosLive .bar button.on { background: #fff; color: #000; } #dosLive .bar button.x, #dosShot .bar button.x { background: #b42318; border-color: #b42318; }
  #dosShot { position: fixed; inset: 0; z-index: 2000; background: #000; display: flex; flex-direction: column; color: #fff; }
  #dosShot .msg { padding: 12px 16px; text-align: center; } #dosShot .wrap { flex: 1; overflow: auto; }
  #dosShot canvas { width: 100%; display: block; cursor: crosshair; touch-action: manipulation; }`;
  const html = `<div id="dosLive" hidden><div class="cam"><video playsinline muted></video><div class="box"></div><div class="hint">เล็งบาร์โค้ดใบ D/O ให้อยู่ในกรอบ</div></div>
    <div class="bar"><span class="zoom"></span><button type="button" class="torch" hidden>🔦 ไฟ</button><button type="button" class="photo">ถ่ายรูปแทน</button><button type="button" class="x">ปิด</button></div></div>
    <div id="dosShot" hidden><div class="msg">หาบาร์โค้ดเองไม่เจอ — <b>แตะที่บาร์โค้ด</b>ในรูป</div><div class="wrap"><canvas></canvas></div><div class="bar"><button type="button" class="x">ยกเลิก</button></div></div>
    <input type="file" id="dosFile" accept="image/*" capture="environment" hidden>`;
  let ui = null, done = null, zx = null, live = null, shotImg = null;
  const $ = (s) => ui.querySelector(s);
  const tick = () => new Promise((r) => setTimeout(r));
  const loadZX = () => window.ZXing ? Promise.resolve() : new Promise((res) => { const s = document.createElement("script"); s.src = ZX_SRC; s.onload = res; s.onerror = res; document.head.appendChild(s); });
  function setup() {
    if (ui) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    ui = document.createElement("div"); ui.innerHTML = html; document.body.appendChild(ui);
    $("#dosLive .x").onclick = () => { stopLive(); finish(null); };
    $("#dosLive .photo").onclick = () => { stopLive(); $("#dosFile").click(); };
    $("#dosLive .torch").onclick = async () => { if (!live) return; const b = $("#dosLive .torch"), on = !b.classList.contains("on"); try { await live.track.applyConstraints({ advanced: [{ torch: on }] }); b.classList.toggle("on", on); } catch (e) {} };
    $("#dosShot .x").onclick = () => { $("#dosShot").hidden = true; shotImg = null; finish(null); };
    $("#dosFile").onchange = onPhoto;
    $("#dosShot canvas").onclick = onTap;
    document.addEventListener("visibilitychange", () => { if (document.hidden) stopLive(); });
  }
  function finish(text) { const f = done; done = null; if (f) f(text); }
  function reader() {
    if (zx || !window.ZXing) return zx;
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.ITF, ZXing.BarcodeFormat.QR_CODE]);
    const r = new ZXing.MultiFormatReader(); r.setHints(hints);
    return (zx = { r, hints });
  }
  function decodeCanvas(c) {
    const z = reader(); if (!z) return null;
    for (const Bin of [ZXing.HybridBinarizer, ZXing.GlobalHistogramBinarizer]) {
      try { return z.r.decode(new ZXing.BinaryBitmap(new Bin(new ZXing.HTMLCanvasElementLuminanceSource(c))), z.hints).getText(); } catch (e) {}
    }
    return null;
  }
  function region(img, x, y, w, h, scale) {
    x = Math.max(0, Math.min(x, img.width - w)); y = Math.max(0, Math.min(y, img.height - h));
    const c = document.createElement("canvas"); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext("2d").drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
    return decodeCanvas(c);
  }
  async function autoBarcode(img) {
    if ("BarcodeDetector" in window) { try { const c = await new BarcodeDetector().detect(img); if (c.length) return c[0].rawValue; } catch (e) {} }
    const W = img.width, H = img.height;
    let t = region(img, 0, 0, W, H, Math.min(1, 1600 / W));
    for (const [wf, hf] of [[0.6, 0.12], [0.6, 0.08]]) {
      for (let y = 0; !t && y + hf * H <= H + 1; y += hf * H / 2)
        for (let x = 0; !t && x + wf * W <= W + 1; x += wf * W / 3) { t = region(img, x, y, wf * W, hf * H, 2); await tick(); }
      if (t) break;
    }
    return t;
  }
  async function barcodeAt(img, cx, cy) {
    const W = img.width, H = img.height;
    for (const [wf, hf] of [[0.45, 0.06], [0.45, 0.1], [0.4, 0.08], [0.5, 0.08], [0.6, 0.1]])
      for (const scale of [1.5, 3, 2])
        for (const dx of [0, -0.03, 0.03]) { const t = region(img, cx - wf * W / 2 + dx * W, cy - hf * H / 2, wf * W, hf * H, scale); if (t) return t; }
    return null;
  }
  const clean = (text) => { const d = String(text).replace(/\D/g, ""); return d.length >= 10 ? d : String(text).trim(); };
  function stopLive() {
    if (!live) return;
    live.stop = true; clearTimeout(live.timer); live.stream.getTracks().forEach((t) => t.stop());
    $("#dosLive video").srcObject = null; $("#dosLive").hidden = true; live = null;
  }
  async function start(onText) {
    setup(); done = onText; loadZX();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return $("#dosFile").click();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } }); }
    catch (e) { return $("#dosFile").click(); }
    const v = $("#dosLive video"); v.srcObject = stream; $("#dosLive").hidden = false; $("#dosLive .box").classList.remove("hit");
    $("#dosLive .hint").textContent = "เล็งบาร์โค้ดใบ D/O ให้อยู่ในกรอบ";
    try { await v.play(); } catch (e) {}
    const track = stream.getVideoTracks()[0], caps = track.getCapabilities ? track.getCapabilities() : {};
    try { if (caps.focusMode && caps.focusMode.includes("continuous")) await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch (e) {}
    const zoom = $("#dosLive .zoom"); zoom.innerHTML = "";
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      const steps = [1, 2, 3].filter((z) => z >= caps.zoom.min && z <= caps.zoom.max);
      steps.forEach((z) => { const b = document.createElement("button"); b.type = "button"; b.textContent = z + "×"; b.dataset.z = z;
        b.onclick = async () => { try { await track.applyConstraints({ advanced: [{ zoom: z }] }); } catch (e) {} zoom.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); };
        zoom.appendChild(b); });
      const s0 = steps.includes(2) ? 2 : steps[0];
      try { await track.applyConstraints({ advanced: [{ zoom: s0 }] }); } catch (e) {}
      zoom.querySelectorAll("button").forEach((x) => x.classList.toggle("on", +x.dataset.z === s0));
    }
    $("#dosLive .torch").hidden = !caps.torch; $("#dosLive .torch").classList.remove("on");
    const det = "BarcodeDetector" in window ? (() => { try { return new BarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "itf", "qr_code"] }); } catch (e) { return null; } })() : null;
    live = { stream, track, stop: false, last: "", timer: 0 };
    const me = live, c = document.createElement("canvas");
    const frame = async () => {
      if (me.stop) return;
      const W = v.videoWidth, H = v.videoHeight; let text = null;
      if (W && H) {
        const r = v.getBoundingClientRect(), sc = Math.max(r.width / W, r.height / H);
        const vw = r.width / sc, vh = r.height / sc, ox = (W - vw) / 2, oy = (H - vh) / 2;
        const sw = vw, sh = vh * 0.28, sy = oy + vh / 2 - sh / 2, scale = Math.min(2, 1600 / sw);
        c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
        c.getContext("2d").drawImage(v, ox, sy, sw, sh, 0, 0, c.width, c.height);
        if (det) { try { const f = await det.detect(c); if (f.length) text = f[0].rawValue; } catch (e) {} }
        if (!text) text = decodeCanvas(c);
      }
      if (me.stop) return;
      if (text) {
        const d = text.replace(/\D/g, "");
        if (d.length >= 10 && d === me.last) { $("#dosLive .box").classList.add("hit"); if (navigator.vibrate) navigator.vibrate(80); stopLive(); return finish(clean(text)); }
        me.last = d.length >= 10 ? d : ""; if (d.length >= 10) $("#dosLive .hint").textContent = "อ่านได้แล้ว ถือนิ่ง ๆ…";
      }
      me.timer = setTimeout(frame, 120);
    };
    frame();
  }
  async function onPhoto(e) {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return finish(null);
    await loadZX();
    try {
      const img = await createImageBitmap(file), text = await autoBarcode(img);
      if (text) return finish(clean(text));
      shotImg = img; const c = $("#dosShot canvas"); c.width = img.width; c.height = img.height; c.getContext("2d").drawImage(img, 0, 0);
      $("#dosShot .msg").innerHTML = "หาบาร์โค้ดเองไม่เจอ — <b>แตะที่บาร์โค้ด</b>ในรูป"; $("#dosShot").hidden = false;
    } catch (x) { finish(null); }
  }
  async function onTap(e) {
    if (!shotImg) return;
    const c = e.currentTarget, r = c.getBoundingClientRect();
    const x = (e.clientX - r.left) * shotImg.width / r.width, y = (e.clientY - r.top) * shotImg.height / r.height;
    $("#dosShot .msg").textContent = "กำลังอ่าน…"; await tick();
    const text = await barcodeAt(shotImg, x, y);
    if (text) { $("#dosShot").hidden = true; shotImg = null; finish(clean(text)); }
    else $("#dosShot .msg").textContent = "ยังอ่านไม่ได้ — แตะกลางบาร์โค้ดอีกครั้ง หรือกดยกเลิกแล้วถ่ายใหม่ให้ใกล้และตรงขึ้น";
  }
  window.DOScanner = { start };
})();
