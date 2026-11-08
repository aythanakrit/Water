/*
 * Offline support: every page and script is fetched from the network first (so an update shows at once),
 * and a copy is kept; with no signal the kept copy opens instead. /api (data) is never cached here —
 * the pages keep unsent work on the device and send it when the signal is back.
 */
const CACHE = "production-v1";
// Cloudflare answers /page.html with a redirect to /page; a kept copy must not be a redirect (the browser refuses it)
const clean = async (res) => (res.redirected ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers }) : res);
const CORE = [
  "./", "index.html", "field.html", "dashboard.html", "tickets.html", "rail.html", "repair.html", "trial.html", "bleed.html",
  "mix-design.html", "dose.html", "volume.html", "convert.html", "core.html",
  "ui.css", "ui.js", "topbar.js", "gate.js", "config.js", "fieldreport.js", "fieldsync.js", "fieldtools.js", "photos.js", "numpad.js",
  "dashboard.js", "tickets.js", "trialmix.js", "mixdesign.js", "admixtures.js", "coretest.js", "volume.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png", "icons/favicon-32.png",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => fetch(new Request(u, { cache: "reload" })).then(async (r) => { if (r.ok) await c.put(u, await clean(r)); }).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // a slow connection: after 5 s use the kept copy (the network answer still refreshes it)
    const net = fetch(req).then((res) => { if (res.ok && res.type === "basic") clean(res.clone()).then((c) => cache.put(req, c)).catch(() => {}); return res; });
    const kept = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
    if (!kept) return net.catch(() => (req.mode === "navigate" ? cache.match("index.html") : Response.error()));
    const slow = new Promise((ok) => setTimeout(() => ok(kept), 5000));
    return Promise.race([net.catch(() => kept), slow]);
  })());
});
