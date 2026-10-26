// ===== ใบรายงานสนาม — Apps Script (วางไฟล์นี้ทั้งไฟล์ใน Code.gs) =====
// สร้างจาก fieldsync.js + apps-script/Code.gs ด้วย `npm run build:gs` — อย่าแก้ไฟล์นี้โดยตรง

/*
 * Field report sync rules, shared by the web page and the Google Apps Script
 * backend (paste this file into the Apps Script project as fieldsync.gs).
 *
 * Several devices may edit the same job. Jobs merge field-group by field-group:
 * header and status keep the newer edit; trucks merge by their id, newer edit wins;
 * removed trucks are kept as tombstones so a removal is not undone by another device.
 * A D/O number may appear only once across all jobs.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FieldSync = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const cleanDO = (s) => String(s == null ? "" : s).replace(/\s+/g, "");
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /** Give old (local-only) jobs the ids and timestamps sync needs. */
  function upgradeJob(job) {
    const t0 = job.updated || job.created || Date.now();
    job.headerUpdated = job.headerUpdated || t0;
    job.statusUpdated = job.statusUpdated || t0;
    job.removed = job.removed || [];
    job.trucks.forEach((t, i) => {
      t.id = t.id || newId("t");
      t.created = t.created || (job.created || t0) + i;
      t.updated = t.updated || t0;
    });
    return job;
  }

  function mergeJobs(a, b) {
    if (!a) return b;
    if (!b) return a;
    const newer = (x, y, k) => ((x[k] || 0) >= (y[k] || 0) ? x : y);
    const h = newer(a, b, "headerUpdated"), s = newer(a, b, "statusUpdated");

    const removed = new Map();
    [].concat(a.removed || [], b.removed || []).forEach((r) => {
      if (!removed.has(r.id) || removed.get(r.id).updated < r.updated) removed.set(r.id, r);
    });
    const trucks = new Map();
    [].concat(a.trucks || [], b.trucks || []).forEach((t) => {
      const cur = trucks.get(t.id);
      if (!cur || (t.updated || 0) > (cur.updated || 0)) trucks.set(t.id, t);
    });
    const live = [...trucks.values()]
      .filter((t) => !(removed.has(t.id) && removed.get(t.id).updated >= (t.updated || 0)))
      .sort((x, y) => (x.created || 0) - (y.created || 0));

    return {
      id: a.id, created: Math.min(a.created || Infinity, b.created || Infinity),
      updated: Math.max(a.updated || 0, b.updated || 0),
      header: { ...h.header }, headerUpdated: h.headerUpdated || 0,
      status: s.status, statusUpdated: s.statusUpdated || 0,
      trucks: live, removed: [...removed.values()],
    };
  }

  /**
   * First D/O that is repeated inside the job or already used by another job.
   * others: [{ jobId, project, do, no }] for trucks of all other jobs.
   */
  function findConflict(job, others) {
    const seen = new Map();
    for (let i = 0; i < job.trucks.length; i++) {
      const d = cleanDO(job.trucks[i].do);
      if (!d) continue;
      if (seen.has(d)) return { do: d, jobId: job.id, project: job.header.project, no: seen.get(d) + 1, sameJob: true };
      seen.set(d, i);
    }
    for (const o of others) {
      if (o.jobId !== job.id && seen.has(cleanDO(o.do))) return { do: cleanDO(o.do), jobId: o.jobId, project: o.project, no: o.no, sameJob: false };
    }
    return null;
  }

  return { cleanDO, newId, upgradeJob, mergeJobs, findConflict };
});

/*
 * Google Apps Script backend for the field report (ใบรายงานสนาม).
 * Bound to a Google Sheet with sheets "Jobs", "Trucks" and "DO" (index of every D/O ever used).
 * Needs FieldSync (fieldsync.js) in the same project — paste apps-script/paste-into-apps-script.gs.
 *
 * Built to stay fast as data grows: rows are found with TextFinder instead of reading whole
 * sheets, the job list only returns recent work, and finished jobs older than ARCHIVE_DAYS
 * move to a yearly archive spreadsheet (their D/O numbers stay in the DO index).
 *
 * Setup: Project Settings → Script properties → add KEY = <a long random text>,
 * then Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 */

const JOB_COLS = ["id", "status", "project", "customer", "structure", "structureNo", "date", "tech", "phone",
  "productCode", "cube", "cylinder", "ordered", "produced", "created", "updated", "headerUpdated", "statusUpdated", "removed",
  "truckCount", "received"];
