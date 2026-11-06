/*
 * Field-report storage on Cloudflare D1 (data) and R2 (photos).
 * Same actions and answers as apps-script/Code.gs, so the app only changes its URL.
 *
 * D1 tables (made on first use):
 *   jobs   — one row per report; header, trucks and tombstones as JSON
 *   dos    — every D/O in use → its job (a D/O may appear once across all reports)
 *   photos — photo index; the image itself is in R2 under photos/<project>/<date>/<id>.jpg
 */
import FieldSync from "../../fieldsync.js";

const DAY = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 7; // job list: open jobs + jobs changed in the last 7 days
const PHOTO_KINDS = ["plant", "site", "printout", "samples"];
const PHOTO_MAX_BYTES = 6 * 1024 * 1024;
const MAX_PARAMS = 90; // D1 allows 100 bound values per statement

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'open', date TEXT, project TEXT,
    created INTEGER, updated INTEGER, headerUpdated INTEGER, statusUpdated INTEGER,
    header TEXT NOT NULL DEFAULT '{}', removed TEXT NOT NULL DEFAULT '[]', trucks TEXT NOT NULL DEFAULT '[]',
    truckCount INTEGER DEFAULT 0, received REAL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS jobs_date ON jobs(date)`,
  `CREATE INDEX IF NOT EXISTS jobs_updated ON jobs(updated)`,
  `CREATE TABLE IF NOT EXISTS dos (do TEXT PRIMARY KEY, jobId TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS dos_job ON dos(jobId)`,
  `CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, project TEXT, date TEXT, kind TEXT, do TEXT, rkey TEXT,
    takenAt INTEGER, created INTEGER, removed INTEGER)`,
  `CREATE INDEX IF NOT EXISTS photos_day ON photos(project, date)`,
  `CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, list TEXT NOT NULL, do TEXT NOT NULL, at INTEGER NOT NULL, dev TEXT,
    removed INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS scans_list ON scans(list, updated)`,
  `CREATE TABLE IF NOT EXISTS rail_moves (id TEXT PRIMARY KEY, at INTEGER NOT NULL, item TEXT NOT NULL, from_loc TEXT NOT NULL DEFAULT '',
    to_loc TEXT NOT NULL DEFAULT '', qty INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'move', note TEXT, dev TEXT)`,
  `CREATE TABLE IF NOT EXISTS rail_photos (id TEXT PRIMARY KEY, move_id TEXT NOT NULL, rkey TEXT NOT NULL, created INTEGER)`,
  `CREATE INDEX IF NOT EXISTS rail_photos_move ON rail_photos(move_id)`,
  `CREATE TABLE IF NOT EXISTS rail_docs (id TEXT PRIMARY KEY, title TEXT NOT NULL, cat TEXT, size INTEGER, rkey TEXT NOT NULL, created INTEGER, removed INTEGER)`,
  `CREATE TABLE IF NOT EXISTS repairs (id TEXT PRIMARY KEY, plant TEXT NOT NULL, type TEXT NOT NULL, machine TEXT, symptom TEXT NOT NULL, urg TEXT NOT NULL,
    status TEXT NOT NULL, at INTEGER NOT NULL, done_at INTEGER, log TEXT NOT NULL DEFAULT '[]', updated INTEGER NOT NULL, removed INTEGER)`,
  `CREATE INDEX IF NOT EXISTS repairs_updated ON repairs(updated)`,
  `CREATE TABLE IF NOT EXISTS repair_photos (id TEXT PRIMARY KEY, repair_id TEXT NOT NULL, rkey TEXT NOT NULL, created INTEGER, removed INTEGER)`,
  `CREATE INDEX IF NOT EXISTS repair_photos_job ON repair_photos(repair_id)`,
  `CREATE TABLE IF NOT EXISTS trials (id TEXT PRIMARY KEY, status TEXT, updated INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)`,
];
let ready = null;
export function ensureSchema(db) {
  if (!ready) ready = db.batch(SCHEMA.map((s) => db.prepare(s)))
    // added later: the report a photo belongs to (several reports may share one project + date)
    .then(() => db.prepare("ALTER TABLE photos ADD COLUMN job TEXT").run().catch(() => {}))
    // added later: the document number typed for a repair job
    .then(() => db.prepare("ALTER TABLE repairs ADD COLUMN doc_no TEXT").run().catch(() => {}))
    .catch((e) => { ready = null; throw e; });
  return ready;
}

const chunks = (xs, n) => { const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

function jobFromRow(r, withTrucks) {
  const job = {
    id: r.id, status: r.status || "open", created: Number(r.created) || 0, updated: Number(r.updated) || 0,
    headerUpdated: Number(r.headerUpdated) || 0, statusUpdated: Number(r.statusUpdated) || 0,
    removed: parse(r.removed, []), header: parse(r.header, {}),
  };
  if (withTrucks) job.trucks = parse(r.trucks, []).sort((a, b) => (a.created || 0) - (b.created || 0));
  else { job.stub = true; job.trucks = []; job.truckCount = Number(r.truckCount) || 0; job.received = Number(r.received) || 0; }
  return job;
}
async function readJob(db, id) {
  const r = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
  return r ? { row: r, job: jobFromRow(r, true) } : null;
}

export async function listJobs(db, now = Date.now()) {
  const since = now - RECENT_DAYS * DAY;
  const { results } = await db.prepare(`SELECT id, status, date, project, created, updated, headerUpdated, statusUpdated, header, removed, truckCount, received
    FROM jobs WHERE status != 'deleted' AND (status != 'done' OR updated >= ?)`).bind(since).all();
  return results.map((r) => jobFromRow(r, false));
}
export async function getJob(db, id) { const x = await readJob(db, id); return x ? x.job : null; }

// Jobs dated from..to (yyyy-MM-dd) with their trucks, for the dashboard
export async function reportJobs(db, from, to) {
  const { results } = await db.prepare(`SELECT * FROM jobs WHERE status != 'deleted' AND (? = '' OR date >= ?) AND (? = '' OR date <= ?)`)
    .bind(from || "", from || "", to || "", to || "").all();
  return results.map((r) => { const j = jobFromRow(r, true); return { id: j.id, status: j.status, header: j.header, trucks: j.trucks }; });
}

async function describeOwner(db, jobId, d) {
  const x = await readJob(db, jobId);
  if (!x) return { jobId, project: "(ไม่พบงาน)", do: d, no: "-" };
  const i = x.job.trucks.findIndex((t) => FieldSync.cleanDO(t.do) === d);
  return { jobId, project: x.job.header.project || "", do: d, no: i >= 0 ? i + 1 : "-" };
}
export async function checkDO(db, doNo, jobId) {
  const d = FieldSync.cleanDO(doNo);
  if (!d) return null;
  const r = await db.prepare("SELECT jobId FROM dos WHERE do = ?").bind(d).first();
  return r && r.jobId !== jobId ? describeOwner(db, r.jobId, d) : null;
}

async function owners(db, list) {
  const map = new Map();
  for (const part of chunks(list, MAX_PARAMS)) {
    const { results } = await db.prepare(`SELECT do, jobId FROM dos WHERE do IN (${part.map(() => "?").join(",")})`).bind(...part).all();
    results.forEach((r) => map.set(r.do, r.jobId));
  }
  return map;
}

function writeStatements(db, job) {
  const nums = [...new Set(job.trucks.map((t) => FieldSync.cleanDO(t.do)).filter(Boolean))];
  const received = job.trucks.filter((t) => FieldSync.cleanDO(t.do)).reduce((s, t) => s + (Number(t.volume) || 0), 0);
  const st = [
    db.prepare(`INSERT INTO jobs (id, status, date, project, created, updated, headerUpdated, statusUpdated, header, removed, trucks, truckCount, received)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, date=excluded.date, project=excluded.project, created=excluded.created,
        updated=excluded.updated, headerUpdated=excluded.headerUpdated, statusUpdated=excluded.statusUpdated, header=excluded.header,
        removed=excluded.removed, trucks=excluded.trucks, truckCount=excluded.truckCount, received=excluded.received`)
      .bind(job.id, job.status || "open", job.header.date || "", job.header.project || "", job.created || 0, job.updated || 0,
        job.headerUpdated || 0, job.statusUpdated || 0, JSON.stringify(job.header), JSON.stringify(job.removed || []),
        JSON.stringify(job.trucks), job.trucks.length, received),
    db.prepare("DELETE FROM dos WHERE jobId = ?").bind(job.id),
  ];
  chunks(nums, MAX_PARAMS / 2).forEach((part) => st.push(
    db.prepare(`INSERT OR IGNORE INTO dos (do, jobId) VALUES ${part.map(() => "(?,?)").join(",")}`).bind(...part.flatMap((d) => [d, job.id]))));
  return st;
}

/** Save a job sent by a device: merge with the stored copy, refuse a D/O used by another job. */
export async function saveJob(db, incoming) {
  if (!incoming || !incoming.id || !incoming.header || !Array.isArray(incoming.trucks)) return { ok: false, error: "bad_request" };
  const cur = await readJob(db, incoming.id);
  if (cur && cur.job.status === "deleted") return { ok: false, error: "deleted" };
  const { syncError, stub, truckCount, received, ...clean } = incoming;
  const merged = FieldSync.mergeJobs(cur ? cur.job : null, clean);
  const inside = FieldSync.findConflict(merged, []);
  if (inside) return { ok: false, error: "duplicate", conflict: inside, job: merged };
  const nums = [...new Set(merged.trucks.map((t) => FieldSync.cleanDO(t.do)).filter(Boolean))];
  const own = await owners(db, nums);
  for (const d of nums) {
    const o = own.get(d);
    if (o && o !== merged.id) return { ok: false, error: "duplicate", conflict: { ...(await describeOwner(db, o, d)), sameJob: false }, job: merged };
  }
  await db.batch(writeStatements(db, merged));
  return { ok: true, job: merged };
}

// A deleted job keeps its row with status "deleted" so other devices do not bring it back
export async function deleteJob(db, id, now = Date.now()) {
  await db.batch([
    db.prepare("UPDATE jobs SET status = 'deleted', statusUpdated = ?, updated = ?, trucks = '[]', truckCount = 0 WHERE id = ?").bind(now, now, id),
    db.prepare("DELETE FROM dos WHERE jobId = ?").bind(id),
  ]);
}

/** Copy a job from the old Google Sheet as it is (one-time move). D/O numbers already used elsewhere are reported, not taken. */
export async function importJob(db, job) {
  if (!job || !job.id || !job.header || !Array.isArray(job.trucks)) return { ok: false, error: "bad_request" };
  // the Sheet's "report" answer has no job times: take them from the trucks, or the job would count as
  // changed long ago and drop out of the job list (finished jobs show for 7 days after their last change)
  const tu = job.trucks.map((t) => Number(t.updated) || 0).filter(Boolean), tc = job.trucks.map((t) => Number(t.created) || 0).filter(Boolean);
  if (!job.updated) job.updated = tu.length ? Math.max(...tu) : Date.now();
  if (!job.created) job.created = tc.length ? Math.min(...tc) : job.updated;
  FieldSync.upgradeJob(job);
  const cur = await readJob(db, job.id);
  const merged = FieldSync.mergeJobs(cur ? cur.job : null, { ...job, status: job.status || "open" });
  const nums = [...new Set(merged.trucks.map((t) => FieldSync.cleanDO(t.do)).filter(Boolean))];
  const own = await owners(db, nums);
  const clash = nums.filter((d) => own.has(d) && own.get(d) !== merged.id);
  await db.batch(writeStatements(db, merged));
  return { ok: true, trucks: merged.trucks.length, clash };
}

// ---------- photos ----------
function b64ToBytes(s) {
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(buf) {
  const u = new Uint8Array(buf); let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const photoOut = (r) => ({ id: r.id, project: r.project, date: r.date, kind: r.kind, do: r.do || "", job: r.job || "", takenAt: Number(r.takenAt) || 0, created: Number(r.created) || 0 });

export async function photoUpload(db, bucket, req, now = Date.now()) {
  const project = String(req.project || "").trim().slice(0, 100);
  const doNo = String(req.do || "").replace(/\D/g, "");
  if (!project || !/^\d{4}-\d{2}-\d{2}$/.test(String(req.date)) || !PHOTO_KINDS.includes(req.kind)
    || (!doNo && req.kind !== "samples") || doNo.length > 20 || typeof req.data !== "string") return { ok: false, error: "bad_request" };
  const id = /^[\w-]{6,60}$/.test(String(req.id || "")) ? String(req.id) : crypto.randomUUID();
  const had = await db.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first();
  if (had) return { ok: true, photo: photoOut(had) }; // a retry after a lost response
  const bytes = b64ToBytes(req.data);
  if (bytes.length > PHOTO_MAX_BYTES) return { ok: false, error: "too_large" };
  const rkey = `photos/${project.replace(/[\\/]+/g, "-")}/${req.date}/${id}.jpg`;
  await bucket.put(rkey, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  const job = /^[\w-]{1,60}$/.test(String(req.job || "")) ? String(req.job) : null;
  const row = { id, project, date: req.date, kind: req.kind, do: doNo, job, rkey, takenAt: Number(req.takenAt) || 0, created: now };
  await db.prepare("INSERT INTO photos (id, project, date, kind, do, job, rkey, takenAt, created, removed) VALUES (?,?,?,?,?,?,?,?,?,NULL)")
    .bind(row.id, row.project, row.date, row.kind, row.do, row.job, row.rkey, row.takenAt, row.created).run();
  return { ok: true, photo: photoOut(row) };
}
export async function photoList(db, project, date, admin) {
  const { results } = await db.prepare("SELECT * FROM photos WHERE project = ? AND date = ? AND removed IS NULL ORDER BY created")
    .bind(String(project || ""), String(date || "")).all();
  return results.filter((r) => admin || r.kind !== "printout").map(photoOut);
}
export async function photoGet(db, bucket, id, admin) {
  const r = await db.prepare("SELECT * FROM photos WHERE id = ?").bind(String(id || "")).first();
  if (!r || r.removed || (r.kind === "printout" && !admin)) return { ok: false, error: "not_found" };
  const obj = await bucket.get(r.rkey);
  if (!obj) return { ok: false, error: "not_found" };
  return { ok: true, data: bytesToB64(await obj.arrayBuffer()) };
}
export async function photoDelete(db, bucket, id, admin, now = Date.now()) {
  const r = await db.prepare("SELECT * FROM photos WHERE id = ?").bind(String(id || "")).first();
  if (!r) return { ok: true };
  if (r.kind === "printout" && !admin) return { ok: false, error: "not_admin" };
  await db.prepare("UPDATE photos SET removed = ? WHERE id = ?").bind(now, r.id).run();
  await bucket.delete(r.rkey);
  return { ok: true };
}

// ---------- nightly-style backup: everything in one JSON file in R2 ----------
export async function backup(db, bucket, now = Date.now()) {
  const jobs = (await db.prepare("SELECT * FROM jobs").all()).results;
  const photos = (await db.prepare("SELECT * FROM photos").all()).results;
  const d = new Date(now + 7 * 3600e3).toISOString().slice(0, 10);
  const key = `backup/field-${d}.json`;
  const trials = (await db.prepare("SELECT data FROM trials WHERE deleted = 0").all()).results.map((r) => parse(r.data, null));
  const body = JSON.stringify({ at: now, jobs: jobs.map((r) => jobFromRow(r, true)).map((j, i) => ({ ...j, status: jobs[i].status })), photos, trials });
  await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });
  return { key, jobs: jobs.length, photos: photos.length, bytes: body.length };
}

// ---------- Trial Mix: one record per trial (newest edit wins); photos in R2 under trial/<trialId>/<photoId>.jpg ----------
const TRIAL_ID = /^[\w-]{3,80}$/;
export async function trialList(db) {
  const { results } = await db.prepare("SELECT id, deleted, data FROM trials").all();
  return { ok: true, trials: results.filter((r) => !r.deleted).map((r) => parse(r.data, null)).filter(Boolean),
    deleted: results.filter((r) => r.deleted).map((r) => r.id) };
}
export async function trialSave(db, t) {
  if (!t || !TRIAL_ID.test(String(t.id || "")) || !t.header || !Array.isArray(t.rows)) return { ok: false, error: "bad_request" };
  const cur = await db.prepare("SELECT updated, deleted, data FROM trials WHERE id = ?").bind(t.id).first();
  if (cur && cur.deleted) return { ok: false, error: "deleted" };
  if (cur && Number(cur.updated) > Number(t.updated || 0)) return { ok: true, trial: parse(cur.data, null) }; // another device saved later
  await db.prepare(`INSERT INTO trials (id, status, updated, deleted, data) VALUES (?,?,?,0,?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated=excluded.updated, data=excluded.data`)
    .bind(t.id, t.status || "open", Number(t.updated) || Date.now(), JSON.stringify(t)).run();
  return { ok: true, trial: t };
}
export async function trialDelete(db, bucket, id, now = Date.now()) {
  if (!TRIAL_ID.test(String(id || ""))) return { ok: false, error: "bad_request" };
  await db.prepare(`INSERT INTO trials (id, status, updated, deleted, data) VALUES (?, 'deleted', ?, 1, '{}')
    ON CONFLICT(id) DO UPDATE SET deleted = 1, updated = excluded.updated, data = '{}'`).bind(id, now).run();
  if (bucket) {
    const list = await bucket.list({ prefix: `trial/${id}/` });
    if (list.objects.length) await bucket.delete(list.objects.map((o) => o.key));
  }
  return { ok: true };
}
const trialKey = (trialId, id) => (TRIAL_ID.test(String(trialId || "")) && TRIAL_ID.test(String(id || "")) ? `trial/${trialId}/${id}.jpg` : null);
export async function trialPhotoPut(bucket, req) {
  const key = trialKey(req.trialId, req.id);
  if (!key || typeof req.data !== "string") return { ok: false, error: "bad_request" };
  const bytes = b64ToBytes(req.data);
  if (bytes.length > PHOTO_MAX_BYTES) return { ok: false, error: "too_large" };
  await bucket.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  return { ok: true };
}
export async function trialPhotoGet(bucket, req) {
  const key = trialKey(req.trialId, req.id);
  const obj = key && (await bucket.get(key));
  return obj ? { ok: true, data: bytesToB64(await obj.arrayBuffer()) } : { ok: false, error: "not_found" };
}
export async function trialPhotoDelete(bucket, req) {
  const key = trialKey(req.trialId, req.id);
  if (key) await bucket.delete(key);
  return { ok: true };
}

// ---------- ticket scan lists shared by several devices (สแกนตั๋ว) ----------
// Each scan is one row; a device sends its new scans and fetches what changed since its last look (server time).
const LIST = (s) => String(s || "").trim().slice(0, 80);
const SCAN_ID = /^[\w-]{6,60}$/;
export async function scanLists(db, now = Date.now()) {
  const { results } = await db.prepare(`SELECT list, COUNT(*) AS n, MAX(at) AS last FROM scans WHERE removed = 0 AND at >= ? GROUP BY list ORDER BY last DESC LIMIT 30`)
    .bind(now - 14 * DAY).all();
  return { ok: true, lists: results };
}
export async function scanPush(db, list, scans, now = Date.now()) {
  list = LIST(list);
  const ok = (Array.isArray(scans) ? scans : []).filter((x) => x && SCAN_ID.test(String(x.id)) && /^\d{13}$/.test(String(x.do)) && Number(x.at) > 0).slice(0, 500);
  if (!list) return { ok: false, error: "bad_request" };
  if (ok.length) await db.batch(ok.map((x) => db.prepare("INSERT OR IGNORE INTO scans (id, list, do, at, dev, removed, updated) VALUES (?,?,?,?,?,0,?)")
    .bind(String(x.id), list, String(x.do), Number(x.at), String(x.dev || "").slice(0, 40), now)));
  return { ok: true, saved: ok.map((x) => x.id), now };
}
export async function scanPull(db, list, since, now = Date.now()) {
  const { results } = await db.prepare("SELECT id, do, at, dev, removed, updated FROM scans WHERE list = ? AND updated > ? ORDER BY updated LIMIT 5000")
    .bind(LIST(list), Number(since) || 0).all();
  return { ok: true, scans: results, now };
}
export async function scanRemove(db, list, ids, now = Date.now()) {
  const good = (Array.isArray(ids) ? ids : [ids]).map(String).filter((x) => SCAN_ID.test(x)).slice(0, 90);
  if (good.length) await db.prepare(`UPDATE scans SET removed = 1, updated = ? WHERE list = ? AND id IN (${good.map(() => "?").join(",")})`).bind(now, LIST(list), ...good).run();
  return { ok: true };
}
export async function scanClear(db, list, now = Date.now()) {
  await db.prepare("UPDATE scans SET removed = 1, updated = ? WHERE list = ? AND removed = 0").bind(now, LIST(list)).run();
  return { ok: true };
}

// ---------- rail project (สายสีส้ม): equipment at plants and stations, and a shared PDF library ----------
// Stock is never stored: it is the sum of moves (in to a place, out of a place), so every change has a record.
// X- places hold what is out of use: damaged (can come back after repair) and lost
export const RAIL_PLACES = ["P-คลองตัน", "P-เพชรพระราม", "OR07", "OR08", "OR09", "OR10", "OR11", "OR12", "X-ชำรุด", "X-สูญหาย"];
export const RAIL_ITEMS = ["โมลคิว", "รถเข็น"];
async function railBalances(db) {
  const { results } = await db.prepare(`SELECT to_loc AS loc, item, SUM(qty) AS n FROM rail_moves WHERE to_loc != '' GROUP BY to_loc, item
    UNION ALL SELECT from_loc AS loc, item, -SUM(qty) AS n FROM rail_moves WHERE from_loc != '' GROUP BY from_loc, item`).all();
  const bal = {};
  RAIL_PLACES.forEach((p) => { bal[p] = {}; RAIL_ITEMS.forEach((i) => { bal[p][i] = 0; }); });
  results.forEach((r) => { if (bal[r.loc] && r.item in bal[r.loc]) bal[r.loc][r.item] += Number(r.n) || 0; });
  return bal;
}
async function withPhotos(db, moves) {
  if (!moves.length) return moves;
  const ids = moves.map((m) => m.id), by = new Map();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT id, move_id FROM rail_photos WHERE move_id IN (${part.map(() => "?").join(",")}) ORDER BY created`).bind(...part).all();
    results.forEach((r) => { if (!by.has(r.move_id)) by.set(r.move_id, []); by.get(r.move_id).push(r.id); });
  }
  return moves.map((m) => ({ ...m, photos: by.get(m.id) || [] }));
}
export async function railStock(db) {
  const { results } = await db.prepare("SELECT * FROM rail_moves ORDER BY at DESC LIMIT 10").all();
  return { ok: true, places: RAIL_PLACES, items: RAIL_ITEMS, stock: await railBalances(db), log: await withPhotos(db, results) };
}
/** History between two days (yyyy-mm-dd, Thai time), optionally one place / one item. */
export async function railHistory(db, req) {
  const day = (s, end) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? Date.UTC(+m[1], m[2] - 1, +m[3] + (end ? 1 : 0)) - 7 * 3600e3 : null; };
  const from = day(req.from) ?? 0, to = day(req.to, true) ?? 9e15;
  const place = RAIL_PLACES.includes(req.place) ? req.place : "", item = RAIL_ITEMS.includes(req.item) ? req.item : "";
  const { results } = await db.prepare(`SELECT * FROM rail_moves WHERE at >= ? AND at < ? AND (? = '' OR from_loc = ? OR to_loc = ?) AND (? = '' OR item = ?)
    ORDER BY at DESC LIMIT 1000`).bind(from, to, place, place, place, item, item).all();
  return { ok: true, moves: await withPhotos(db, results) };
}
/** Move qty of an item from one place to another (never below 0 at the place it leaves). */
export async function railMove(db, req, now = Date.now()) {
  const { item, from, to } = req, qty = Math.round(Number(req.qty));
  if (!RAIL_ITEMS.includes(item) || !RAIL_PLACES.includes(from) || !RAIL_PLACES.includes(to) || from === to || !(qty >= 1 && qty <= 999))
    return { ok: false, error: "bad_request" };
  const bal = await railBalances(db);
  if (bal[from][item] < qty) return { ok: false, error: "not_enough", have: bal[from][item] };
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO rail_moves (id, at, item, from_loc, to_loc, qty, kind, note, dev) VALUES (?,?,?,?,?,?,'move',?,?)")
    .bind(id, now, item, from, to, qty, String(req.note || "").slice(0, 200), String(req.dev || "").slice(0, 40)).run();
  return { ...(await railStock(db)), moveId: id };
}
/** Count at a place (first stock, a count after checking): stored as the difference, so the record stays. */
export async function railSet(db, req, now = Date.now()) {
  const { item, place } = req, count = Math.round(Number(req.count));
  if (!RAIL_ITEMS.includes(item) || !RAIL_PLACES.includes(place) || !(count >= 0 && count <= 9999)) return { ok: false, error: "bad_request" };
  const diff = count - (await railBalances(db))[place][item];
  if (diff) await db.prepare("INSERT INTO rail_moves (id, at, item, from_loc, to_loc, qty, kind, note, dev) VALUES (?,?,?,?,?,?,'count',?,?)")
    .bind(crypto.randomUUID(), now, item, diff < 0 ? place : "", diff > 0 ? place : "", Math.abs(diff), String(req.note || "").slice(0, 200), String(req.dev || "").slice(0, 40)).run();
  return railStock(db);
}
export async function railDocs(db) {
  const { results } = await db.prepare("SELECT id, title, cat, size, created FROM rail_docs WHERE removed IS NULL ORDER BY created DESC").all();
  return { ok: true, docs: results };
}
export async function railDocDelete(db, bucket, id, now = Date.now()) {
  const r = await db.prepare("SELECT rkey FROM rail_docs WHERE id = ?").bind(String(id || "")).first();
  if (r) { await db.prepare("UPDATE rail_docs SET removed = ? WHERE id = ?").bind(now, id).run(); if (bucket) await bucket.delete(r.rkey); }
  return { ok: true };
}

