// Runs apps-script/Code.gs against a small in-memory stand-in for Google Sheets.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function fakeSheets() {
  const sheets = {};
  const mkSheet = (name) => {
    const data = [];
    const sh = {
      name, data,
      getLastRow: () => data.length,
      getMaxRows: () => 1000,
      setFrozenRows() {},
      appendRow: (r) => { data.push(r.slice()); },
      deleteRow: (n) => { data.splice(n - 1, 1); },
      getRange: (row, col, nr = 1, nc = 1) => ({
        setValues(v) { v.forEach((r, i) => { const t = (data[row - 1 + i] = data[row - 1 + i] || []); r.forEach((x, j) => { t[col - 1 + j] = x; }); }); return this; },
        setValue(x) { (data[row - 1] = data[row - 1] || [])[col - 1] = x; return this; },
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = (data[row - 1 + i] || [])[col - 1 + j]; return v == null ? "" : v; })),
        setFontWeight() { return this; }, setNumberFormat() { return this; },
      }),
    };
    return sh;
  };
  return {
    sheets,
    getActiveSpreadsheet: () => ({
      getSheetByName: (n) => sheets[n] || null,
      insertSheet: (n) => (sheets[n] = mkSheet(n)),
    }),
  };
}

function load() {
  const SpreadsheetApp = fakeSheets();
  const ctx = {
    SpreadsheetApp,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "secret" }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
    Utilities: { formatDate: () => "" }, Session: { getScriptTimeZone: () => "Asia/Bangkok" },
    Date, JSON, Math, Map, Set, Array, Object, String, Number, Infinity,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../fieldsync.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8"), ctx);
  const call = (body) => ctx.doPost({ postData: { contents: JSON.stringify({ key: "secret", ...body }) } });
  return { call, SpreadsheetApp };
}

const job = (id, project, dos, t = 1) => ({
  id, created: t, updated: t, header: { project, date: "2026-10-26", cube: "500" }, headerUpdated: t,
  status: "open", statusUpdated: t, removed: [],
  trucks: dos.map((d, i) => ({ id: id + "t" + i, do: d, truck: "71" + i, volume: "7", created: t + i, updated: t })),
});

test("rejects calls without the key", () => {
  const { call } = load();
  assert.equal(call({ action: "list" }).ok, true);
  assert.equal(call({ key: "wrong", action: "list" }).error, "unauthorized");
});

test("save, list, get round trip keeps D/O leading zeros", () => {
  const { call } = load();
  assert.equal(call({ action: "save", job: job("j1", "งาน A", ["0372610040130", "0042610040087"]) }).ok, true);
  const list = call({ action: "list" }).jobs;
  assert.equal(list.length, 1);
  const got = call({ action: "get", id: "j1" }).job;
  assert.deepEqual(got.trucks.map((t) => t.do), ["0372610040130", "0042610040087"]);
  assert.equal(got.header.project, "งาน A");
});

test("D/O already used in another job is refused", () => {
  const { call } = load();
  call({ action: "save", job: job("j1", "งาน A", ["0372610040130"]) });
  const r = call({ action: "save", job: job("j2", "งาน B", ["0372610040130"]) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "duplicate");
  assert.equal(r.conflict.project, "งาน A");
  assert.equal(call({ action: "checkDO", do: "0372610040130", jobId: "j2" }).hit.project, "งาน A");
  assert.equal(call({ action: "checkDO", do: "0372610040130", jobId: "j1" }).hit, null);
});

test("two devices adding to the same job keep both trucks; removal sticks", () => {
  const { call, SpreadsheetApp } = load();
  call({ action: "save", job: job("j1", "A", ["0372610040130"]) });
  const devA = call({ action: "get", id: "j1" }).job;
  const devB = call({ action: "get", id: "j1" }).job;
  devA.trucks.push({ id: "a2", do: "0042610040087", created: 50, updated: 50 });
  devB.trucks.push({ id: "b2", do: "0032610040165", created: 60, updated: 60 });
  call({ action: "save", job: devA });
  const r = call({ action: "save", job: devB });
  assert.deepEqual(r.job.trucks.map((t) => t.id), ["j1t0", "a2", "b2"]);
  // device A removes a2
  const a2 = r.job; a2.trucks = a2.trucks.filter((t) => t.id !== "a2"); a2.removed = [{ id: "a2", updated: 70 }];
  call({ action: "save", job: a2 });
  const back = call({ action: "save", job: devA }); // stale copy still has a2
  assert.deepEqual(back.job.trucks.map((t) => t.id), ["j1t0", "b2"]);
  assert.equal(SpreadsheetApp.sheets.Trucks.data.length, 3); // header + 2 trucks
});

test("deleted job is hidden and cannot come back from an old copy", () => {
  const { call } = load();
  const j = job("j1", "A", ["0372610040130"]);
  call({ action: "save", job: j });
  call({ action: "delete", id: "j1" });
  assert.equal(call({ action: "list" }).jobs.length, 0);
  assert.equal(call({ action: "save", job: j }).error, "deleted");
  // its D/O is free again
  assert.equal(call({ action: "save", job: job("j2", "B", ["0372610040130"]) }).ok, true);
});