const HEADER_KEYS = ["project", "customer", "structure", "structureNo", "date", "tech", "phone", "productCode", "cube", "cylinder", "ordered", "produced"];
const TRUCK_COLS = ["jobId", "id", "no", "truck", "do", "volume", "plant", "batching", "arrival", "start", "end",
  "airTemp", "conTemp", "slump", "sampleType", "sampleQty", "label", "remark", "operator", "created", "updated"];
const DO_COLS = ["do", "jobId"];
// Shown as text in the sheet so D/O keeps its leading zeros and times stay HH:MM
const TEXT_TRUCK = ["do", "truck", "batching", "arrival", "start", "end", "label"];

const RECENT_DAYS = 7;      // job list: open jobs + jobs changed in the last 7 days
const ARCHIVE_DAYS = 90;    // finished/deleted jobs untouched this long move to the archive
const ARCHIVE_BATCH = 20;   // jobs archived per run, to keep each request short
const DAY = 24 * 60 * 60 * 1000;

function doGet() {
  return json({ ok: true, app: "field-report" });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: "bad_request" }); }
  const key = PropertiesService.getScriptProperties().getProperty("KEY");
  if (!key || req.key !== key) return json({ ok: false, error: "unauthorized" });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    switch (req.action) {
      case "list": maybeArchive(); return json({ ok: true, jobs: listJobs() });
      case "get": return json({ ok: true, job: readJob(req.id) });
      case "save": return json(saveJob(req.job));
      case "checkDO": return json({ ok: true, hit: checkDO(req.do, req.jobId) });
      case "delete": deleteJob(req.id); return json({ ok: true });
      default: return json({ ok: false, error: "unknown_action" });
    }
  } finally {
    lock.releaseLock();
  }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- sheets ----------
function setupSheet(ss, name, cols) {
  let sh = ss.getSheetByName(name);
  const fresh = !sh;
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.setFrozenRows(1);
  }
  // write / extend the header (older sheets may have fewer columns)
  const head = sh.getRange(1, 1, 1, cols.length).getValues()[0];
  if (cols.some((c, i) => head[i] !== c)) sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold");
  if (fresh && name === "Trucks") TEXT_TRUCK.forEach((k) => sh.getRange(1, cols.indexOf(k) + 1, sh.getMaxRows(), 1).setNumberFormat("@"));
  if (fresh && name === "DO") sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat("@");
  if (fresh && name === "Jobs") sh.getRange(1, cols.indexOf("date") + 1, sh.getMaxRows(), 1).setNumberFormat("@");
  return { sh, fresh };
}
let SHEETS = null;
function sheets() {
  if (SHEETS) return SHEETS;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jobs = setupSheet(ss, "Jobs", JOB_COLS).sh;
  const trucks = setupSheet(ss, "Trucks", TRUCK_COLS).sh;
  const d = setupSheet(ss, "DO", DO_COLS);
  SHEETS = { ss, jobs, trucks, dos: d.sh };
  if (d.fresh) backfillDOIndex();
  return SHEETS;
}

// Rows whose cell in column `col` equals `value` exactly (TextFinder — no full-sheet read)
function findRows(sh, cols, col, value) {
  const n = sh.getLastRow() - 1;
  if (n < 1 || value === "" || value == null) return [];
  return sh.getRange(2, cols.indexOf(col) + 1, n, 1).createTextFinder(String(value)).matchEntireCell(true).findAll()
    .map((r) => r.getRow());
}
function readRow(sh, cols, row) {
  const r = sh.getRange(row, 1, 1, cols.length).getValues()[0];
  const o = { _row: row };
  cols.forEach((c, k) => { o[c] = r[k]; });
  return o;
}
function readAll(sh, cols) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, cols.length).getValues().map((r, i) => {
    const o = { _row: i + 2 };
    cols.forEach((c, k) => { o[c] = r[k]; });
    return o;
  });
}
function deleteRows(sh, rowNumbers) {
  rowNumbers.slice().sort((a, b) => b - a).forEach((r) => sh.deleteRow(r));
}