// ---------- repair backlog: plant machinery and loaders (photos in R2 under repair/<job id>/) ----------
const REPAIR_TYPES = ["เครื่องจักร", "รถตัก"], REPAIR_URG = ["stop", "soon", "wait"], REPAIR_STATUS = ["new", "fix", "part"];
// TEMPORARY: anyone may pick the report / close date (first entry of old jobs). Set to false to need the administrator code again.
export const REPAIR_BACKDATE_OPEN = true;
const REPAIR_KEEP_DAYS = 400; // closed jobs older than this are not listed
const txt = (s, n) => String(s || "").trim().slice(0, n);
/** A past time sent by the administrator, or null: not in the future, at most 3 years back, not before `min`. */
function pastTime(v, now, min = 0) {
  const t = Math.round(Number(v));
  return Number.isFinite(t) && t <= now + 60000 && t >= now - 3 * 366 * DAY && t >= min ? Math.min(t, now) : null;
}
function repairOut(r, photos) {
  return { id: r.id, docNo: r.doc_no || "", plant: r.plant, type: r.type, machine: r.machine || "", symptom: r.symptom, urg: r.urg, status: r.status,
    at: Number(r.at), doneAt: r.done_at ? Number(r.done_at) : null, log: parse(r.log, []), updated: Number(r.updated), photos: photos[r.id] || [] };
}
export async function repairList(db, now = Date.now()) {
  const { results } = await db.prepare("SELECT * FROM repairs WHERE removed IS NULL AND (status != 'done' OR done_at >= ?) ORDER BY at")
    .bind(now - REPAIR_KEEP_DAYS * DAY).all();
  const ph = (await db.prepare("SELECT id, repair_id FROM repair_photos WHERE removed IS NULL ORDER BY created").all()).results;
  const photos = {}; ph.forEach((p) => (photos[p.repair_id] = photos[p.repair_id] || []).push(p.id));
  return { ok: true, backdateOpen: REPAIR_BACKDATE_OPEN, jobs: results.map((r) => repairOut(r, photos)) };
}
async function repairRow(db, id) { return db.prepare("SELECT * FROM repairs WHERE id = ? AND removed IS NULL").bind(String(id || "")).first(); }
export async function repairAdd(db, req, admin, now = Date.now()) {
  const plant = txt(req.plant, 60), docNo = txt(req.docNo, 40), type = req.type, machine = type === "รถตัก" ? txt(req.machine, 60) : "", symptom = txt(req.symptom, 500), urg = req.urg;
  if (!plant || !REPAIR_TYPES.includes(type) || !symptom || !REPAIR_URG.includes(urg) || (type === "รถตัก" && !machine)) return { ok: false, error: "bad_request" };
  let at = now;
  if (req.at != null && req.at !== "") {
    if (!admin && !REPAIR_BACKDATE_OPEN) return { ok: false, error: "not_admin" };
    at = pastTime(req.at, now); if (at == null) return { ok: false, error: "bad_date" };
  }
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO repairs (id, doc_no, plant, type, machine, symptom, urg, status, at, log, updated) VALUES (?,?,?,?,?,?,?,'new',?,?,?)")
    .bind(id, docNo, plant, type, machine, symptom, urg, at, JSON.stringify([[at, at < now - 60000 ? "แจ้งซ่อม (ลงย้อนหลัง)" : "แจ้งซ่อม"]]), now).run();
  return { ok: true, id };
}
export async function repairUpdate(db, req, now = Date.now()) {
  const r = await repairRow(db, req.id);
  if (!r) return { ok: false, error: "not_found" };
  if (req.docNo != null && txt(req.docNo, 40) !== (r.doc_no || "")) {
    await db.prepare("UPDATE repairs SET doc_no = ?, updated = ? WHERE id = ?").bind(txt(req.docNo, 40), now, r.id).run();
    if (r.status === "done") return { ok: true };
  }
  if (r.status === "done") return req.docNo != null ? { ok: true } : { ok: false, error: "closed" };
  const status = REPAIR_STATUS.includes(req.status) ? req.status : r.status, note = txt(req.note, 300);
  const urg = REPAIR_URG.includes(req.urg) ? req.urg : r.urg;
  const NAMES = { new: "แจ้งแล้ว", fix: "กำลังซ่อม", part: "รออะไหล่" }, U = { stop: "หยุดผลิต", soon: "ใช้ได้ แต่ต้องซ่อม", wait: "รอได้" };
  const parts = [];
  if (status !== r.status) parts.push("สถานะ: " + NAMES[status]);
  if (urg !== r.urg) parts.push("ความเร่งด่วน: " + U[urg]);
  if (note) parts.push(note);
  if (!parts.length) return { ok: true };
  const log = parse(r.log, []); log.push([now, parts.join(" — ")]);
  await db.prepare("UPDATE repairs SET status = ?, urg = ?, log = ?, updated = ? WHERE id = ?").bind(status, urg, JSON.stringify(log), now, r.id).run();
  return { ok: true };
}
export async function repairClose(db, req, admin, now = Date.now()) {
  const r = await repairRow(db, req.id);
  if (!r) return { ok: false, error: "not_found" };
  if (r.status === "done") return { ok: true };
  let done = now;
  if (req.at != null && req.at !== "") {
    if (!admin && !REPAIR_BACKDATE_OPEN) return { ok: false, error: "not_admin" };
    done = pastTime(req.at, now, Number(r.at)); if (done == null) return { ok: false, error: "bad_date" };
  }
  const what = txt(req.what, 300), by = txt(req.by, 100);
  const log = parse(r.log, []); log.push([done, "ปิดงาน" + (what ? " — " + what : "") + (by ? ` (${by})` : "")]);
  await db.prepare("UPDATE repairs SET status = 'done', done_at = ?, log = ?, updated = ? WHERE id = ?").bind(done, JSON.stringify(log.sort((a, b) => a[0] - b[0])), now, r.id).run();
  return { ok: true };
}
export async function repairDelete(db, bucket, id, now = Date.now()) {
  const r = await db.prepare("SELECT id FROM repairs WHERE id = ?").bind(String(id || "")).first();
  if (!r) return { ok: true };
  const ph = (await db.prepare("SELECT rkey FROM repair_photos WHERE repair_id = ? AND removed IS NULL").bind(r.id).all()).results;
  await db.batch([db.prepare("UPDATE repairs SET removed = ?, updated = ? WHERE id = ?").bind(now, now, r.id),
    db.prepare("UPDATE repair_photos SET removed = ? WHERE repair_id = ?").bind(now, r.id)]);
  if (bucket) await Promise.all(ph.map((p) => bucket.delete(p.rkey).catch(() => {})));
  return { ok: true };
}
