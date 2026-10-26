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
  assert.equal(r.factor, 1); // L:D 2.02
  near(r.pct, r.ksc / 380, 1e-12);
  near(r.target100, 380 * (area / 100) / 101.97, 1e-9);
  near(r.target85, r.target100 * 0.85, 1e-12);
  near(r.ksc, 392.4, 0.1);
  assert.deepEqual(r.flags, []);
});

test("ASTM C42 L:D correction", () => {
  assert.equal(C.ldFactor(2.0), 1);
  assert.equal(C.ldFactor(1.75), 0.98);
  near(C.ldFactor(1.375), 0.945, 1e-12);
  assert.equal(C.ldFactor(1.0), 0.87);
  assert.equal(C.ldFactor(0.9), null);
  const r = C.specimen({ d: 100, l: 125, w: 2.2, load: 200 }, 300);
  near(r.corrected, r.ksc * 0.93, 1e-9);
  near(r.target100 * 0.93, 300 * (r.area / 100) / 101.97, 1e-9);
});

test("ACI 318 group acceptance: avg ≥ 85%, each ≥ 75%", () => {
  assert.equal(C.acceptGroup([330, 330, 330], 380).ok, true);  // 86.8%
  assert.equal(C.acceptGroup([320, 320, 320], 380).avgOk, false);
  const g = C.acceptGroup([400, 400, 280], 380);  // avg 94.7%, min 73.7%
  assert.equal(g.avgOk, true);
  assert.equal(g.minOk, false);
});

test("groups and data flags from the sheet", () => {
  const s = [
    { name: "No.16", group: "1", d: 69.1, l: 139.4, w: 1.218, load: 144.31 },
    { name: "No.19", group: "1", d: 69.1, l: 137.7, w: 1.12, load: 151.84 },
    { name: "No.20", group: "1", d: 69.1, l: 137.5, w: 1.196, load: 121.41 },
    { name: "No.2", group: "2", d: 67.2, l: 129.4, w: 0.964, load: 12.18 },
    { name: "M5", group: "2", d: 0, l: 0, w: 0, load: 0 },
  ];
  const r = C.evaluate(s, 380);
  assert.equal(r.results[4], null);
  assert.equal(r.groups.length, 2);
  assert.equal(r.groups[0].ok, true);
  assert.equal(r.groups[0].n, 3);
  assert.equal(r.groups[1].ok, false);
  assert.equal(r.results[3].flags.length, 1); // low %; density 2,100 is not below the limit
});
