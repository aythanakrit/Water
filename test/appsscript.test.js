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
    const range = (row, col, nr = 1, nc = 1) => ({
      setValues(v) { v.forEach((r, i) => { const t = (data[row - 1 + i] = data[row - 1 + i] || []); r.forEach((x, j) => { t[col - 1 + j] = x; }); }); return this; },
      setValue(x) { (data[row - 1] = data[row - 1] || [])[col - 1] = x; return this; },
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (data[row - 1 + i] || [])[col - 1 + j]; return v == null ? "" : v; })),
      setFontWeight() { return this; }, setNumberFormat() { return this; },
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
      name, data,
      getLastRow: () => data.length,
      getMaxRows: () => 1000,
      setFrozenRows() {},
      appendRow: (r) => { data.push(r.slice()); },
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

function load() {
  const SpreadsheetApp = fakeSheets();
  const props = { KEY: "secret" };
  const ctx = {
    SpreadsheetApp,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
    Utilities: { formatDate: () => "" }, Session: { getScriptTimeZone: () => "Asia/Bangkok" },
    Date, JSON, Math, Map, Set, Array, Object, String, Number, Infinity,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../fieldsync.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8"), ctx);
  const call = (body) => { ctx.SHEETS = null; return ctx.doPost({ postData: { contents: JSON.stringify({ key: "secret", ...body }) } }); };
  vm.runInContext("var __reset = () => { SHEETS = null; };", ctx);
  const callFresh = (body) => { ctx.__reset(); return call(body); };
  return { call: callFresh, SpreadsheetApp, props, ctx };
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
