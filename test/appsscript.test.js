// Runs apps-script/Code.gs against a small in-memory stand-in for Google Sheets.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function fakeSheets() {
  let nextId = 1;
  const files = {};
  const mkSheet = (name) => {
    const data = [];
    const fmt = {}; // "row,col" → number format; like Sheets, a cell not set to text turns "0032…" into 32…
    const put = (r, c, x) => {
      const t = (data[r - 1] = data[r - 1] || []);
      t[c - 1] = typeof x === "string" && /^\d+$/.test(x) && fmt[r + "," + c] !== "@" ? Number(x) : x;
    };
    const range = (row, col, nr = 1, nc = 1) => ({
      setValues(v) { v.forEach((r, i) => r.forEach((x, j) => put(row + i, col + j, x))); return this; },
      setValue(x) { put(row, col, x); return this; },
      getNumberFormats: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => fmt[(row + i) + "," + (col + j)] || "General")),
      setNumberFormats(f) { f.forEach((r, i) => r.forEach((x, j) => { fmt[(row + i) + "," + (col + j)] = x; })); return this; },
      setNumberFormat(x) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) fmt[(row + i) + "," + (col + j)] = x; return this; },
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (data[row - 1 + i] || [])[col - 1 + j]; return v == null ? "" : v; })),
      setFontWeight() { return this; },
      createTextFinder(text) {
        let whole = false;
        const f = {
          matchEntireCell(b) { whole = b; return f; },
          findAll() {
            const out = [];
            for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
              const v = String((data[row - 1 + i] || [])[col - 1 + j] ?? "");
              if (whole ? v === text : v.includes(text)) out.push({ getRow: () => row + i });
            }
            return out;
          },
        };
        return f;
      },
    });
    return {
      name, data, getName: () => name,
      getLastRow: () => data.length,
      getMaxRows: () => 1000,
      setFrozenRows() {},
      appendRow: (r) => { const n = data.length + 1; r.forEach((x, j) => put(n, j + 1, x)); },
      deleteRow: (n) => { data.splice(n - 1, 1); },
      getRange: range,
    };
  };
  const mkSS = (name) => {
    const id = "ss" + nextId++;
    const sheets = {};
    const ss = {
      id, name, sheets, getId: () => id,
      getSheetByName: (n) => sheets[n] || null,
      insertSheet: (n) => (sheets[n] = mkSheet(n)),
    };
    files[id] = ss;
    return ss;
  };
  const active = mkSS("main");
  return {
    sheets: active.sheets, files,
    getActiveSpreadsheet: () => active,
    create: (name) => mkSS(name),
    openById: (id) => files[id],
  };
}

function fakeDrive() {
  let n = 0;
  const files = {}, folders = {};
  const iter = (list) => { const l = [...list]; return { hasNext: () => l.length > 0, next: () => l.shift() }; };
  // every file and folder knows its parent; moveTo changes it
  const placed = (o, parent) => Object.assign(o, { parent, getParents: () => iter(o.parent ? [o.parent] : []), moveTo(f) { o.parent = f; return o; } });
  const mkFolder = (name, parent) => {
    const id = "f" + ++n;
    const f = placed({
      name, getId: () => id,
      getFoldersByName: (x) => iter(Object.values(folders).filter((k) => k.parent === f && k.name === x)),
      createFolder: (x) => mkFolder(x, f),
      createFile: (blob) => { const fid = "d" + ++n; files[fid] = placed({ blob, trashed: false, folder: name, getId: () => fid, getBlob: () => blob, setTrashed(t) { this.trashed = t; } }, f); return files[fid]; },
    }, parent);
    return (folders[id] = f);
  };
  const root = mkFolder("My Drive", null);
  return {
    files, folders, root,
    getRootFolder: () => root,
    createFolder: (name) => mkFolder(name, root),
    getFolderById: (id) => { if (!folders[id]) throw new Error("no"); return folders[id]; },
    // spreadsheets are looked up lazily: a new one starts in My Drive
    getFileById: (id) => files[id] || (files[id] = placed({ getId: () => id }, root)),
  };
}

