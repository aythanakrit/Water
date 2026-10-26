const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../fieldtools.js");

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (±${tol})`);

test("kN ↔ ksc matches the Excel sheet", () => {
  near(T.knToKsc(1126.25, "cylinder"), 1126250 / (3.14 * 56.25 * 9.81), 1e-9); // ≈ 650 ksc
  near(T.knToKsc(1126.25, "cylinder"), 650, 0.01);
  near(T.kscToKn(650, "cylinder"), 1126.25, 0.01);
  near(T.knToKsc(525, "cube"), 525000 / (225 * 9.81), 1e-9);
  near(T.kscToKn(237, "cube"), 237 * 225 * 9.81 / 1000, 1e-9);
});

test("site cement adjustment keeps dose per binder (Excel example)", () => {
  const r = T.adjustMix({ cement: 150, flyAsh: 150, admix: { AD: 0, G: 3000, F: 0 } }, 200, 1.75);
  assert.equal(r.perM3.flyAsh, 150);
  assert.equal(r.perM3.admix.G, 3500);
  assert.equal(r.perM3.admix.AD, 0);
  assert.equal(r.dose.G, 10);
  assert.equal(r.load.cement, 350);
  assert.equal(r.load.flyAsh, 262.5);
  assert.equal(r.load.admix.G, 6125);
  assert.equal(r.loadBinder, 612.5);
});
