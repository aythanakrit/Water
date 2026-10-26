const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../evaluate.js");

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (±${tol})`);

const PASTE = [
  "รายการวัตถุดิบ\tปริมาณ/คิว (กก.)\tปริมาณที่ใช้ต่องานนี้ (กก.)",
  "ROC0101 (หิน 3/4'')\t1,000.00\t30,000.00",
  "SAN0101 (ทรายหยาบ)\t815.00\t24,450.00",
  "CEM0101 (ปูนซีเมนต์นครหลวง Type 1)\t345.00\t10,350.00",
  "PFA0101 (เถ้าลอยแม่เมาะ)\t215.00\t6,450.00",
  "WAT0101 (น้ำ)\t125.00\t3,750.00",
  "ADM0502 (Concera sa 8689 (Type F))\t10,065.00\t301,950.00",
].join("\n");

test("parse batching table and detect kinds from item codes", () => {
  const rows = E.parseTable(PASTE);
  assert.deepEqual(rows.map((r) => r.kind), ["coarse", "fine", "cement", "flyAsh", "water", "admix"]);
  assert.equal(rows[5].qty, 10065);
});

test("strength from w/cm — Table 6.3.4(a) inverse", () => {
  assert.equal(E.strengthFromWc(0.54).fc, 30);
  near(E.strengthFromWc(0.505).fc, 32.5, 1e-9);
  assert.equal(E.strengthFromWc(0.30).outOfRange, "low");
});

test("evaluate the 30 m³ job", () => {
  const sg = { coarse: 2.68, fine: 2.64, cement: 3.15, flyAsh: 2.2, water: 1 };
  const rows = E.parseTable(PASTE).map((r) => ({ ...r, sg: sg[r.kind] }));
  const r = E.evaluate({ rows, air: 1.5, sandMoisture: 0, volume: 30 });
  assert.equal(r.binder, 560);
  near(r.wcm, 125 / 560, 1e-12);
  near(r.wc, 125 / 345, 1e-12);
  near(r.scmPct, 215 / 560 * 100, 1e-9);
  const adm = r.items[5];
  near(adm.dose, 10065 / 560, 1e-9);
  assert.equal(adm.kg, null); // no density given
  const v = 1000 / 2680 + 815 / 2640 + 345 / 3150 + 215 / 2200 + 0.125 + 0.010065 + 0.015;
  near(r.volume, v, 1e-12);
  near(r.job.produced, 30 * v, 1e-9);
  assert.equal(r.strength.outOfRange, "low");
});

test("sand surface moisture and admixture water count as mixing water", () => {
  const rows = [
    { name: "c", kind: "cement", qty: 400, sg: 3.15 },
    { name: "w", kind: "water", qty: 160, sg: 1 },
    { name: "s", kind: "fine", qty: 800, sg: 2.64 },
    { name: "a", kind: "admix", qty: 4000, sg: 1.2, solids: 40 },
  ];
  const r = E.evaluate({ rows, air: 0, sandMoisture: 5 });
  near(r.freeWater, 160 + 40 + 4.8 * 0.6, 1e-9);
});
