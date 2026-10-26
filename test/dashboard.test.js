const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../dashboard.js");

const jobs = [
  { id: "a", status: "done", header: { project: "A", customer: "C1", date: "2026-10-20" }, trucks: [
    { do: "1", volume: "7", plant: "คลองตัน", batching: "22:00", arrival: "22:40", start: "22:50", end: "23:10", slump: "18", conTemp: "32" },
    { do: "2", volume: "7", plant: "คลองตัน", batching: "22:10", arrival: "23:30", start: "00:10", end: "00:20" }, // travel 80, wait 40, age 130
    { do: "", volume: "7", plant: "คลองตัน" }, // no D/O: not delivered
  ] },
  { id: "b", status: "open", header: { project: "B", date: "2026-10-22" }, trucks: [
    { do: "3", volume: "5.5", plant: "บางพลี", batching: "08:00", arrival: "08:30" },
    { do: "4", volume: "6", plant: "บางพลี", batching: "08:00", arrival: "07:50" }, // out of order
  ] },
  { id: "c", status: "deleted", header: { project: "X", date: "2026-10-21" }, trucks: [{ do: "9", volume: "7" }] },
  { id: "d", status: "done", header: { project: "Old", date: "2026-09-01" }, trucks: [{ do: "8", volume: "7" }] },
];

test("trips: delivered trucks in range, deleted jobs excluded", () => {
  const r = D.trips(jobs, { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(r.map((x) => x.do), ["1", "2", "3", "4"]);
  assert.equal(r[1].travel, 80);
  assert.equal(r[1].age, 130);
  assert.equal(r[1].bad, true);
  assert.deepEqual(D.trips(jobs, { from: "2026-10-01", to: "2026-10-31", plant: "บางพลี" }).map((x) => x.do), ["3", "4"]);
});

test("stats: totals, averages without out-of-order trips, counts over limits", () => {
  const s = D.stats(D.trips(jobs, { from: "2026-10-01", to: "2026-10-31" }));
  assert.equal(s.trips, 4);
  assert.equal(s.volume, 25.5);
  assert.equal(s.jobs, 2);
  assert.equal(s.avgTravel, (40 + 80 + 30) / 3);
  assert.equal(s.avgAge, (70 + 130) / 2);
  assert.equal(s.overAge, 1);
  assert.equal(s.overWait, 1);
  assert.equal(s.overTravel, 1);
  assert.equal(s.orderErrors, 1);
  assert.equal(s.flagged, 2);
  assert.equal(s.avgSlump, 18);
  assert.equal(s.maxConTemp, 32);
});

test("groupBy plant sorted by volume; daily zero-fills the range", () => {
  const r = D.trips(jobs, { from: "2026-10-20", to: "2026-10-22" });
  const g = D.groupBy(r, "plant");
  assert.deepEqual(g.map((x) => [x.key, x.volume]), [["คลองตัน", 14], ["บางพลี", 11.5]]);
  assert.deepEqual(D.daily(r, "2026-10-20", "2026-10-22"), [
    { date: "2026-10-20", volume: 14 }, { date: "2026-10-21", volume: 0 }, { date: "2026-10-22", volume: 11.5 },
  ]);
});

test("CSV keeps D/O as text and quotes commas", () => {
  const csv = D.toCSV(D.trips([{ id: "x", header: { project: "A, B", date: "2026-10-20" }, trucks: [{ do: "0032610040165", volume: 7 }] }]));
  assert.ok(csv.startsWith("﻿"));
  assert.match(csv, /"A, B"/);
  assert.match(csv, /'0032610040165/);
});
