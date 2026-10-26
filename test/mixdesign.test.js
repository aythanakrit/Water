const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../mixdesign.js");

const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (±${tol})`);

const base = {
  fc: 22, sd: null, nTests: 0, slump: 87.5, nmas: 25, exposure: "none",
  sgCement: 3.15, fm: 2.8, druw: 1600,
  coarse: { sg: 2.68, absorption: 0.5, moisture: 0.5 },
  fine: { sg: 2.64, absorption: 0.7, moisture: 0.7 },
};

test("f'cr without SD data (ACI 318-19 Table 26.4.3.1(b))", () => {
  near(M.requiredStrength(18).fcr, 25.0, 1e-9);
  near(M.requiredStrength(28).fcr, 36.3, 1e-9);
  near(M.requiredStrength(40).fcr, 49.0, 1e-9);
});

test("f'cr with SD, ≥30 tests and 20-test modification factor", () => {
  // fc 30, s 3.0: max(34.02, 33.49) = 34.02
  near(M.requiredStrength(30, 3.0, 30).fcr, 34.02, 1e-9);
  // 20 tests → s × 1.08 = 3.24: max(34.34, 34.05)
  near(M.requiredStrength(30, 3.0, 20).fcr, 34.3416, 1e-9);
  // fc 40, s 4: max(45.36, 45.32)
  near(M.requiredStrength(40, 4.0, 30).fcr, 45.36, 1e-9);
});

test("w/c interpolation from Table 6.3.4(a)", () => {
  near(M.wcFromStrength(30, false).wc, 0.54, 1e-9);
  near(M.wcFromStrength(27.5, false).wc, 0.575, 1e-9);
  near(M.wcFromStrength(25, true).wc, 0.52, 1e-9);
});

test("full design — non-AE, 75–100 mm, 25 mm, f'cr 30.3", () => {
  const r = M.design(base);
  near(r.fcr, 30.3, 1e-9);
  assert.equal(r.water, 193);
  assert.equal(r.air, 1.5);
  near(r.bb0, 0.67, 1e-9);
  near(r.design.coarse, 1072, 0.01);
  near(r.wc, 0.54 - 0.3 / 5 * 0.07, 1e-9); // 0.5358
  near(r.design.cement, 193 / 0.5358, 0.01);
  // absolute volumes sum to 1 m³
  const v = r.volumes;
  near(v.water + v.cement + v.coarse + v.fine + v.air, 1, 1e-9);
  // SSD-equal moisture → no water correction
  near(r.batch.water, 193, 1e-9);
});

test("moisture adjustment", () => {
  const r = M.design({ ...base, fine: { sg: 2.64, absorption: 0.7, moisture: 5.0 } });
  near(r.batch.fine, r.design.fine * 1.05, 1e-9);
  near(r.batch.water, 193 - r.design.fine * 0.043, 1e-9);
});

test("durability limit and min cement govern", () => {
  const r1 = M.design({ ...base, wcMax: 0.45 });
  assert.equal(r1.wc, 0.45);
  const r2 = M.design({ ...base, cementMin: 400 });
  assert.equal(r2.design.cement, 400);
  near(r2.wc, 193 / 400, 1e-9);
});

test("fly ash and slag split the binder and keep 1 m³", () => {
  const r = M.design({ ...base, flyAsh: { pct: 20, sg: 2.2 }, slag: { pct: 10, sg: 2.9 } });
  const binder = 193 / r.wc;
  near(r.binder, binder, 1e-9);
  near(r.design.flyAsh, binder * 0.2, 1e-9);
  near(r.design.slag, binder * 0.1, 1e-9);
  near(r.design.cement, binder * 0.7, 1e-9);
  const v = r.volumes;
  near(v.water + v.cement + v.flyAsh + v.slag + v.coarse + v.fine + v.air, 1, 1e-9);
  // lighter SCMs take more volume → less sand than the plain mix
  assert.ok(r.design.fine < M.design(base).design.fine);
});

test("admixture dose = cc per kg binder, its water is deducted", () => {
  const r0 = M.design(base);
  const r = M.design({ ...base, admixtures: [{ name: "SP", dose: 3, sg: 1.2, solids: 40 }] });
  const a = r.admixtures[0];
  near(a.cc, 3 * r.binder, 1e-9); // binder 100 kg × 3 = 300 cc
  near(a.kg, a.cc * 1.2 / 1000, 1e-9);
  near(a.water, a.kg * 0.6, 1e-9);
  near(r.batch.water, r0.batch.water - a.water, 1e-9);
  near(r.design.fine, r0.design.fine, 1e-9);
});

test("slump interpolation between Table 6.3.3 range midpoints", () => {
  const i = M.SIZES.indexOf(25);
  assert.equal(M.mixingWater(false, 87.5, i), 193);
  near(M.mixingWater(false, 125, i), 193 + (202 - 193) * 37.5 / 75, 1e-9);
  assert.equal(M.mixingWater(false, 175, i), 202);
  near(M.mixingWater(false, 50, i), 179 + (193 - 179) * 12.5 / 50, 1e-9);
  assert.throws(() => M.design({ ...base, slump: 200 }));
});
