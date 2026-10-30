/*
 * Google Apps Script backend for the field report (ใบรายงานสนาม).
 * Bound to a Google Sheet with sheets "Jobs", "Trucks" and "DO" (index of every D/O ever used).
 * Needs FieldSync (fieldsync.js) and Contacts (contacts.js) in the same project — paste apps-script/paste-into-apps-script.gs.
 * Also keeps the contact list (sheet "Contacts"); its admin actions need Script property ADMIN_KEY.
 * Photos of special-project reports go to Google Drive (folder "รูปรายงานโครงการ"), indexed in sheet "Photos".
 * The photo folder and the yearly archives are kept in the same Drive folder as this spreadsheet.
 * Printouts and the report e-mail are for the report administrator only: Script property REPORT_ADMIN_KEY.
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
const TEXT = { Jobs: ["date"], Trucks: TEXT_TRUCK, DO: ["do"], Contacts: ["phone"], Photos: ["date", "do"] };
const PHOTO_COLS = ["id", "project", "date", "kind", "do", "fileId", "takenAt", "created", "removed"];
const PHOTO_KINDS = ["plant", "site", "printout"];
const PHOTO_MAX_BYTES = 6 * 1024 * 1024;
const CONTACT_COLS = ["id", "first", "last", "nick", "phone", "plant", "dept", "pos", "created", "updated", "email"];
const DO_DIGITS = 13;

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
  // Photos: no script lock (Drive writes are slow and rows are only appended or marked)
  const admin = isReportAdmin(req.adminKey);
  switch (req.action) {
    case "reportAdminCheck": return json(admin ? { ok: true } : { ok: false, error: "not_admin" });
    case "photoUpload": return json(req.kind === "printout" && !admin ? { ok: false, error: "not_admin" } : photoUpload(req));
    case "photoList": return json({ ok: true, photos: photoList(req.project, req.date).filter((p) => admin || p.kind !== "printout") });
    case "photoGet": return json(photoGet(req.id, admin));
    case "photoDelete": return json(photoDelete(req.id, admin));
    case "mailReport": return json(admin ? mailPdf(req, "REPORT_MAIL_TO", "รายงานโครงการ") : { ok: false, error: "not_admin" });
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    switch (req.action) {
      case "list": maybeArchive(); return json({ ok: true, jobs: listJobs() });
      case "get": return json({ ok: true, job: readJob(req.id) });
      case "save": return json(saveJob(req.job));
      case "checkDO": return json({ ok: true, hit: checkDO(req.do, req.jobId) });
      case "delete": deleteJob(req.id); return json({ ok: true });
      case "report": return json({ ok: true, jobs: reportJobs(req.from, req.to) });
      case "mailTrial": return json(mailPdf(req, "TRIAL_MAIL_TO", "Trial Mix"));
      case "contacts": return json({ ok: true, people: listContacts(), settings: contactSettings() });
      case "contactAdd": return json(addContact(req.contact));
      case "adminCheck": return json(isAdmin(req.adminKey) ? { ok: true } : { ok: false, error: "not_admin" });
      case "contactUpdate": return json(isAdmin(req.adminKey) ? updateContact(req.contact) : { ok: false, error: "not_admin" });
      case "contactDelete": return json(isAdmin(req.adminKey) ? deleteContact(req.id) : { ok: false, error: "not_admin" });
      case "contactImport": return json(isAdmin(req.adminKey) ? importContacts(req.people, req.dept, req.plant) : { ok: false, error: "not_admin" });
      case "contactSettings": return json(isAdmin(req.adminKey) ? saveContactSettings(req.settings) : { ok: false, error: "not_admin" });
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
  if (fresh) TEXT[name].forEach((k) => sh.getRange(1, cols.indexOf(k) + 1, sh.getMaxRows(), 1).setNumberFormat("@"));
  return { sh, fresh };
}

// Write one row at `row` (or after the last row). Text columns are set to plain text first,
// so Sheets keeps "0032610160061" and "08:30" as typed instead of turning them into numbers.
function putRow(sh, cols, values, row) {
  const r = sh.getRange(row || sh.getLastRow() + 1, 1, 1, values.length);
  const f = r.getNumberFormats()[0];
  (TEXT[sh.getName()] || []).forEach((k) => { f[cols.indexOf(k)] = "@"; });
  r.setNumberFormats([f]);
  r.setValues([values]);
}

// A D/O that Sheets already stored as a number lost its leading zeros: put them back.
function doText(v) {
  if (typeof v === "number") return String(v).padStart(DO_DIGITS, "0");
  return v == null ? "" : String(v);
}

// One-time repair of D/O cells saved as numbers before putRow (so duplicate checks find them)
function repairDOCells(trucks, dos) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("doTextFixed")) return;
  [[trucks, TRUCK_COLS.indexOf("do") + 1], [dos, 1]].forEach(([sh, col]) => {
    const n = sh.getLastRow() - 1;
    if (n < 1) return;
    const r = sh.getRange(2, col, n, 1);
    const v = r.getValues();
    if (!v.some((x) => typeof x[0] === "number")) return;
    r.setNumberFormat("@");
    r.setValues(v.map((x) => [doText(x[0])]));
  });
  props.setProperty("doTextFixed", "1");
}
let SHEETS = null;
function sheets() {
  if (SHEETS) return SHEETS;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const jobs = setupSheet(ss, "Jobs", JOB_COLS).sh;
  const trucks = setupSheet(ss, "Trucks", TRUCK_COLS).sh;
  const d = setupSheet(ss, "DO", DO_COLS);
  SHEETS = { ss, jobs, trucks, dos: d.sh };
  repairDOCells(trucks, d.sh);
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
    o[c] = v === "" || v == null ? "" : v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), "HH:mm")
      : c === "do" ? doText(v) : String(v);
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

// Jobs dated from..to (yyyy-MM-dd) with their trucks, for the dashboard.
// Reads the main sheets only: jobs finished more than ARCHIVE_DAYS ago are in the archive files.
function reportJobs(from, to) {
  const { jobs, trucks } = sheets();
  const iso = (v) => (v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd") : String(v || ""));
  const picked = readAll(jobs, JOB_COLS).filter((r) => {
    const d = iso(r.date);
    return r.status !== "deleted" && (!from || d >= from) && (!to || d <= to);
  });
  if (!picked.length) return [];
  const want = {};
  picked.forEach((r) => { want[r.id] = []; });
  readAll(trucks, TRUCK_COLS).forEach((t) => { if (want[t.jobId]) want[t.jobId].push(t); });
  return picked.map((r) => {
    const j = jobFromRow(r, want[r.id]);
    j.header.date = iso(r.date);
    return { id: j.id, status: j.status, header: j.header, trucks: j.trucks };
  });
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
  const rows = readAll(trucks, TRUCK_COLS).filter((t) => t.do !== "").map((t) => [doText(t.do), t.jobId]);
  if (rows.length) dos.getRange(2, 1, rows.length, 2).setNumberFormat("@").setValues(rows);
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
  oldTrucks.forEach((t) => { owned[FieldSync.cleanDO(doText(t.do))] = true; });
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
  putRow(jobs, JOB_COLS, row, oldRow && oldRow._row);

  const byId = {};
  oldTrucks.forEach((t) => { byId[t.id] = t; });
  const keep = {};
  job.trucks.forEach((t, i) => {
    keep[t.id] = true;
    const r = TRUCK_COLS.map((c) => (c === "jobId" ? job.id : c === "no" ? i + 1 : t[c] == null ? "" : t[c]));
    putRow(trucks, TRUCK_COLS, r, byId[t.id] && byId[t.id]._row);
  });
  deleteRows(trucks, oldTrucks.filter((t) => !keep[t.id]).map((t) => t._row));

  // keep the DO index in step: drop numbers no longer in this job, add new ones
  const before = {}, after = {};
  oldTrucks.forEach((t) => { const d = FieldSync.cleanDO(doText(t.do)); if (d) before[d] = true; });
  job.trucks.forEach((t) => { const d = FieldSync.cleanDO(t.do); if (d) after[d] = true; });
  const gone = Object.keys(before).filter((d) => !after[d]);
  deleteRows(dos, [].concat(...gone.map((d) => findRows(dos, DO_COLS, "do", d))));
  Object.keys(after).filter((d) => !before[d]).forEach((d) => putRow(dos, DO_COLS, [d, job.id]));
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

// ---------- contact list (everyone sees everyone; the admin edits, deletes and sets departments) ----------
function isAdmin(k) {
  const a = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  return !!a && String(k || "") === a;
}
function contactsSheet() { return setupSheet(SpreadsheetApp.getActiveSpreadsheet(), "Contacts", CONTACT_COLS).sh; }
function contactFromRow(r) {
  const o = {};
  CONTACT_COLS.forEach((c) => { o[c] = r[c] == null ? "" : String(r[c]); });
  if (typeof r.phone === "number") o.phone = "0" + String(r.phone); // typed into the sheet by hand: Sheets dropped the 0
  o.created = Number(r.created) || 0; o.updated = Number(r.updated) || 0;
  return o;
}
function listContacts() { return readAll(contactsSheet(), CONTACT_COLS).map(contactFromRow); }
function contactSettings() {
  const s = PropertiesService.getScriptProperties().getProperty("contactSettings");
  return Contacts.cleanSettings(s ? JSON.parse(s) : {});
}
function saveContactSettings(s) {
  const clean = Contacts.cleanSettings(s);
  PropertiesService.getScriptProperties().setProperty("contactSettings", JSON.stringify(clean));
  return { ok: true, settings: clean };
}
function phoneOwner(phone, exceptId) {
  const hit = listContacts().find((p) => p.phone === phone && p.id !== exceptId);
  return hit ? `${hit.first} ${hit.last}` : null;
}
function writeContact(c, row) {
  const sh = contactsSheet();
  putRow(sh, CONTACT_COLS, CONTACT_COLS.map((k) => (c[k] == null ? "" : c[k])), row);
}
function addContact(input) {
  const { contact, errors } = Contacts.check(input || {});
  if (errors.length) return { ok: false, error: "invalid", errors };
  const owner = phoneOwner(contact.phone);
  if (owner) return { ok: false, error: "phone_taken", owner };
  const t = Date.now();
  const c = { ...contact, id: "c" + t.toString(36) + Math.random().toString(36).slice(2, 6), created: t, updated: t };
  writeContact(c);
  return { ok: true, contact: c };
}
function updateContact(input) {
  const sh = contactsSheet();
  const rows = findRows(sh, CONTACT_COLS, "id", input && input.id);
  if (!rows.length) return { ok: false, error: "not_found" };
  const { contact, errors } = Contacts.check(input, { loose: true }); // the admin may keep an imported contact without plant/surname
  if (errors.length) return { ok: false, error: "invalid", errors };
  const owner = phoneOwner(contact.phone, input.id);
  if (owner) return { ok: false, error: "phone_taken", owner };
  const old = contactFromRow(readRow(sh, CONTACT_COLS, rows[0]));
  const c = { ...contact, id: old.id, created: old.created, updated: Date.now() };
  writeContact(c, rows[0]);
  return { ok: true, contact: c };
}
// Admin paste from Excel: only name and phone required; phones already listed are skipped
function importContacts(list, dept, plant) {
  const have = {};
  listContacts().forEach((p) => { have[p.phone] = true; });
  const added = [], skipped = [];
  (Array.isArray(list) ? list : []).slice(0, 500).forEach((x, i) => {
    const { contact, errors } = Contacts.check({ ...x, dept: dept || x.dept || "", plant: plant || x.plant || "" }, { loose: true });
    if (errors.length) { skipped.push({ row: i + 1, why: errors.join(" · ") }); return; }
    if (have[contact.phone]) { skipped.push({ row: i + 1, why: `เบอร์ซ้ำ (${contact.first})` }); return; }
    const t = Date.now() + i;
    writeContact({ ...contact, id: "c" + t.toString(36) + Math.random().toString(36).slice(2, 6), created: t, updated: t });
    have[contact.phone] = true;
    added.push(contact.first);
  });
  return { ok: true, added: added.length, skipped };
}
function deleteContact(id) {
  const sh = contactsSheet();
  deleteRows(sh, findRows(sh, CONTACT_COLS, "id", id));
  return { ok: true };
}

// ---------- PDF by email (Trial Mix, project reports) ----------
// Goes only to the address(es) in Script property TRIAL_MAIL_TO (comma-separated), never to one sent by the page,
// and at most MAIL_PER_DAY a day, so the web app cannot be used to mail anyone else.
const MAIL_PER_DAY = 30;
const MAIL_MAX_BYTES = 20 * 1024 * 1024;
// Trial Mix → TRIAL_MAIL_TO, special-project daily report → REPORT_MAIL_TO (the daily count is shared)
function mailPdf(req, toProperty, defaultSubject) {
  const props = PropertiesService.getScriptProperties();
  const to = props.getProperty(toProperty);
  if (!to) return { ok: false, error: "no_recipient" };
  if (!req.pdf || !req.name) return { ok: false, error: "bad_request" };
  const bytes = Utilities.base64Decode(req.pdf);
  if (bytes.length > MAIL_MAX_BYTES) return { ok: false, error: "too_large" };
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const count = props.getProperty("mailDay") === day ? Number(props.getProperty("mailCount")) || 0 : 0;
  if (count >= MAIL_PER_DAY) return { ok: false, error: "daily_limit" };
  const name = String(req.name).replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
  MailApp.sendEmail({
    to, subject: String(req.subject || defaultSubject).slice(0, 200), body: String(req.body || "").slice(0, 2000),
    attachments: [Utilities.newBlob(bytes, "application/pdf", /\.pdf$/i.test(name) ? name : name + ".pdf")],
  });
  props.setProperty("mailDay", day);
  props.setProperty("mailCount", String(count + 1));
  return { ok: true };
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

// ---------- Drive: keep our files next to this spreadsheet ----------
function homeFolder() {
  const parents = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
  return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
}
// Move a file or folder into the spreadsheet's folder if it is somewhere else (Drive errors are ignored)
function keepNextToSheet(item) {
  try {
    const home = homeFolder(), parents = item.getParents();
    if (!parents.hasNext() || parents.next().getId() !== home.getId()) item.moveTo(home);
  } catch (e) {}
}

function archiveFile(year) {
  const props = PropertiesService.getScriptProperties();
  const key = "archive_" + year;
  const id = props.getProperty(key);
  if (id) {
    try { keepNextToSheet(DriveApp.getFileById(id)); } catch (e) {}
    return SpreadsheetApp.openById(id);
  }
  const ss = SpreadsheetApp.create("ใบรายงานสนาม - เก็บถาวร " + year);
  keepNextToSheet(DriveApp.getFileById(ss.getId()));
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
      putRow(arc.getSheetByName("Jobs"), JOB_COLS, JOB_COLS.map((c) => (r[c] == null ? "" : r[c])));
      const ts = arc.getSheetByName("Trucks");
      t.forEach((x) => putRow(ts, TRUCK_COLS, TRUCK_COLS.map((c) => (x[c] == null ? "" : c === "do" ? doText(x[c]) : x[c]))));
    }
    deleteRows(trucks, t.map((x) => x._row));
    jobRowsToDelete.push(r._row);
  });
  deleteRows(jobs, jobRowsToDelete);
  return old.length;
}

// ---------- photos (special-project reports) ----------
function photoSheet() { return setupSheet(SpreadsheetApp.getActiveSpreadsheet(), "Photos", PHOTO_COLS).sh; }
function photoFolder(project) {
  const props = PropertiesService.getScriptProperties();
  let root = null;
  const id = props.getProperty("photoFolder");
  if (id) { try { root = DriveApp.getFolderById(id); } catch (e) { root = null; } }
  if (!root) { root = homeFolder().createFolder("รูปรายงานโครงการ"); props.setProperty("photoFolder", root.getId()); }
  else keepNextToSheet(root);
  const name = String(project).replace(/[\\/]+/g, "-").slice(0, 100);
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}
function photoFromRow(r) {
  return { id: String(r.id), project: String(r.project), date: String(r.date), kind: String(r.kind), do: doText(r.do),
    takenAt: Number(r.takenAt) || 0, created: Number(r.created) || 0 };
}
function photoUpload(req) {
  const project = String(req.project || "").trim().slice(0, 100);
  const doNo = String(req.do || "").replace(/\D/g, "");
  if (!project || !/^\d{4}-\d{2}-\d{2}$/.test(String(req.date)) || PHOTO_KINDS.indexOf(req.kind) < 0
    || !doNo || doNo.length > 20 || typeof req.data !== "string") return { ok: false, error: "bad_request" };
  const id = /^[\w-]{6,60}$/.test(String(req.id || "")) ? String(req.id) : Utilities.getUuid();
  const sh = photoSheet();
  // a retry after a lost response: already stored
  const had = findRows(sh, PHOTO_COLS, "id", id);
  if (had.length) return { ok: true, photo: photoFromRow(readRow(sh, PHOTO_COLS, had[0])) };
  const bytes = Utilities.base64Decode(req.data);
  if (bytes.length > PHOTO_MAX_BYTES) return { ok: false, error: "too_large" };
  const file = photoFolder(project).createFile(Utilities.newBlob(bytes, "image/jpeg", req.date + "_" + req.kind + "_" + doNo + "_" + id + ".jpg"));
  const row = { id, project, date: req.date, kind: req.kind, do: doNo, fileId: file.getId(), takenAt: Number(req.takenAt) || "", created: Date.now(), removed: "" };
  putRow(sh, PHOTO_COLS, PHOTO_COLS.map((c) => row[c]));
  return { ok: true, photo: photoFromRow(row) };
}
function photoList(project, date) {
  const sh = photoSheet();
  return findRows(sh, PHOTO_COLS, "date", String(date || "")).map((n) => readRow(sh, PHOTO_COLS, n))
    .filter((r) => !r.removed && String(r.project) === String(project)).map(photoFromRow);
}
function photoRow(id) {
  const sh = photoSheet();
  const n = findRows(sh, PHOTO_COLS, "id", String(id || ""))[0];
  return n ? { sh, n, r: readRow(sh, PHOTO_COLS, n) } : null;
}
// Report administrator: REPORT_ADMIN_KEY, never the same as KEY (which every device has)
function isReportAdmin(k) {
  const props = PropertiesService.getScriptProperties();
  const a = props.getProperty("REPORT_ADMIN_KEY");
  return !!a && a !== props.getProperty("KEY") && String(k || "") === a;
}
function photoGet(id, admin) {
  const p = photoRow(id);
  if (!p || p.r.removed || (String(p.r.kind) === "printout" && !admin)) return { ok: false, error: "not_found" };
  return { ok: true, data: Utilities.base64Encode(DriveApp.getFileById(String(p.r.fileId)).getBlob().getBytes()) };
}
function photoDelete(id, admin) {
  const p = photoRow(id);
  if (!p) return { ok: true };
  if (String(p.r.kind) === "printout" && !admin) return { ok: false, error: "not_admin" };
  p.sh.getRange(p.n, PHOTO_COLS.indexOf("removed") + 1).setValue(Date.now());
  try { DriveApp.getFileById(String(p.r.fileId)).setTrashed(true); } catch (e) {}
  return { ok: true };
}