function load() {
  const SpreadsheetApp = fakeSheets();
  const props = { KEY: "secret" };
  const ctx = {
    SpreadsheetApp,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
    Utilities: { formatDate: () => "2026-10-28", base64Decode: (b) => [...Buffer.from(b, "base64")], base64Encode: (b) => Buffer.from(b).toString("base64"),
      newBlob: (bytes, type, name) => ({ bytes, type, name, getBytes: () => bytes }), getUuid: () => "u" + Math.random().toString(36).slice(2, 10) },
    Session: { getScriptTimeZone: () => "Asia/Bangkok" },
    MailApp: { sent: [], sendEmail(o) { this.sent.push(o); } },
    DriveApp: fakeDrive(),
    Date, JSON, Math, Map, Set, Array, Object, String, Number, Infinity,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../fieldsync.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../contacts.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8"), ctx);
  const call = (body) => { ctx.SHEETS = null; return ctx.doPost({ postData: { contents: JSON.stringify({ key: "secret", ...body }) } }); };
  vm.runInContext("var __reset = () => { SHEETS = null; };", ctx);
  const callFresh = (body) => { ctx.__reset(); return call(body); };
  return { call: callFresh, SpreadsheetApp, props, ctx, mail: ctx.MailApp.sent };
}

const job = (id, project, dos, t = Date.now()) => ({
  id, created: t, updated: t, header: { project, date: "2026-10-26", cube: "500" }, headerUpdated: t,
  status: "open", statusUpdated: t, removed: [],
  trucks: dos.map((d, i) => ({ id: id + "t" + i, do: d, truck: "71" + i, volume: "7", created: t + i, updated: t })),
});

test("rejects calls without the key", () => {
  const { call } = load();
  assert.equal(call({ action: "list" }).ok, true);
  assert.equal(call({ key: "wrong", action: "list" }).error, "unauthorized");
});

test("save, list, get round trip keeps D/O leading zeros and the date", () => {
  const { call } = load();
  assert.equal(call({ action: "save", job: job("j1", "งาน A", ["0372610040130", "0042610040087"]) }).ok, true);
  const list = call({ action: "list" }).jobs;
  assert.equal(list.length, 1);
  assert.equal(list[0].stub, true);
  assert.equal(list[0].truckCount, 2);
  assert.equal(list[0].received, 14);
  const got = call({ action: "get", id: "j1" }).job;
  assert.deepEqual(got.trucks.map((t) => t.do), ["0372610040130", "0042610040087"]);
  assert.equal(got.header.project, "งาน A");
  assert.equal(got.header.date, "2026-10-26");
});

test("D/O already used in another job is refused", () => {
  const { call } = load();
  call({ action: "save", job: job("j1", "งาน A", ["0372610040130"]) });
  const r = call({ action: "save", job: job("j2", "งาน B", ["0372610040130"]) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "duplicate");
  assert.equal(r.conflict.project, "งาน A");
  assert.equal(r.conflict.no, 1);
  assert.equal(call({ action: "checkDO", do: "0372610040130", jobId: "j2" }).hit.project, "งาน A");
  assert.equal(call({ action: "checkDO", do: "0372610040130", jobId: "j1" }).hit, null);
});

test("DO index follows edits: a changed or removed D/O becomes free", () => {
  const { call, SpreadsheetApp } = load();
  const j = job("j1", "A", ["0372610040130", "0042610040087"]);
  call({ action: "save", job: j });
  const got = call({ action: "get", id: "j1" }).job;
  got.trucks[0].do = "0032610040165"; got.trucks[0].updated += 10;
  got.removed = [{ id: got.trucks[1].id, updated: got.trucks[1].updated + 10 }]; got.trucks.pop();
  assert.equal(call({ action: "save", job: got }).ok, true);
  assert.deepEqual(SpreadsheetApp.sheets.DO.data.slice(1).map((r) => r[0]).sort(), ["0032610040165"]);
  assert.equal(call({ action: "save", job: job("j2", "B", ["0372610040130", "0042610040087"]) }).ok, true);
});

test("two devices adding to the same job keep both trucks; removal sticks", () => {
  const { call, SpreadsheetApp } = load();
  call({ action: "save", job: job("j1", "A", ["0372610040130"], 1000) });
  const devA = call({ action: "get", id: "j1" }).job;
  const devB = call({ action: "get", id: "j1" }).job;
  devA.trucks.push({ id: "a2", do: "0042610040087", created: 5000, updated: 5000 });
  devB.trucks.push({ id: "b2", do: "0032610040165", created: 6000, updated: 6000 });
  call({ action: "save", job: devA });
  const r = call({ action: "save", job: devB });
  assert.deepEqual(r.job.trucks.map((t) => t.id), ["j1t0", "a2", "b2"]);
  const a2 = r.job; a2.trucks = a2.trucks.filter((t) => t.id !== "a2"); a2.removed = [{ id: "a2", updated: 7000 }];
  call({ action: "save", job: a2 });
  const back = call({ action: "save", job: devA }); // stale copy still has a2
  assert.deepEqual(back.job.trucks.map((t) => t.id), ["j1t0", "b2"]);
  assert.equal(SpreadsheetApp.sheets.Trucks.data.length, 3); // header + 2 trucks
});

test("deleted job is hidden, cannot come back, and frees its D/O", () => {
  const { call } = load();
  const j = job("j1", "A", ["0372610040130"]);
  call({ action: "save", job: j });
  call({ action: "delete", id: "j1" });
  assert.equal(call({ action: "list" }).jobs.length, 0);
  assert.equal(call({ action: "save", job: j }).error, "deleted");
  assert.equal(call({ action: "save", job: job("j2", "B", ["0372610040130"]) }).ok, true);
});

test("list returns open jobs and recently finished ones only", () => {
  const { call } = load();
  const old = Date.now() - 10 * 86400000;
  const a = job("old", "เก่า", ["0372610040130"], old); a.status = "done";
  const b = job("openOld", "ยังไม่จบ", ["0042610040087"], old);
  const c = job("new", "ใหม่", ["0032610040165"]); c.status = "done";
  [a, b, c].forEach((j) => call({ action: "save", job: j }));
  assert.deepEqual(call({ action: "list" }).jobs.map((j) => j.id).sort(), ["new", "openOld"]);
});

test("finished jobs older than 90 days move to a yearly archive; their D/O stays taken", () => {
  const { call, SpreadsheetApp, props } = load();
  const old = Date.now() - 100 * 86400000;
  const a = job("old", "เก่า", ["0372610040130", "0042610040087"], old); a.status = "done";
  call({ action: "save", job: a });
  call({ action: "save", job: job("cur", "ปัจจุบัน", ["0032610040165"]) });
  call({ action: "list" }); // runs the daily archive
  assert.equal(SpreadsheetApp.sheets.Jobs.data.length, 2);      // header + current job
  assert.equal(SpreadsheetApp.sheets.Trucks.data.length, 2);    // header + 1 truck
  const arc = SpreadsheetApp.openById(props[Object.keys(props).find((k) => k.startsWith("archive_"))]);
  assert.equal(arc.getSheetByName("Trucks").data.length, 3);    // header + 2 archived trucks
  const r = call({ action: "save", job: job("x", "ใหม่", ["0372610040130"]) });
  assert.equal(r.error, "duplicate");
  assert.equal(r.conflict.project, "(งานที่เก็บถาวรแล้ว)");
  call({ action: "list" }); // second list the same day does not archive again
  assert.ok(props.lastArchive);
});

test("an older sheet without the DO index gets it built from Trucks", () => {
  const { call, SpreadsheetApp } = load();
  call({ action: "save", job: job("j1", "A", ["0372610040130"]) });
  delete SpreadsheetApp.sheets.DO;
  assert.equal(call({ action: "checkDO", do: "0372610040130", jobId: "j2" }).hit.project, "A");
});

test("report returns jobs in the date range with their trucks", () => {
  const { call } = load();
  const a = job("a", "A", ["0372610040130", "0042610040087"]); a.header.date = "2026-10-20";
  const b = job("b", "B", ["0032610040165"]); b.header.date = "2026-10-25";
  const c = job("c", "C", ["0142610040116"]); c.header.date = "2026-10-21";
  [a, b, c].forEach((j) => call({ action: "save", job: j }));
  call({ action: "delete", id: "c" });
  const r = call({ action: "report", from: "2026-10-01", to: "2026-10-22" });
  assert.deepEqual(r.jobs.map((j) => j.id), ["a"]);
  assert.equal(r.jobs[0].trucks.length, 2);
  assert.equal(r.jobs[0].header.date, "2026-10-20");
});

test("D/O keeps its leading zeros even when the sheet columns are not set to text", () => {
  const { call, SpreadsheetApp } = load();
  call({ action: "list" }); // creates the sheets
  // a sheet made by hand / an older version: no text format anywhere
  ["Trucks", "DO", "Jobs"].forEach((n) => SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n).getRange(1, 1, 1000, 30).setNumberFormat("General"));
  call({ action: "save", job: job("j1", "A", ["0032610160061"]) });
  const tr = SpreadsheetApp.sheets.Trucks.data[1];
  assert.equal(tr[4], "0032610160061"); // stored as text, not 32610160061
  assert.equal(call({ action: "get", id: "j1" }).job.trucks[0].do, "0032610160061");
  assert.equal(call({ action: "checkDO", do: "0032610160061", jobId: "j2" }).hit.project, "A");
});

test("D/O already saved as a number is repaired: shown with zeros and still blocks duplicates", () => {
  const { call, SpreadsheetApp, props } = load();
  call({ action: "save", job: job("j1", "A", ["0032610160061"]) });
  // what the live sheet holds today: zeros lost in Trucks and in the DO index, repair not run yet
  SpreadsheetApp.sheets.Trucks.data[1][4] = 32610160061;
  SpreadsheetApp.sheets.DO.data[1][0] = 32610160061;
  delete props.doTextFixed;
  assert.equal(call({ action: "get", id: "j1" }).job.trucks[0].do, "0032610160061");
  assert.equal(SpreadsheetApp.sheets.DO.data[1][0], "0032610160061");
  const r = call({ action: "save", job: job("j2", "B", ["0032610160061"]) });
  assert.equal(r.error, "duplicate");
  assert.equal(r.conflict.project, "A");
});

test("Trial Mix PDF is mailed only to TRIAL_MAIL_TO, with a daily cap", () => {
  const { call, props, mail } = load();
  const pdf = Buffer.from("%PDF-1.3 test").toString("base64");
  assert.equal(call({ action: "mailTrial", name: "TrialMix_A.pdf", pdf }).error, "no_recipient");
  props.TRIAL_MAIL_TO = "qc@example.com";
  const r = call({ action: "mailTrial", name: "Trial/Mix:A.pdf", pdf, subject: "Trial Mix · A", body: "Project: A", to: "someone@else.com" });
  assert.equal(r.ok, true);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, "qc@example.com"); // the page cannot choose the recipient
  assert.equal(mail[0].attachments[0].name, "Trial-Mix-A.pdf");
  assert.equal(mail[0].attachments[0].type, "application/pdf");
  props.mailCount = "30";
  assert.equal(call({ action: "mailTrial", name: "x.pdf", pdf }).error, "daily_limit");
  assert.equal(call({ key: "wrong", action: "mailTrial", name: "x.pdf", pdf }).error, "unauthorized");
});

