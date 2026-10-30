const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../photos.js");

const trucks = [{ do: "0372610040130", truck: "7101" }, { do: "0372610040131", truck: "7102" }, { do: "0372610040132", truck: "7103" }];
const ph = (id, kind, d, takenAt = 0) => ({ id, kind, do: d, takenAt });

test("report order: printout, slump at plant, slump on site", () => {
  assert.deepEqual(P.KINDS.map((k) => k.key), ["printout", "plant", "site"]);
  assert.equal(P.KINDS.find((k) => k.key === "printout").locked, true);
});

test("stamp text is Thai date (Buddhist year) and 24-hour time", () => {
  assert.equal(P.stampText(new Date(2026, 9, 30, 14, 5).getTime()), "30/10/2569 14:05");
});

test("photos follow the truck order by D/O; unknown D/O last, then by time", () => {
  const photos = [ph("a", "plant", "0372610040132"), ph("b", "plant", "9999", 5), ph("c", "plant", "0372610040130"),
    ph("d", "site", "0372610040131"), ph("e", "plant", "8888", 1)];
  const r = P.forReport(photos, trucks, "plant");
  assert.deepEqual(r.map((x) => x.photo.id), ["c", "a", "e", "b"]);
  assert.deepEqual([r[0].no, r[0].truck, r[2].no], [1, "7101", ""]);
});

test("missing lists report rows without a photo of that kind", () => {
  const photos = [ph("a", "plant", "0372610040132"), ph("d", "site", "0372610040131")];
  assert.deepEqual(P.missing(photos, trucks, "plant"), [1, 2]);
  assert.deepEqual(P.missing(photos, trucks, "site"), [1, 3]);
});

test("pages of four", () => {
  assert.deepEqual(P.chunk([1, 2, 3, 4, 5, 6, 7, 8, 9]).map((p) => p.length), [4, 4, 1]);
  assert.deepEqual(P.chunk([]), []);
});

test("admin code is kept only as a SHA-256 hash", () => {
  assert.match(P.ADMIN_HASH, /^[0-9a-f]{64}$/);
});
