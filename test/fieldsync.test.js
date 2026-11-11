const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../fieldsync.js");

const base = () => ({
  id: "j1", created: 1, updated: 1, header: { project: "A" }, headerUpdated: 1,
  status: "open", statusUpdated: 1, removed: [],
  trucks: [{ id: "t1", do: "0372610040130", created: 10, updated: 10 }],
});

test("trucks added on two devices are both kept, in arrival order", () => {
  const a = base(), b = base();
  a.trucks.push({ id: "t2", do: "0042610040087", created: 30, updated: 30 });
  b.trucks.push({ id: "t3", do: "0032610040165", created: 20, updated: 20 });
  const m = S.mergeJobs(a, b);
  assert.deepEqual(m.trucks.map((t) => t.id), ["t1", "t3", "t2"]);
});

test("newer edit of the same truck wins; header and status keep the newer edit", () => {
  const a = base(), b = base();
  a.trucks[0] = { ...a.trucks[0], slump: "18", updated: 40 };
  b.trucks[0] = { ...b.trucks[0], slump: "20", updated: 50 };
  a.header = { project: "A-new" }; a.headerUpdated = 60;
  b.status = "done"; b.statusUpdated = 70;
  const m = S.mergeJobs(a, b);
  assert.equal(m.trucks[0].slump, "20");
  assert.equal(m.header.project, "A-new");
  assert.equal(m.status, "done");
});

test("a removal is not undone by a device that still has the truck", () => {
  const a = base(), b = base();
  a.trucks = []; a.removed = [{ id: "t1", updated: 80 }];
  assert.equal(S.mergeJobs(a, b).trucks.length, 0);
  assert.equal(S.mergeJobs(b, a).trucks.length, 0);
  // edited again after the removal → it comes back
  b.trucks[0].updated = 90;
  assert.equal(S.mergeJobs(a, b).trucks.length, 1);
});

test("D/O conflicts inside the job and across jobs", () => {
  const j = base();
  assert.equal(S.findConflict(j, []), null);
  const other = [{ jobId: "j2", project: "B", do: "0372610040130", no: 4 }];
  const c = S.findConflict(j, other);
  assert.equal(c.project, "B");
  assert.equal(c.no, 4);
  assert.equal(S.findConflict(j, [{ jobId: "j1", do: "0372610040130", no: 1 }]), null);
  j.trucks.push({ id: "t9", do: " 0372610040130", created: 99, updated: 99 });
  assert.equal(S.findConflict(j, []).sameJob, true);
});

test("old local jobs get ids and timestamps", () => {
  const j = S.upgradeJob({ id: "j", created: 5, updated: 9, header: {}, trucks: [{ do: "1" }, { do: "2" }] });
  assert.ok(j.trucks[0].id && j.trucks[1].id && j.trucks[0].id !== j.trucks[1].id);
  assert.ok(j.trucks[0].created < j.trucks[1].created);
  assert.equal(j.headerUpdated, 9);
});

test("trucks sort by arrival, also across midnight; a late-entered earlier arrival moves up", () => {
  const t = (id, arrival, created) => ({ id, arrival, created });
  const sorted = S.sortTrucks([t("a", "23:40", 1), t("b", "00:10", 2), t("c", "23:30", 3), t("d", "", 4), t("e", "23:55", 5)]);
  assert.deepEqual(sorted.map((x) => x.id), ["c", "a", "e", "b", "d"]);
  const j = base();
  j.trucks[0].arrival = "10:30";
  const k = base();
  k.trucks.push({ id: "t2", do: "0042610040087", arrival: "10:10", created: 30, updated: 30 });
  assert.deepEqual(S.mergeJobs(j, k).trucks.map((x) => x.id), ["t2", "t1"]);
});

test("merge keeps the D/O that still has its leading zeros when both copies are the same edit", () => {
  const j = base(), k = base();
  j.trucks[0].do = "32610160061";
  k.trucks[0].do = "0032610160061";
  assert.equal(S.mergeJobs(j, k).trucks[0].do, "0032610160061");
  assert.equal(S.mergeJobs(k, j).trucks[0].do, "0032610160061");
});

test("D/O carries the ticket date (YYMMDD in digits 4–9) and a daily running number", () => {
  assert.equal(S.doDay("0372610280010"), Date.UTC(2026, 9, 28) / 864e5);
  assert.equal(S.doSeq("0372610280010"), 10);
  assert.equal(S.doDay("037261028001"), null); // 12 digits: not a full D/O
  assert.equal(S.doDay("0372613280010"), null); // month 13
});

