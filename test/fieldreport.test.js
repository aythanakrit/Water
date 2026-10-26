const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../fieldreport.js");

const job = (trucks, header = {}) => ({ header: { ordered: 210, produced: 0, ...header }, trucks });

test("plant from D/O prefix (Template sheet VLOOKUP)", () => {
  assert.equal(F.plantFromDO("0372610040130").name, "พระราม 3 - 2");
  assert.equal(F.plantFromDO("0042610040087").name, "พระราม9 (2)");
  assert.equal(F.plantFromDO("0142610040116").name, "เพรชพระราม-1");
  const amb = F.plantFromDO("0002610040001");
  assert.equal(amb.name, "");
  assert.equal(amb.options.length, 2);
});

test("D/O checks: length, unknown plant, duplicate", () => {
  const trucks = [{ do: "0372610040130" }];
  assert.deepEqual(F.checkDO("0042610040087", trucks), []);
  assert.match(F.checkDO("0372610040130", trucks)[0], /ซ้ำกับลำดับที่ 1/);
  assert.deepEqual(F.checkDO("0372610040130", trucks, 0), []);
  assert.match(F.checkDO("00426100400", trucks)[0], /11 หลัก/);
  assert.match(F.checkDO("9992610040087", trucks)[0], /ไม่พบหน่วยผลิต/);
});

test("summary matches the sheet header formulas", () => {
  const trucks = [{ do: "1", volume: 7 }, { do: "2", volume: 7 }, { do: "", volume: 7 }];
  const s = F.summary(job(trucks, { produced: 28 }));
  assert.equal(s.received, 14);          // SUMIF(D,"<>",E)
  assert.equal(s.inTransit, 14);         // H4 − L2
  assert.equal(s.remaining, 182);        // H2 − H4
  assert.equal(s.pct, 28 / 210);         // H4 / H2
});

test("15 trucks per printed page with page totals", () => {
  const trucks = Array.from({ length: 31 }, (_, i) => ({ do: String(i), volume: i === 30 ? 3.5 : 7 }));
  const p = F.pages(trucks);
  assert.equal(p.length, 3);
  assert.equal(p[0].rows.length, 15);
  assert.equal(p[0].total, 105);
  assert.equal(p[2].total, 3.5);
  assert.equal(F.pages([]).length, 1);
});
