const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../tickets.js");

test("a ticket is complete at 13 digits; its plant, date and running number are read", () => {
  assert.equal(T.complete("037261103001"), false);
  assert.equal(T.complete("0372611030012"), true);
  const p = T.parse("0372611030012");
  assert.equal(p.code, "037"); assert.equal(p.date, "2026-11-03"); assert.equal(p.seq, 12); assert.ok(p.plant);
});

test("scans are numbered; a repeat is kept and marked; removing renumbers", () => {
  const l = [];
  T.add(l, "0372611030001", 1); T.add(l, "0042611030002", 2);
  const r = T.add(l, "0372611030001", 3);
  assert.equal(r.no, 3); assert.equal(r.dupOf, 1);
  assert.deepEqual([...T.duplicates(l)].sort(), [1, 3]);
  T.remove(l, 1);
  assert.deepEqual(l.map((e) => [e.no, e.dupOf]), [[1, null], [2, null]]);
});

test("summary counts scans, tickets, repeats, per plant and per date", () => {
  const l = [];
  ["0372611030001", "0372611030002", "0372611030001", "0042611020001"].forEach((d, i) => T.add(l, d, i));
  const s = T.summary(l);
  assert.equal(s.scans, 4); assert.equal(s.tickets, 3); assert.equal(s.repeats, 1); assert.equal(s.dupTickets, 1);
  assert.equal(s.plants[0].n, 2);
  assert.deepEqual(s.dates.map((x) => [x.key, x.n]), [["2026-11-02", 1], ["2026-11-03", 2]]);
});

test("Excel rows keep the D/O as text and say which scans repeat", () => {
  const l = [];
  T.add(l, "0042611030001", 0); T.add(l, "0042611030001", 0);
  const r = T.rows(l, () => "08:00");
  assert.equal(r[0]["เลข D/O"], "0042611030001");
  assert.equal(r[0]["ซ้ำ"], "มีสแกนซ้ำ"); assert.equal(r[1]["ซ้ำ"], "ซ้ำกับลำดับ 1");
});