test("contacts: anyone registers, phone kept as text and unique; only the admin edits, deletes and sets departments", () => {
  const { call, props, SpreadsheetApp } = load();
  const me = { first: "สมศักดิ์", last: "อริยะ", nick: "ศักดิ์", phone: "081-234-5678", plant: "คลองตัน", dept: "ผลิต", pos: "ผู้จัดการฝ่ายผลิต" };
  const r = call({ action: "contactAdd", contact: me });
  assert.equal(r.ok, true);
  assert.equal(SpreadsheetApp.sheets.Contacts.data[1][4], "0812345678"); // stored as text, 0 kept
  assert.equal(call({ action: "contactAdd", contact: { ...me, first: "อื่น" } }).error, "phone_taken");
  assert.equal(call({ action: "contactAdd", contact: { first: "x" } }).error, "invalid");
  const list = call({ action: "contacts" });
  assert.equal(list.people.length, 1);
  assert.equal(list.people[0].phone, "0812345678");
  // admin
  assert.equal(call({ action: "contactDelete", id: r.contact.id, adminKey: "" }).error, "not_admin");
  props.ADMIN_KEY = "boss";
  assert.equal(call({ action: "adminCheck", adminKey: "boss" }).ok, true);
  assert.equal(call({ action: "contactUpdate", adminKey: "boss", contact: { ...r.contact, pos: "ผจก." } }).contact.pos, "ผจก.");
  call({ action: "contactSettings", adminKey: "boss", settings: { depts: [{ name: "ผลิต", positions: ["ผจก.", "หัวหน้าแพล้น"] }] } });
  assert.deepEqual(call({ action: "contacts" }).settings.depts[0].positions, ["ผจก.", "หัวหน้าแพล้น"]);
  assert.equal(call({ action: "contactDelete", adminKey: "boss", id: r.contact.id }).ok, true);
  assert.equal(call({ action: "contacts" }).people.length, 0);
});

