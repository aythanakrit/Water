const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../dolog.js");

test("a ticket is complete at 13 digits (spaces ignored)", () => {
  assert.equal(L.complete("037261031002"), false);
  assert.equal(L.complete("0372610310021"), true);
  assert.equal(L.complete("037 2610 310021"), true);
});

test("entries are numbered 1, 2, 3 …; a repeat is kept and points at the first one", () => {
  const list = [];
  assert.deepEqual(L.add(list, "0372610310021", 1), { no: 1, do: "0372610310021", at: 1, dupOf: null });
  L.add(list, "0042610310031", 2);
  const rep = L.add(list, "0372610310021", 3);
  assert.equal(rep.no, 3);
  assert.equal(rep.dupOf, 1);
  assert.equal(list.length, 3);
  assert.deepEqual([...L.duplicates(list)].sort(), [1, 3]);
});

test("copy text has a header and marks repeats", () => {
  const list = [];
  L.add(list, "0372610310021", 0); L.add(list, "0372610310021", 0);
  const lines = L.toText(list, () => "21:05").split("\n");
  assert.equal(lines[0], "ลำดับ\tD/O\tเวลาบันทึก\tซ้ำ");
  assert.equal(lines[2], "2\t0372610310021\t21:05\tซ้ำ");
});
