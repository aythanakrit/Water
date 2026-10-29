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

test("project view: plant volume and rate, hourly volume, trucks and their trips, issues", () => {
  const job = { id: "p1", status: "done", header: { project: "วิทยุ", date: "2026-10-20" }, trucks: [
    { do: "1", truck: "715", volume: "7", plant: "คลองตัน", batching: "23:00", arrival: "23:30", start: "23:35", end: "23:50" },
    { do: "2", truck: "716", volume: "7", plant: "คลองตัน", batching: "23:30", arrival: "00:00", start: "00:05", end: "00:20" },
    { do: "3", truck: "715", volume: "7", plant: "คลองตัน", batching: "00:00", arrival: "00:30", start: "00:35", end: "00:50", remark: "ปั๊มเสีย" },
    { do: "4", truck: "820", volume: "6", plant: "พระราม9/21", batching: "23:10", arrival: "00:30", start: "00:40", end: "00:55" },
  ] };
  const v = D.projectView([job], "วิทยุ");
  assert.equal(v.volume, 27);
  assert.equal(v.trips, 4);
  const k = v.plants.find((p) => p.plant === "คลองตัน");
  assert.equal(k.volume, 21);
  // 3 trucks 30 min apart → 21 m³ over 3 × 30 min = 14 m³/h
  assert.equal(k.rate, 14);
  assert.equal(k.first, "23:00");
  assert.equal(k.last, "00:00");
  assert.equal(v.plants.find((p) => p.plant === "พระราม9/21").rate, null); // one truck: no rate
  assert.deepEqual(v.hourly.map((h) => [h.label, h.total]), [["23:00", 20], ["00:00", 7]]);
  const t715 = v.trucks.find((t) => t.truck === "715");
  assert.equal(t715.trips, 2);
  assert.deepEqual(t715.windows.map((w) => w.batching), ["23:00", "00:00"]);
  assert.equal(v.trucks.length, 3);
  assert.deepEqual(v.issues.map((i) => i.do), ["3", "4"]); // typed remark; travel 80 min
});

test("project view by whole hours: plant × hour volume, totals, per-hour averages, travel, trucks × hour", () => {
  const job = { id: "h1", status: "done", header: { project: "ฐานทัพ", date: "2026-10-29" }, trucks: [
    { do: "1", truck: "7125", volume: "7", plant: "คลองตัน", batching: "06:10", arrival: "06:40" },
    { do: "2", truck: "7126", volume: "7", plant: "คลองตัน", batching: "06:40", arrival: "07:20" },
    { do: "3", truck: "7125", volume: "7", plant: "คลองตัน", batching: "08:05", arrival: "08:35" },
    { do: "4", truck: "7125", volume: "6", plant: "พระราม9/21", batching: "08:20", arrival: "09:10" },
    { do: "5", truck: "7300", volume: "7", plant: "พระราม9/21", batching: "08:30", arrival: "08:10" }, // out of order: no travel
  ] };
  const v = D.projectView([job], "ฐานทัพ");
  assert.deepEqual(v.columns.map((c) => c.label), ["06:00", "07:00", "08:00"]); // 07:00 kept although empty
  const k = v.plantHours.find((p) => p.plant === "คลองตัน");
  assert.deepEqual(v.columns.map((c) => k.byHour[c.key] || 0), [14, 0, 7]);
  assert.equal(k.perHour, 10.5); // (14 + 7) ÷ 2 hours that batched
  assert.equal(k.avgTravel, (30 + 40 + 30) / 3);
  assert.deepEqual(v.columns.map((c) => v.totalByHour[c.key] || 0), [14, 0, 20]);
  assert.equal(v.perHour, 17); // (14 + 20) ÷ 2
  assert.equal(v.avgTravel, (30 + 40 + 30 + 50) / 4);
  assert.deepEqual(v.truckHours.map((t) => [t.truck, t.trips]), [["7125", 3], ["7126", 1], ["7300", 1]]);
  assert.deepEqual(v.columns.map((c) => (v.truckHours[0].byHour[c.key] || []).map((w) => `${w.batching}→${w.arrival}`)),
    [["06:10→06:40"], [], ["08:05→08:35", "08:20→09:10"]]);
});

test("a 24-hour job keeps its hours in order (18:00 … 17:00 next day)", () => {
  const hh = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const trucks = Array.from({ length: 49 }, (_, i) => ({ do: String(i), truck: String(i % 9), volume: "7", plant: "P" + (i % 15), batching: hh(1080 + i * 30), arrival: hh(1110 + i * 30) }));
  const v = D.projectView([{ id: "x", status: "done", header: { project: "24h", date: "2026-10-29" }, trucks }], "24h");
  assert.equal(v.columns.length, 25);
  assert.equal(v.columns[0].label, "18:00");
  assert.equal(v.columns[24].label, "18:00");
  assert.equal(v.plantHours.length, 15);
  assert.equal(Object.values(v.totalByHour).reduce((a, b) => a + b, 0), 49 * 7);
});