test("contacts: admin import from a paste skips repeated phones", () => {
  const { call, props } = load();
  props.ADMIN_KEY = "boss";
  const people = [{ first: "ก", phone: "0811111111", email: "a@x.co" }, { first: "ข", last: "ค", phone: "0822222222" }, { first: "ซ้ำ", phone: "0811111111" }, { first: "", phone: "0833333333" }];
  assert.equal(call({ action: "contactImport", people, dept: "PQ" }).error, "not_admin");
  const r = call({ action: "contactImport", adminKey: "boss", people, dept: "PQ" });
  assert.equal(r.added, 2);
  assert.equal(r.skipped.length, 2);
  const list = call({ action: "contacts" }).people;
  assert.deepEqual(list.map((p) => [p.first, p.dept, p.email]), [["ก", "PQ", "a@x.co"], ["ข", "PQ", ""]]);
});

test("photos: upload to Drive, list by project and date, get, delete; retry with the same id stores once", () => {
  const { call, ctx } = load();
  const data = Buffer.from("jpegbytes").toString("base64");
  const up = (o) => call({ action: "photoUpload", project: "Langsuan Residence", date: "2026-10-30", kind: "plant", do: "0372610040130", data, ...o });
  const a = up({ id: "p-aaaaaa", takenAt: 123 });
  assert.equal(a.ok, true);
  assert.equal(a.photo.do, "0372610040130");
  assert.equal(up({ id: "p-aaaaaa" }).ok, true);
  up({ id: "p-bbbbbb", kind: "printout", do: "0042610040087" });
  up({ id: "p-cccccc", project: "อื่น" });
  up({ id: "p-dddddd", date: "2026-10-31" });
  const list = call({ action: "photoList", project: "Langsuan Residence", date: "2026-10-30" }).photos;
  assert.deepEqual(list.map((p) => p.id).sort(), ["p-aaaaaa", "p-bbbbbb"]);
  assert.equal(list.find((p) => p.id === "p-aaaaaa").takenAt, 123);
  assert.equal(Buffer.from(call({ action: "photoGet", id: "p-aaaaaa" }).data, "base64").toString(), "jpegbytes");
  assert.equal(Object.values(ctx.DriveApp.files).find((f) => f.blob).folder, "Langsuan Residence");
  assert.equal(call({ action: "photoDelete", id: "p-aaaaaa" }).ok, true);
  assert.deepEqual(call({ action: "photoList", project: "Langsuan Residence", date: "2026-10-30" }).photos.map((p) => p.id), ["p-bbbbbb"]);
  assert.equal(call({ action: "photoGet", id: "p-aaaaaa" }).ok, false);
  assert.equal(up({ kind: "other" }).error, "bad_request");
  assert.equal(up({ do: "" }).error, "bad_request");
  assert.equal(up({ date: "30/10/2569" }).error, "bad_request");
});

