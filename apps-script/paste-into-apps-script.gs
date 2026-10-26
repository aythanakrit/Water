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
 * Bound to a Google Sheet; stores jobs in sheet "Jobs" and trucks in sheet "Trucks".
 * Needs fieldsync.gs (same content as fieldsync.js in the repository) in the same project.
 *
 * Setup: Project Settings → Script properties → add KEY = <a long random text>,
 * then Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 */

const JOB_COLS = ["id", "status", "project", "customer", "structure", "structureNo", "date", "tech", "phone",
  "productCode", "cube", "cylinder", "ordered", "produced", "created", "updated", "headerUpdated", "statusUpdated", "removed"];
const HEADER_KEYS = ["project", "customer", "structure", "structureNo", "date", "tech", "phone", "productCode", "cube", "cylinder", "ordered", "produced"];
const TRUCK_COLS = ["jobId", "id", "no", "truck", "do", "volume", "plant", "batching", "arrival", "start", "end",
  "airTemp", "conTemp", "slump", "sampleType", "sampleQty", "label", "remark", "operator", "created", "updated"];
// Shown as text in the sheet so D/O keeps its leading zeros and times stay HH:MM
const TEXT_TRUCK = ["do", "truck", "batching", "arrival", "start", "end", "label"];

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
      case "list": return json({ ok: true, jobs: listJobs() });
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
function sheet(name, cols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold");
    sh.setFrozenRows(1);
    if (name === "Trucks") TEXT_TRUCK.forEach((k) => sh.getRange(1, cols.indexOf(k) + 1, sh.getMaxRows(), 1).setNumberFormat("@"));
  }
  return sh;
}
function rows(sh, cols) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, cols.length).getValues().map((r, i) => {
    const o = { _row: i + 2 };
    cols.forEach((c, k) => { o[c] = r[k] instanceof Date ? Utilities.formatDate(r[k], Session.getScriptTimeZone(), "HH:mm") : r[k]; });
    return o;
  });
}

function jobFromRow(r, trucks) {
  const header = {};
  HEADER_KEYS.forEach((k) => { header[k] = r[k] === "" ? "" : String(r[k]); });
  if (r.date instanceof Date) header.date = Utilities.formatDate(r.date, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return {
    id: r.id, status: r.status || "open", created: Number(r.created) || 0, updated: Number(r.updated) || 0,
    headerUpdated: Number(r.headerUpdated) || 0, statusUpdated: Number(r.statusUpdated) || 0,
    removed: r.removed ? JSON.parse(r.removed) : [], header,
    trucks: trucks.filter((t) => t.jobId === r.id).sort((a, b) => a.created - b.created).map(truckFromRow),
  };
}
function truckFromRow(t) {
  const o = {};
  TRUCK_COLS.forEach((c) => { if (c !== "jobId" && c !== "no") o[c] = t[c] === "" ? "" : String(t[c]); });
  o.created = Number(t.created) || 0;
  o.updated = Number(t.updated) || 0;
  return o;
}

function readJob(id) {
  const r = rows(sheet("Jobs", JOB_COLS), JOB_COLS).find((x) => x.id === id);
  return r ? jobFromRow(r, rows(sheet("Trucks", TRUCK_COLS), TRUCK_COLS)) : null;
}

function listJobs() {
  const trucks = rows(sheet("Trucks", TRUCK_COLS), TRUCK_COLS);
  return rows(sheet("Jobs", JOB_COLS), JOB_COLS).filter((r) => r.status !== "deleted").map((r) => jobFromRow(r, trucks));
}

function others(jobId) {
  const projects = {};
  rows(sheet("Jobs", JOB_COLS), JOB_COLS).forEach((r) => { projects[r.id] = r.project; });
  return rows(sheet("Trucks", TRUCK_COLS), TRUCK_COLS)
    .filter((t) => t.jobId !== jobId)
    .map((t) => ({ jobId: t.jobId, project: projects[t.jobId] || "", do: String(t.do), no: t.no }));
}

function checkDO(doNo, jobId) {
  const d = FieldSync.cleanDO(doNo);
  return others(jobId).find((o) => FieldSync.cleanDO(o.do) === d) || null;
}

function saveJob(incoming) {
  if (!incoming || !incoming.id || !incoming.header || !Array.isArray(incoming.trucks)) return { ok: false, error: "bad_request" };
  const current = readJob(incoming.id);
  if (current && current.status === "deleted") return { ok: false, error: "deleted" };
  const merged = FieldSync.mergeJobs(current, incoming);
  const conflict = FieldSync.findConflict(merged, others(merged.id));
  if (conflict) return { ok: false, error: "duplicate", conflict: conflict, job: merged };
  writeJob(merged);
  return { ok: true, job: merged };
}

function writeJob(job) {
  const js = sheet("Jobs", JOB_COLS);
  const row = JOB_COLS.map((c) => {
    if (c === "removed") return JSON.stringify(job.removed || []);
    if (HEADER_KEYS.indexOf(c) >= 0) return job.header[c] == null ? "" : job.header[c];
    return job[c] == null ? "" : job[c];
  });
  const existing = rows(js, JOB_COLS).find((x) => x.id === job.id);
  if (existing) js.getRange(existing._row, 1, 1, row.length).setValues([row]);
  else js.appendRow(row);

  const ts = sheet("Trucks", TRUCK_COLS);
  const old = rows(ts, TRUCK_COLS).filter((t) => t.jobId === job.id);
  const byId = {};
  old.forEach((t) => { byId[t.id] = t._row; });
  const keep = {};
  job.trucks.forEach((t, i) => {
    keep[t.id] = true;
    const r = TRUCK_COLS.map((c) => (c === "jobId" ? job.id : c === "no" ? i + 1 : t[c] == null ? "" : t[c]));
    if (byId[t.id]) ts.getRange(byId[t.id], 1, 1, r.length).setValues([r]);
    else ts.appendRow(r);
  });
  // remove rows of trucks that were removed (bottom-up so row numbers stay valid)
  old.filter((t) => !keep[t.id]).map((t) => t._row).sort((a, b) => b - a).forEach((r) => ts.deleteRow(r));
}

// A deleted job keeps its row with status "deleted" so other devices do not bring it back
function deleteJob(id) {
  const js = sheet("Jobs", JOB_COLS), ts = sheet("Trucks", TRUCK_COLS);
  rows(ts, TRUCK_COLS).filter((t) => t.jobId === id).map((t) => t._row).sort((a, b) => b - a).forEach((r) => ts.deleteRow(r));
  const r = rows(js, JOB_COLS).find((x) => x.id === id);
  if (!r) return;
  js.getRange(r._row, JOB_COLS.indexOf("status") + 1).setValue("deleted");
  js.getRange(r._row, JOB_COLS.indexOf("statusUpdated") + 1).setValue(Date.now());
}
