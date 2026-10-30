const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../fieldreport.js");

const job = (trucks, header = {}) => ({ header: { ordered: 210, produced: 0, ...header }, trucks });

test("plant from D/O prefix (plant code list)", () => {
  assert.equal(F.plantFromDO("0372610040130").name, "พระราม3-2 (สาธุประดิษฐ์ 2)");
  assert.equal(F.plantFromDO("0042610040087").name, "พระราม9/21");
  assert.equal(F.plantFromDO("0142610040116").name, "เพรชพระราม");
  assert.equal(F.plantFromDO("1062610040001").name, "บางพลี3");
  assert.equal(F.PLANTS.length, 54);
  assert.equal(new Set(F.PLANTS.map(([c]) => c)).size, 54); // no duplicate codes
  const none = F.plantFromDO("0002610040001");
  assert.equal(none.name, "");
  assert.equal(none.options.length, 0);
});

test("D/O checks: length, unknown plant", () => {
  assert.deepEqual(F.checkDO("0042610040087"), []);
  assert.match(F.checkDO("00426100400")[0], /11 หลัก/);
  assert.match(F.checkDO("9992610040087")[0], /ไม่พบหน่วยผลิต/);
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

test("D/O must never repeat, across all jobs on the device", () => {
  const jobs = [
    { id: "a", header: { project: "งาน A" }, trucks: [{ do: "0372610040130" }, { do: "0042610040087" }] },
    { id: "b", header: { project: "งาน B" }, trucks: [{ do: "0032610040165" }] },
  ];
  const sameJob = F.findDO("0042610040087", jobs, { jobId: "a" });
  assert.equal(sameJob.index, 1);
  assert.match(F.dupMessage(sameJob), /ลำดับที่ 2 ในงานนี้/);
  const other = F.findDO(" 0032610040165 ", jobs, { jobId: "a" });
  assert.match(F.dupMessage(other), /งาน "งาน B" ลำดับที่ 1/);
  assert.equal(F.findDO("0042610040087", jobs, { jobId: "a", index: 1 }), null); // the row itself
  assert.equal(F.findDO("0142610040116", jobs), null);
  assert.deepEqual([...F.duplicateRows([{ do: "1" }, { do: "2" }, { do: "1" }])].sort(), [0, 2]);
});

test("pages reconcile: carried + page total = cumulative = next page carried", () => {
  const trucks = Array.from({ length: 34 }, (_, i) => ({ do: String(i), volume: i % 5 === 0 ? 5.5 : 7 }));
  const p = F.pages(trucks);
  assert.equal(p[0].carried, 0);
  for (let i = 0; i < p.length; i++) {
    assert.equal(p[i].carried + p[i].total, p[i].cumulative);
    if (i > 0) assert.equal(p[i].carried, p[i - 1].cumulative);
  }
  const all = trucks.reduce((s, t) => s + t.volume, 0);
  assert.equal(p[p.length - 1].cumulative, all);
});

test("time alerts: concrete age 120, wait 30, travel 60, pour 30; crossing midnight", () => {
  const msg = (t) => F.timeAlerts(t).map((x) => x.text);
  assert.deepEqual(msg({ batching: "21:33", arrival: "22:00", start: "22:10", end: "22:30" }), []);
  assert.deepEqual(msg({ batching: "23:47", arrival: "00:20", start: "00:30", end: "00:55" }), []); // 68 min across midnight
  assert.deepEqual(msg({ batching: "22:00", arrival: "22:40", start: "23:40", end: "00:05" }),
    ["คอนกรีตเกินเวลา 125 นาที (เกณฑ์ 120)", "รถรอเท 60 นาที"]);
  assert.deepEqual(msg({ batching: "10:00", arrival: "11:15" }), ["เดินทาง 75 นาที"]);
  assert.deepEqual(msg({ batching: "10:00", arrival: "10:30", start: "10:35", end: "11:20" }), ["ใช้เวลาเท 45 นาที"]);
  // start and end are optional
  assert.deepEqual(msg({ batching: "10:00", arrival: "10:30" }), []);
  assert.deepEqual(msg({ arrival: "10:30" }), []);
});

test("time alerts: steps out of order", () => {
  assert.equal(F.timeAlerts({ batching: "10:00", arrival: "10:40", start: "10:20" })[0].text, "ตรวจเวลา: เริ่มเทก่อนรถถึง");
  assert.equal(F.timeAlerts({ batching: "10:00", arrival: "09:50" })[0].text, "ตรวจเวลา: รถถึงก่อนเวลาผลิต");
});

test("remark keeps what was typed and adds the alerts", () => {
  assert.equal(F.remarkWithAlerts({ remark: "ปั๊มเสีย", batching: "10:00", arrival: "11:15" }), "ปั๊มเสีย · เดินทาง 75 นาที");
  assert.equal(F.remarkWithAlerts({ remark: "", batching: "10:00", arrival: "10:30" }), "");
});

test("slump is shown and printed with ±2.5", () => {
  const FR = require("../fieldreport.js");
  assert.equal(FR.slumpText("12.5"), "12.5±2.5");
  assert.equal(FR.slumpText(10), "10±2.5");
  assert.equal(FR.slumpText(""), "");
  assert.equal(FR.slumpText("10±2.5"), "10±2.5");
});
