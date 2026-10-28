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
  t.header.slump = "15"; t.header.slumpTol = "";
  assert.equal(T.holdsSlumpUntil(t), 60);
  t.header.slumpTol = "2.5"; // 13 cm still within 15 − 2.5
  assert.equal(T.holdsSlumpUntil(t), 90);
  assert.equal(T.slumpText(t.header), "15 ± 2.5");
  assert.equal(T.filledRows(t), 4);
});

test("photos follow the main page in slot order: mix, plant screen, scale, ticket, slump 1-7, samples", () => {
  const t = T.newTrial("x");
  const add = (slot, added) => t.photos.push({ id: slot + added, slot, added });
  add("sample", 1); add("slump3", 2); add("ticket", 3); add("mix", 4); add("slump1", 5); add("sample", 6); add("old", 7);
  const o = T.orderedPhotos(t);
  assert.deepEqual(o.map((p) => p.slot), ["mix", "ticket", "slump1", "slump3", "sample", "sample"]);
  assert.equal(o[2].caption, "สลัม ครั้งที่ 1 (0 นาที)");
  assert.equal(o[3].caption, "สลัม ครั้งที่ 3 (60 นาที)");
  assert.deepEqual(o.slice(4).map((p) => p.caption), ["ภาพเก็บลูกปูน / Slip Test (1/2)", "ภาพเก็บลูกปูน / Slip Test (2/2)"]);
  assert.equal(T.PHOTO_SLOTS.length, 12);
});

test("extra photo slots named by the user come after the fixed ones", () => {
  const t = T.newTrial("x");
  t.extraSlots = [{ key: "x1", label: "ป้ายหน้าไซต์" }, { key: "x2", label: "" }];
  t.photos = [{ id: "a", slot: "x2", added: 1 }, { id: "b", slot: "x1", added: 2 }, { id: "c", slot: "sample", added: 3 }];
  assert.deepEqual(T.orderedPhotos(t).map((p) => p.caption), ["ภาพเก็บลูกปูน / Slip Test", "ป้ายหน้าไซต์", "ภาพเพิ่มเติม"]);
  assert.equal(T.slotsOf(t).length, 14);
});