test("project report PDF is mailed only to REPORT_MAIL_TO", () => {
  const { call, props, mail } = load();
  const pdf = Buffer.from("%PDF-1.4 test").toString("base64");
  assert.equal(call({ action: "mailReport", name: "r.pdf", pdf }).error, "no_recipient");
  props.REPORT_MAIL_TO = "report@example.com";
  props.TRIAL_MAIL_TO = "qc@example.com";
  const r = call({ action: "mailReport", name: "รายงาน_A.pdf", pdf, subject: "รายงาน A", to: "someone@else.com" });
  assert.equal(r.ok, true);
  assert.equal(mail.at(-1).to, "report@example.com");
  assert.equal(mail.at(-1).subject, "รายงาน A");
  assert.equal(mail.at(-1).attachments[0].type, "application/pdf");
});

test("photo folder and archives are kept in the spreadsheet's Drive folder", () => {
  const { call, ctx, SpreadsheetApp } = load();
  const drive = ctx.DriveApp, home = drive.root.createFolder("M Concrete - Production");
  drive.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).moveTo(home);
  const data = Buffer.from("x").toString("base64");
  call({ action: "photoUpload", id: "p-111111", project: "P", date: "2026-10-30", kind: "plant", do: "0372610040130", data });
  const photos = Object.values(drive.folders).find((f) => f.name === "รูปรายงานโครงการ");
  assert.equal(photos.parent, home);
  // moved away by hand → put back next to the sheet on the next upload
  photos.moveTo(drive.root);
  call({ action: "photoUpload", id: "p-222222", project: "P", date: "2026-10-30", kind: "plant", do: "0372610040131", data });
  assert.equal(photos.parent, home);
  const arc = ctx.archiveFile(2026);
  assert.equal(drive.getFileById(arc.getId()).parent, home);
});