test("trucks sort by D/O date + arrival time; after midnight counts as the next day", () => {
  const t = (id, d, batching, arrival, created) => ({ id, do: d, batching, arrival, created });
  const trucks = [
    t("b", "0372610310021", "23:10", "00:05", 2),   // 31 Oct ticket, arrives after midnight (earlier clock than batching)
    t("a", "0372610310020", "22:50", "23:40", 1),
    t("c", "0372611010001", "00:20", "01:00", 3),   // 1 Nov ticket
    t("y", "0372610300050", "15:00", "15:40", 6),   // previous day, entered late
    t("z", "0372610310022", "", "", 4),             // no arrival yet: last (entry order)
  ];
  assert.deepEqual(S.sortTrucks(trucks).map((x) => x.id), ["y", "a", "b", "c", "z"]);
});

test("same arrival minute: ticket running number decides", () => {
  const t = (id, d) => ({ id, do: d, batching: "08:00", arrival: "08:30", created: 9 });
  assert.deepEqual(S.sortTrucks([t("2", "0372610310012"), t("1", "0372610310011")]).map((x) => x.id), ["1", "2"]);
});

test("no batching time: an early-morning arrival recorded the day after the ticket date counts on that day", () => {
  const at = (iso) => Date.parse(iso);
  const trucks = [
    { id: "late", do: "0372610310030", arrival: "00:20", created: at("2026-11-01T00:21:00+07:00") },
    { id: "eve", do: "0372610310029", arrival: "23:50", created: at("2026-10-31T23:51:00+07:00") },
  ];
  assert.deepEqual(S.sortTrucks(trucks).map((x) => x.id), ["eve", "late"]);
});

test("same arrival minute across two ticket dates: the earlier ticket date first", () => {
  const t = (id, d) => ({ id, do: d, batching: "", arrival: "05:00", created: 9 });
  assert.deepEqual(S.sortTrucks([t("nov", "0372611010001"), t("oct", "0372610310020")]).map((x) => x.id), ["oct", "nov"]);
});

test("night pour from the site (1 Nov 2026): a plant still printing 31 Oct after midnight does not jump to the top", () => {
  // as recorded on site; created = when บันทึกรถ was pressed (Thai time)
  const at = (hhmm, day = "2026-11-01") => Date.parse(`${day}T${hhmm}:00+07:00`);
  const t = (id, d, batching, arrival, created) => ({ id, do: d, batching, arrival, created });
  const trucks = [
    t("751", "0362610310034", "00:05", "00:55", at("00:55")),
    t("771", "0042610310031", "00:00", "01:40", at("01:40")),
    t("7169", "0362610310029", "23:20", "00:19", at("00:19")),
    t("7227", "0372611010001", "00:06", "00:55", at("00:56")),
    t("7112", "0042610310029", "23:46", "00:42", at("00:42")),
    t("x", "0362610310020", "22:30", "23:30", at("23:30", "2026-10-31")),
  ];
  assert.deepEqual(S.sortTrucks(trucks).map((x) => x.id), ["x", "7169", "7112", "751", "7227", "771"]);
});

test("a ticket typed in a day later is placed by its ticket date", () => {
  const at = (iso) => Date.parse(iso + "+07:00");
  const tk = (id, d, arr, bat, created) => ({ id, do: d, arrival: arr, batching: bat, created });
  const trucks = [
    tk("a", "0372611020021", "06:47", "06:10", at("2026-11-02T06:48")),
    tk("b", "0362611020001", "08:32", "08:00", at("2026-11-02T08:33")),
    tk("late", "0672611010015", "11:24", "10:50", at("2026-11-02T15:00")), // 1 Nov ticket, typed on 2 Nov
  ];
  assert.deepEqual(S.sortTrucks(trucks).map((x) => x.id), ["late", "a", "b"]);
  // after midnight the ticket stays on the previous day but the truck is recorded at once: not moved back
  const night = [tk("n1", "0372611010040", "23:50", "23:20", at("2026-11-01T23:51")), tk("n2", "0372611010041", "00:20", "23:45", at("2026-11-02T00:21"))];
  assert.deepEqual(S.sortTrucks(night).map((x) => x.id), ["n1", "n2"]);
});
