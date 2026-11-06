/*
 * POST /api — the field report's central storage on Cloudflare (replaces the Apps Script web app).
 * Same request body as before: { action, key, adminKey?, ... }; same JSON answers.
 *
 * Pages project settings:
 *   Bindings:  D1 database → variable DB · R2 bucket → variable PHOTOS
 *   Variables: FIELD_SYNC_KEY (the app key, as before) · REPORT_ADMIN_KEY (secret) · FIELD_SYNC_URL (Apps Script /exec, still used for e-mail)
 *   Optional:  MIRROR_TO_SHEET = 1 → every save/delete is also sent to the Google Sheet (trial period)
 * GET /api answers which of these are set (never their values).
 */
import * as S from "./_lib/store.js";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
// actions still served by the Apps Script (e-mail with PDF)
const FORWARD = ["mailReport", "mailTrial"];
const ADMIN_ONLY = ["migrateFetch", "importJob", "migratePhotoList", "importPhoto", "backup"];

function isReportAdmin(env, k) {
  const a = env.REPORT_ADMIN_KEY || "";
  return !!a && a !== env.FIELD_SYNC_KEY && String(k || "") === a;
}
async function gas(env, body) {
  if (!env.FIELD_SYNC_URL) return { ok: false, error: "no_apps_script" };
  const res = await fetch(env.FIELD_SYNC_URL, { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: "apps_script_failed", status: res.status }; }
}

// Daily backup without a scheduler: the first job list of the day (Thai date) writes backup/field-YYYY-MM-DD.json to R2
let backedUp = "";
function dailyBackup(db, bucket, waitUntil) {
  if (!bucket) return;
  const day = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  if (backedUp === day) return;
  backedUp = day;
  waitUntil((async () => { if (!(await bucket.head(`backup/field-${day}.json`))) await S.backup(db, bucket); })().catch(() => { backedUp = ""; }));
}

export async function onRequestGet({ env }) {
  return json({ ok: true, app: "field-report", backend: "cloudflare",
    set: { DB: !!env.DB, PHOTOS: !!env.PHOTOS, FIELD_SYNC_KEY: !!env.FIELD_SYNC_KEY, REPORT_ADMIN_KEY: !!env.REPORT_ADMIN_KEY,
      FIELD_SYNC_URL: !!env.FIELD_SYNC_URL, MIRROR_TO_SHEET: env.MIRROR_TO_SHEET === "1" } });
}

