const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../volume.js");

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (±${tol})`);

test("net volume by shape", () => {
  assert.equal(V.netVolume("slab", { a: 10, b: 10, h: 0.1 }), 10);
  assert.equal(V.netVolume("beam", { a: 0.2, b: 0.5, h: 6, n: 4 }), 2.4000000000000004);
  near(V.netVolume("pile", { a: 0.6, b: 20, n: 3 }), Math.PI / 4 * 0.36 * 20 * 3, 1e-12);
  assert.equal(V.netVolume("other", { a: 3.2 }), 3.2);
  assert.throws(() => V.netVolume("x", {}));
});

test("every type has a default allowance and reasons", () => {
  for (const t of Object.values(V.TYPES)) {
    assert.ok(t.waste >= 0);
    assert.ok(t.reasons.length > 0);
  }
});

test("order adds allowance, pump, rounds up and splits into trips", () => {
  const r = V.order([
    { type: "slab", a: 10, b: 10, h: 0.1 },          // 10 m³ + 4% = 10.4
    { type: "footing", a: 2, b: 2, h: 0.5, n: 2 },   // 4 m³ + 7% = 4.28
  ], { cap: 5, step: 0.5, pump: 0.3 });
  near(r.net, 14, 1e-9);
  near(r.extra, 0.68, 1e-9);
  near(r.need, 14.98, 1e-9);
  assert.equal(r.ordered, 15);
  assert.equal(r.trips, 3);
  assert.equal(r.last, 5);
  near(r.wastePct, 0.98 / 14 * 100, 1e-9);
});

test("waste can be overridden and exact multiples are not bumped", () => {
  const r = V.order([{ type: "slab", a: 10, b: 10, h: 0.1, waste: 0 }], { cap: 4, step: 0.5 });
  assert.equal(r.ordered, 10);
  assert.equal(r.trips, 3);
  assert.equal(r.last, 2);
});