// ---------- jobs ----------
function jobFromRow(r, trucks) {
  const header = {};
  HEADER_KEYS.forEach((k) => { header[k] = r[k] === "" || r[k] == null ? "" : String(r[k]); });
  if (r.date instanceof Date) header.date = Utilities.formatDate(r.date, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const job = {
    id: r.id, status: r.status || "open", created: Number(r.created) || 0, updated: Number(r.updated) || 0,
    headerUpdated: Number(r.headerUpdated) || 0, statusUpdated: Number(r.statusUpdated) || 0,
    removed: r.removed ? JSON.parse(r.removed) : [], header,
  };
  if (trucks) job.trucks = trucks.sort((a, b) => a.created - b.created).map(truckFromRow);
  else { job.stub = true; job.trucks = []; job.truckCount = Number(r.truckCount) || 0; job.received = Number(r.received) || 0; }
  return job;
}
function truckFromRow(t) {
  const o = {};
  TRUCK_COLS.forEach((c) => {
    if (c === "jobId" || c === "no") return;
    const v = t[c];
    // a time typed straight into the sheet comes back as a Date
    o[c] = v === "" || v == null ? "" : v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), "HH:mm") : String(v);
  });
  o.created = Number(t.created) || 0;
  o.updated = Number(t.updated) || 0;
  return o;
}

function jobRow(id) {
  const { jobs } = sheets();
  const rows = findRows(jobs, JOB_COLS, "id", id);
  return rows.length ? readRow(jobs, JOB_COLS, rows[0]) : null;
}
function truckRows(jobId) {
  const { trucks } = sheets();
  return findRows(trucks, TRUCK_COLS, "jobId", jobId).map((r) => readRow(trucks, TRUCK_COLS, r));
}
function readJob(id) {
  const r = jobRow(id);
  return r ? jobFromRow(r, truckRows(id)) : null;
}

// Open jobs and jobs changed recently, without their trucks (the page fetches a job when opened)
function listJobs() {
  const since = Date.now() - RECENT_DAYS * DAY;
  return readAll(sheets().jobs, JOB_COLS)
    .filter((r) => r.status !== "deleted" && (r.status !== "done" || Number(r.updated) >= since))
    .map((r) => jobFromRow(r, null));
}

// ---------- D/O uniqueness (DO sheet keeps every D/O, including archived jobs) ----------
function doOwner(d) {
  const { dos } = sheets();
  const rows = findRows(dos, DO_COLS, "do", d);
  return rows.length ? readRow(dos, DO_COLS, rows[0]).jobId : null;
}
function describeOwner(jobId, d) {
  const r = jobRow(jobId);
  if (!r) return { jobId, project: "(งานที่เก็บถาวรแล้ว)", do: d, no: "-" };
  const t = truckRows(jobId).sort((a, b) => a.created - b.created);
  const i = t.findIndex((x) => FieldSync.cleanDO(x.do) === d);
  return { jobId, project: r.project || "", do: d, no: i >= 0 ? i + 1 : "-" };
}
function checkDO(doNo, jobId) {
  const d = FieldSync.cleanDO(doNo);
  const owner = doOwner(d);
  return owner && owner !== jobId ? describeOwner(owner, d) : null;
}
function backfillDOIndex() {
  const { trucks, dos } = SHEETS;
  const rows = readAll(trucks, TRUCK_COLS).filter((t) => t.do !== "").map((t) => [String(t.do), t.jobId]);
  if (rows.length) dos.getRange(2, 1, rows.length, 2).setValues(rows);
}

// ---------- save ----------
function saveJob(incoming) {
  if (!incoming || !incoming.id || !incoming.header || !Array.isArray(incoming.trucks)) return { ok: false, error: "bad_request" };
  const row = jobRow(incoming.id);
  if (row && row.status === "deleted") return { ok: false, error: "deleted" };
  const oldTrucks = row ? truckRows(incoming.id) : [];
  const current = row ? jobFromRow(row, oldTrucks.slice()) : null;
  const merged = FieldSync.mergeJobs(current, incoming);

  // duplicates inside the job, then D/O numbers this job did not already own
  const inside = FieldSync.findConflict(merged, []);
  if (inside) return { ok: false, error: "duplicate", conflict: inside, job: merged };
  const owned = {};
  oldTrucks.forEach((t) => { owned[FieldSync.cleanDO(t.do)] = true; });
  for (const t of merged.trucks) {
    const d = FieldSync.cleanDO(t.do);
    if (!d || owned[d]) continue;
    const owner = doOwner(d);
    if (owner && owner !== merged.id) return { ok: false, error: "duplicate", conflict: { ...describeOwner(owner, d), sameJob: false }, job: merged };
  }
  writeJob(merged, row, oldTrucks);
  return { ok: true, job: merged };
}