export async function onRequestPost({ request, env, waitUntil }) {
  let req;
  try { req = await request.json(); } catch { return json({ ok: false, error: "bad_request" }); }
  if (!env.FIELD_SYNC_KEY || req.key !== env.FIELD_SYNC_KEY) return json({ ok: false, error: "unauthorized" });
  const a = req.action;
  if (FORWARD.includes(a)) return json(await gas(env, req));
  if (!env.DB) return json({ ok: false, error: "no_database" });
  const db = env.DB, bucket = env.PHOTOS;
  const admin = isReportAdmin(env, req.adminKey);
  if (ADMIN_ONLY.includes(a) && !admin) return json({ ok: false, error: "not_admin" });
  if (/^photo/.test(a) && !bucket) return json({ ok: false, error: "no_photo_storage" });
  const mirror = (body) => { if (env.MIRROR_TO_SHEET === "1" && env.FIELD_SYNC_URL) waitUntil(gas(env, body).catch(() => {})); };
  try {
    await S.ensureSchema(db);
    switch (a) {
      case "list": dailyBackup(db, bucket, waitUntil); return json({ ok: true, jobs: await S.listJobs(db) });
      case "get": return json({ ok: true, job: await S.getJob(db, req.id) });
      case "save": { const r = await S.saveJob(db, req.job); if (r.ok) mirror(req); return json(r); }
      case "checkDO": return json({ ok: true, hit: await S.checkDO(db, req.do, req.jobId) });
      case "delete": await S.deleteJob(db, req.id); mirror(req); return json({ ok: true });
      case "report": return json({ ok: true, jobs: await S.reportJobs(db, req.from, req.to) });
      case "reportAdminCheck": return json(admin ? { ok: true } : { ok: false, error: "not_admin" });
      case "photoUpload": return json(req.kind === "printout" && !admin ? { ok: false, error: "not_admin" } : await S.photoUpload(db, bucket, req));
      case "photoList": return json({ ok: true, photos: await S.photoList(db, req.project, req.date, admin) });
      case "photoGet": return json(await S.photoGet(db, bucket, req.id, admin));
      case "photoDelete": return json(await S.photoDelete(db, bucket, req.id, admin));
      // ---- ticket scan lists (several devices at once) ----
      case "scanLists": return json(await S.scanLists(db));
      case "scanPush": return json(await S.scanPush(db, req.list, req.scans));
      case "scanPull": return json(await S.scanPull(db, req.list, req.since));
      case "scanRemove": return json(await S.scanRemove(db, req.list, req.ids));
      case "scanClear": return json(await S.scanClear(db, req.list));
      // ---- rail project: equipment and PDF library (files go up / down through /api/raildoc) ----
      case "railStock": return json(await S.railStock(db));
      case "railMove": return json(await S.railMove(db, req));
      case "railSet": return json(await S.railSet(db, req));
      case "railHistory": return json(await S.railHistory(db, req));
      case "railDocs": return json(await S.railDocs(db));
      case "railDocDelete": return json(await S.railDocDelete(db, bucket, req.id));
      // ---- repair backlog (photos go up / down through /api/repairphoto) ----
      case "repairList": return json(await S.repairList(db));
      case "repairAdd": return json(await S.repairAdd(db, req));
      case "repairUpdate": return json(await S.repairUpdate(db, req));
      case "repairClose": return json(await S.repairClose(db, req));
      case "repairDelete": return json(await S.repairDelete(db, bucket, req.id));
      // ---- Trial Mix ----
      case "trialList": return json(await S.trialList(db));
      case "trialSave": return json(await S.trialSave(db, req.trial));
      case "trialDelete": return json(await S.trialDelete(db, bucket, req.id));
      case "trialPhotoPut": return json(bucket ? await S.trialPhotoPut(bucket, req) : { ok: false, error: "no_photo_storage" });
      case "trialPhotoGet": return json(bucket ? await S.trialPhotoGet(bucket, req) : { ok: false, error: "no_photo_storage" });
      case "trialPhotoDelete": return json(bucket ? await S.trialPhotoDelete(bucket, req) : { ok: false, error: "no_photo_storage" });
      // ---- one-time move from the Google Sheet (report administrator) ----
      case "migrateFetch": return json(await gas(env, { action: "report", from: "2000-01-01", to: "2100-12-31", key: req.key }));
      case "importJob": return json(await S.importJob(db, req.job));
      case "migratePhotoList": return json(await gas(env, { action: "photoList", project: req.project, date: req.date, key: req.key, adminKey: req.adminKey }));
      case "importPhoto": {
        if (!bucket) return json({ ok: false, error: "no_photo_storage" });
        const p = req.photo || {};
        const g = await gas(env, { action: "photoGet", id: p.id, key: req.key, adminKey: req.adminKey });
        if (!g.ok) return json({ ok: false, error: "source_" + (g.error || "failed") });
        return json(await S.photoUpload(db, bucket, { ...p, data: g.data }, p.created || Date.now()));
      }
      case "backup": return json(bucket ? { ok: true, ...(await S.backup(db, bucket)) } : { ok: false, error: "no_photo_storage" });
      default: return json({ ok: false, error: "unknown_action" });
    }
  } catch (e) {
    return json({ ok: false, error: "server", detail: String((e && e.message) || e).slice(0, 200) });
  }
}
