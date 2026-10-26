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
