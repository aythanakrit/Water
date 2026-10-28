const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../trialmix.js");

test("new trial has the 7 checks of the form, 0 to 180 min", () => {
  const t = T.newTrial("x", "2026-10-28");
  assert.deepEqual(t.rows.map((r) => r.min), [0, 30, 60, 90, 120, 150, 180]);
  assert.equal(t.header.date, "2026-10-28");
  assert.equal(T.filledRows(t), 0);
});

test("planned time follows the 0-min time, also across midnight", () => {
  const t = T.newTrial("x");
  assert.equal(T.plannedTime(t, 2), "");
  t.rows[0].time = "22:45";
  assert.equal(T.plannedTime(t, 2), "23:45");
  assert.equal(T.plannedTime(t, 6), "01:45");
});

test("slump loss against the 0-min slump; slump held until it drops below the required value", () => {
  const t = T.newTrial("x");
  [["18", "45"], ["17", "43"], ["15.5", ""], ["13", ""]].forEach(([c, f], i) => { t.rows[i].cone = c; t.rows[i].flow = f; });
  const l = T.slumpLoss(t);
  assert.deepEqual(l.map((x) => x.cone), [0, 1, 2.5, 5, null, null, null]);
  assert.deepEqual(l.map((x) => x.flow), [0, 2, null, null, null, null, null]);
  assert.equal(T.holdsSlumpUntil(t), null); // no required slump
  t.header.slump = "15";
  assert.equal(T.holdsSlumpUntil(t), 60);
  assert.equal(T.filledRows(t), 4);
});
