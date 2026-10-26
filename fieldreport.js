/*
 * Field report (ใบรายงานสนามและเก็บก้อนตัวอย่าง, FM-PQ-10) logic, following the
 * plant's Excel sheet: plant looked up from the first 3 digits of the D/O number,
 * order / received / produced totals, and 15 trucks per printed page.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FieldReport = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Template sheet B5:C16 — D/O prefix → plant
  const PLANTS = [
    ["003", "คลองตัน"], ["004", "พระราม9 (2)"], ["014", "เพรชพระราม-1"],
    ["036", "พระราม 3 - 1"], ["037", "พระราม 3 - 2"], ["033", "สุขสวัสดิ์ 1"],
    ["040", "สุขสวัสดิ์ 2"], ["005", "สรรพาวุธ 1"], ["013", "สรรพาวุธ 2"],
    ["039", "ราชพฤกษ์"], ["000", "สิรินธร"], ["000", "งามวงศ์วาน"],
  ];
  const ROWS_PER_PAGE = 15;
  const DO_LENGTH = 13;

  const cleanDO = (s) => String(s ?? "").replace(/\s+/g, "");

  /** Plant from D/O prefix; a prefix shared by several plants is ambiguous. */
  function plantFromDO(doNo) {
    const code = cleanDO(doNo).slice(0, 3);
    const hits = PLANTS.filter(([c]) => c === code).map(([, n]) => n);
    return { code, name: hits.length === 1 ? hits[0] : "", options: hits };
  }

  /** Warnings for a D/O entry: format and duplicates within the job. */
  function checkDO(doNo, trucks, selfIndex = -1) {
    const d = cleanDO(doNo);
    const out = [];
    if (!d) return out;
    if (!/^\d+$/.test(d)) out.push("D/O มีตัวอักษรที่ไม่ใช่ตัวเลข");
    else if (d.length !== DO_LENGTH) out.push(`D/O ยาว ${d.length} หลัก (ปกติ ${DO_LENGTH} หลัก)`);
    const p = plantFromDO(d);
    if (p.options.length === 0) out.push(`ไม่พบหน่วยผลิตรหัส ${p.code}`);
    if (p.options.length > 1) out.push(`รหัส ${p.code} ซ้ำกันหลายหน่วยผลิต (${p.options.join(", ")}) — เลือกเอง`);
    const dup = trucks.findIndex((t, i) => i !== selfIndex && cleanDO(t.do) === d);
    if (dup >= 0) out.push(`D/O ซ้ำกับลำดับที่ ${dup + 1}`);
    return out;
  }

  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };

  /** Header totals from the sheet: ยอดสั่ง, ยอดรับ, ยอดผลิต, ระหว่างทาง, อีก…คิวครบ, % */
  function summary(job) {
    const ordered = num(job.header.ordered);
    const produced = num(job.header.produced);
    const received = job.trucks.filter((t) => cleanDO(t.do)).reduce((s, t) => s + num(t.volume), 0);
    return {
      ordered, produced, received,
      inTransit: produced - received,
      remaining: ordered - produced,
      pct: ordered > 0 ? produced / ordered : null,
      trucks: job.trucks.length,
    };
  }

  /** Split trucks into printed pages of 15 with the page volume total. */
  function pages(trucks, size = ROWS_PER_PAGE) {
    const out = [];
    for (let i = 0; i < Math.max(trucks.length, 1); i += size) {
      const rows = trucks.slice(i, i + size);
      out.push({ start: i, rows, total: rows.reduce((s, t) => s + num(t.volume), 0) });
    }
    return out;
  }

  const pad = (n) => String(n).padStart(2, "0");
  const nowHHMM = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  function newTruck(prev) {
    return {
      truck: "", do: "", volume: prev ? prev.volume : 7, plant: "",
      batching: "", arrival: "", start: "", end: "",
      airTemp: "", conTemp: "", slump: "",
      sampleType: "", sampleQty: "", label: "", remark: "", operator: "",
    };
  }

  function newJob(id, today) {
    return {
      id, status: "open", created: Date.now(), updated: Date.now(),
      header: {
        project: "", customer: "", structure: "", structureNo: "", date: today || "",
        tech: "", phone: "", productCode: "", cube: "", cylinder: "", ordered: "", produced: "",
      },
      trucks: [],
    };
  }

  return { PLANTS, ROWS_PER_PAGE, cleanDO, plantFromDO, checkDO, summary, pages, nowHHMM, newTruck, newJob };
});
