const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../fieldtools.js");

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (±${tol})`);

test("kN ↔ ksc uses π and 101.97, same as the core page", () => {
  const C = require("../coretest.js");
  near(T.knToKsc(1126.25, "cylinder"), 1126.25 * 101.97 / (Math.PI * 56.25), 1e-9);
  near(T.knToKsc(1126.25, "cylinder"), C.specimen({ d: 150, l: 300, w: 12.5, load: 1126.25 }, 380).ksc, 1e-4);
  near(T.kscToKn(T.knToKsc(1126.25, "cylinder"), "cylinder"), 1126.25, 1e-9);
  near(T.knToKsc(525, "cube"), 525 * 101.97 / 225, 1e-9);
  near(T.kscToKn(237, "cube"), 237 * 225 / 101.97, 1e-9);
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

test("MPa uses ksc × 0.0981, same as the core page", () => {
  const C = require("../coretest.js");
  const ksc = T.knToKsc(1126.25, "cylinder");
  const core = C.specimen({ d: 150, l: 300, w: 12.5, load: 1126.25 }, 380);
  near(T.kscToMpa(ksc), core.mpa, 1e-3);
  near(T.mpaToKsc(T.kscToMpa(650)), 650, 1e-9);
  near(T.kscToKn(T.mpaToKsc(64), "cylinder"), 64 / 0.0981 * Math.PI * 56.25 / 101.97, 1e-9);
});
