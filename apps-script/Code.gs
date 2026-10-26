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
