/*
 * Reverse check of a batched mix: from material quantities per m³ back to
 * w/c, w/cm, admixture dose, absolute-volume yield and unit weight, plus a
 * rough strength estimate from ACI 211.1 Table 6.3.4(a).
 *
 * Aggregate quantities are taken as SSD unless a surface moisture is given.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MixEvaluate = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KINDS = {
    coarse: "หิน", fine: "ทราย", cement: "ปูนซีเมนต์", flyAsh: "เถ้าลอย", slag: "Slag",
    water: "น้ำ", admix: "สารผสมเพิ่ม", other: "อื่นๆ",
  };
  const BINDER = ["cement", "flyAsh", "slag"];

  // Item-code prefixes used in the plant's batching system
  const PREFIX = { ROC: "coarse", SAN: "fine", CEM: "cement", PFA: "flyAsh", FLY: "flyAsh", SLA: "slag", GGB: "slag", WAT: "water", ADM: "admix" };

  function kindFromName(name) {
    const code = String(name).trim().slice(0, 3).toUpperCase();
    if (PREFIX[code]) return PREFIX[code];
    if (/หิน/.test(name)) return "coarse";
    if (/ทราย/.test(name)) return "fine";
    if (/ปูน|cement/i.test(name)) return "cement";
    if (/เถ้า|fly ?ash/i.test(name)) return "flyAsh";
    if (/slag/i.test(name)) return "slag";
    if (/น้ำ|water/i.test(name)) return "water";
    if (/type [a-g]\b|admix|น้ำยา/i.test(name)) return "admix";
    return "other";
  }

  /**
   * Parse a table copied from the batching screen. Each line:
   * "<code (name)> <qty per m³> [<qty per job>]" separated by tabs or 2+ spaces.
   */
  function parseTable(text) {
    const rows = [];
    for (const line of String(text).split(/\r?\n/)) {
      const cells = line.split(/\t| {2,}/).map((c) => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;
      const qty = Number(cells[1].replace(/,/g, ""));
      if (!isFinite(qty) || /^รายการ/.test(cells[0])) continue;
      rows.push({ name: cells[0], kind: kindFromName(cells[0]), qty });
    }
    return rows;
  }

  // Table 6.3.4(a), non-air-entrained: w/c → 28-day cylinder strength (MPa)
  const WC = [0.42, 0.47, 0.54, 0.61, 0.69, 0.79];
  const FC = [40, 35, 30, 25, 20, 15];

  function strengthFromWc(wc) {
    if (wc < WC[0]) return { fc: FC[0], outOfRange: "low" };
    if (wc > WC[WC.length - 1]) return { fc: FC[FC.length - 1], outOfRange: "high" };
    for (let i = 1; i < WC.length; i++) {
      if (wc <= WC[i]) {
        const t = (wc - WC[i - 1]) / (WC[i] - WC[i - 1]);
        return { fc: FC[i - 1] + t * (FC[i] - FC[i - 1]) };
      }
    }
  }

  /**
   * @param {object} p
   * rows: [{ name, kind, qty, sg, solids }]  qty in kg/m³ (admix: cc/m³)
   * air %, sandMoisture % (surface moisture of fine aggregate, 0 = SSD)
   * volume: job volume (m³)
   */
  function evaluate(p) {
    const warnings = [];
    const sum = (kind) => p.rows.filter((r) => r.kind === kind).reduce((t, r) => t + r.qty, 0);
    const mass = {};
    Object.keys(KINDS).forEach((k) => { if (k !== "admix") mass[k] = sum(k); });

    const binder = BINDER.reduce((t, k) => t + mass[k], 0);
    if (!(binder > 0)) throw new Error("ไม่พบปูนหรือวัสดุประสานในรายการ");

    // Surface water of the sand counts as mixing water
    const sandWater = mass.fine * (p.sandMoisture || 0) / 100;

    const items = p.rows.map((r) => {
      if (r.kind === "admix") {
        const kg = r.sg ? r.qty * r.sg / 1000 : null;
        const water = kg != null ? kg * (1 - (r.solids ?? 100) / 100) : 0;
        return { ...r, cc: r.qty, kg, water, dose: r.qty / binder, volume: r.qty / 1e6 };
      }
      if (!(r.sg > 0)) warnings.push(`${r.name}: ยังไม่ได้กรอก ถ.พ. — ไม่นับปริมาตร`);
      return { ...r, kg: r.qty, volume: r.sg > 0 ? r.qty / (r.sg * 1000) : 0 };
    });

    const admixWater = items.reduce((t, r) => t + (r.water || 0), 0);
    const freeWater = mass.water + sandWater + admixWater;
    const air = (p.air || 0) / 100;

    const solidsVolume = items.reduce((t, r) => t + r.volume, 0);
    // Batched water already has its volume in items; sand surface water adds to it
    const volume = solidsVolume + sandWater / 1000 + air;
    const totalMass = items.reduce((t, r) => t + (r.kg || 0), 0);

    const wc = freeWater / (mass.cement || NaN);
    const wcm = freeWater / binder;
    const scmPct = (mass.flyAsh + mass.slag) / binder * 100;
    const est = strengthFromWc(wcm);

    if (est.outOfRange === "low") warnings.push(`w/cm = ${wcm.toFixed(3)} ต่ำกว่าช่วงตาราง ACI 211.1 (0.42) — ประเมินกำลังจากตารางไม่ได้ ต้องใช้ผลทดสอบจริง`);
    if (est.outOfRange === "high") warnings.push(`w/cm = ${wcm.toFixed(3)} สูงกว่าช่วงตาราง ACI 211.1 (0.79)`);
    if (scmPct > 0) warnings.push(`มีวัสดุประสาน ${scmPct.toFixed(1)}% — กำลังจากตาราง ACI (ปูนล้วน) มักสูงกว่าจริงที่ 28 วัน`);
    if (mass.flyAsh / binder > 0.35) warnings.push(`เถ้าลอย ${(mass.flyAsh / binder * 100).toFixed(1)}% ของ binder ค่อนข้างสูง — ตรวจกำลังช่วงอายุต้น`);
    const yieldDiff = (volume - 1) * 100;
    if (Math.abs(yieldDiff) > 2) warnings.push(`ปริมาตรจริงต่างจาก 1 m³ อยู่ ${yieldDiff > 0 ? "+" : ""}${yieldDiff.toFixed(1)}% — ตรวจ ถ.พ., ความชื้น หรือสัดส่วน`);

    const job = p.volume || 0;
    return {
      mass, binder, sandWater, admixWater, freeWater,
      wc, wcm, scmPct,
      items, air, volume, yieldDiff,
      totalMass, unitWeight: totalMass / volume,
      strength: est,
      job: { volume: job, produced: job * volume, items: items.map((r) => ({ name: r.name, kind: r.kind, qty: r.qty * job })) },
      warnings,
    };
  }

  return { KINDS, kindFromName, parseTable, strengthFromWc, evaluate };
});