function writeJob(job, oldRow, oldTrucks) {
  const { jobs, trucks, dos } = sheets();
  const received = job.trucks.filter((t) => FieldSync.cleanDO(t.do)).reduce((s, t) => s + (Number(t.volume) || 0), 0);
  const row = JOB_COLS.map((c) => {
    if (c === "removed") return JSON.stringify(job.removed || []);
    if (c === "truckCount") return job.trucks.length;
    if (c === "received") return received;
    if (HEADER_KEYS.indexOf(c) >= 0) return job.header[c] == null ? "" : job.header[c];
    return job[c] == null ? "" : job[c];
  });
  if (oldRow) jobs.getRange(oldRow._row, 1, 1, row.length).setValues([row]);
  else jobs.appendRow(row);

  const byId = {};
  oldTrucks.forEach((t) => { byId[t.id] = t; });
  const keep = {};
  job.trucks.forEach((t, i) => {
    keep[t.id] = true;
    const r = TRUCK_COLS.map((c) => (c === "jobId" ? job.id : c === "no" ? i + 1 : t[c] == null ? "" : t[c]));
    if (byId[t.id]) trucks.getRange(byId[t.id]._row, 1, 1, r.length).setValues([r]);
    else trucks.appendRow(r);
  });
  deleteRows(trucks, oldTrucks.filter((t) => !keep[t.id]).map((t) => t._row));

  // keep the DO index in step: drop numbers no longer in this job, add new ones
  const before = {}, after = {};
  oldTrucks.forEach((t) => { const d = FieldSync.cleanDO(t.do); if (d) before[d] = true; });
  job.trucks.forEach((t) => { const d = FieldSync.cleanDO(t.do); if (d) after[d] = true; });
  const gone = Object.keys(before).filter((d) => !after[d]);
  deleteRows(dos, [].concat(...gone.map((d) => findRows(dos, DO_COLS, "do", d))));
  Object.keys(after).filter((d) => !before[d]).forEach((d) => dos.appendRow([d, job.id]));
}

// A deleted job keeps its row with status "deleted" so other devices do not bring it back
function deleteJob(id) {
  const { jobs, trucks, dos } = sheets();
  const r = jobRow(id);
  if (!r) return;
  deleteRows(trucks, findRows(trucks, TRUCK_COLS, "jobId", id));
  deleteRows(dos, findRows(dos, DO_COLS, "jobId", id));
  jobs.getRange(r._row, JOB_COLS.indexOf("status") + 1).setValue("deleted");
  jobs.getRange(r._row, JOB_COLS.indexOf("statusUpdated") + 1).setValue(Date.now());
  jobs.getRange(r._row, JOB_COLS.indexOf("updated") + 1).setValue(Date.now());
}

// ---------- archive ----------
// Runs at most once a day, from a "list" request, so no trigger has to be set up.
function maybeArchive() {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty("lastArchive")) || 0;
  if (Date.now() - last < DAY) return;
  props.setProperty("lastArchive", String(Date.now()));
  archiveOldJobs();
}

function archiveFile(year) {
  const props = PropertiesService.getScriptProperties();
  const key = "archive_" + year;
  const id = props.getProperty(key);
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create("ใบรายงานสนาม - เก็บถาวร " + year);
  setupSheet(ss, "Jobs", JOB_COLS);
  setupSheet(ss, "Trucks", TRUCK_COLS);
  props.setProperty(key, ss.getId());
  return ss;
}

function archiveOldJobs() {
  const { jobs, trucks } = sheets();
  const cutoff = Date.now() - ARCHIVE_DAYS * DAY;
  const old = readAll(jobs, JOB_COLS)
    .filter((r) => (r.status === "done" || r.status === "deleted") && Number(r.updated) < cutoff)
    .slice(0, ARCHIVE_BATCH);
  if (!old.length) return 0;
  const jobRowsToDelete = [];
  old.forEach((r) => {
    const t = truckRows(r.id);
    if (r.status === "done") {
      const year = new Date(Number(r.created) || Date.now()).getFullYear();
      const arc = archiveFile(year);
      arc.getSheetByName("Jobs").appendRow(JOB_COLS.map((c) => (r[c] == null ? "" : r[c])));
      const ts = arc.getSheetByName("Trucks");
      t.forEach((x) => ts.appendRow(TRUCK_COLS.map((c) => (x[c] == null ? "" : x[c]))));
    }
    deleteRows(trucks, t.map((x) => x._row));
    jobRowsToDelete.push(r._row);
  });
  deleteRows(jobs, jobRowsToDelete);
  return old.length;
}
