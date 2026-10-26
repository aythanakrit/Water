const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../coretest.js");

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (±${tol})`);

test("specimen No.16 matches the Excel formulas", () => {
  const r = C.specimen({ d: 69.1, l: 139.4, w: 1.218, load: 144.31 }, 380);
  const area = 3.1415926 * (69.1 / 2) ** 2;
  near(r.area, area, 1e-9);
  near(r.ld, 139.4 / 69.1, 1e-12);
  near(r.density, ((1.218 * 1000) / (3.1415926 * ((6.91 ** 2) / 4) * 13.94)) * 1000, 1e-6);
  near(r.ksc, 144.31 * 101.97 / (area / 100), 1e-9);
  near(r.mpa, r.ksc * 0.0981, 1e-12);
  near(r.pct, r.ksc / 380, 1e-12);
  near(r.target100, 380 * (area / 100) / 101.97, 1e-9);
  near(r.target85, r.target100 * 0.85, 1e-12);
  near(r.ksc, 392.4, 0.1);
});

test("summary takes the minimum target over specimens", () => {
  const s = [
    { d: 69.1, l: 139.4, w: 1.218, load: 144.31 },
    { d: 67.2, l: 129.4, w: 0.964, load: 12.18 },
    { d: 0, l: 0, w: 0, load: 0 },
  ];
  const r = C.evaluate(s, 380);
  assert.equal(r.results[2], null);
  near(r.minTarget100, C.specimen(s[1], 380).target100, 1e-12);
  near(r.spec85, 323, 1e-9);
});
