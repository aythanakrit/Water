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

  // Plant codes (P + first 3 digits of the D/O number) → plant name
  const PLANTS = [
    ["003", "คลองตัน"], ["004", "พระราม9/21"], ["014", "เพรชพระราม"],
    ["035", "เพรชพระราม 2"], ["005", "สรรพาวุธ 1"], ["013", "สรรพาวุธ(2)"],
    ["006", "บางกอกมอลล์"], ["027", "บางพลี"], ["106", "บางพลี3"],
    ["058", "บางปู"], ["085", "บางนา กม.36 (หอมศิล)"], ["033", "สุขสวัสดิ์"],
    ["040", "สุขสวัสดิ์2"], ["036", "พระราม3-1 (สาธุประดิษฐ์)"], ["037", "พระราม3-2 (สาธุประดิษฐ์ 2)"],
    ["022", "เซนทรัล เอ็มบาสซี"], ["067", "งามวงศ์วาน"], ["002", "รามคำแหง"],
    ["050", "เทพรักษ์"], ["019", "เมืองทอง"], ["049", "ลำลูกกาคลอง 7"],
    ["053", "เชียงราก"], ["061", "เชียงราก2"], ["023", "สิรินธร"],
    ["039", "ราชพฤกษ์"], ["046", "ประปามหาสวัสดิ์"], ["025", "บ้านแพ้ว"],
    ["016", "พระราม2"], ["024", "พระราม2-2"], ["086", "พานทอง"],
    ["105", "พานทอง 2"], ["065", "พัทยา2"], ["068", "พัทยา3"],
    ["087", "อู่ตะเภา"], ["066", "ระยอง(หนองระลอก) 1"], ["071", "มาบตาพุด"],
    ["077", "ระยอง(ปิ่นทอง)"], ["084", "หนองใหญ่"], ["088", "หนองใหญ่ 2"],
    ["075", "ภูเก็ต (ศรีสุนทร)"], ["079", "ภูเก็ต (ไม้ขาว)"], ["082", "ภูเก็ต (ลายัน)"],
    ["097", "ประจวบคิรีขันธ์"], ["103", "ประจวบคิรีขันธ์2"], ["098", "ชุมพร"],
    ["104", "ชุมพร2"], ["072", "มหาสารคาม"], ["074", "ร้อยเอ็ด"],
    ["095", "มุกดาหาร"], ["100", "มุกดาหาร2"], ["096", "อุบลราชธานี 1"],
    ["101", "อุบลราชธานี 2"], ["099", "ชัยภูมิ"], ["102", "ชัยภูมิ2"],
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

  /** Warnings for a D/O entry: format and plant code (duplicates: see findDO). */
  function checkDO(doNo) {
    const d = cleanDO(doNo);
    const out = [];
    if (!d) return out;
    if (!/^\d+$/.test(d)) out.push("D/O มีตัวอักษรที่ไม่ใช่ตัวเลข");
    else if (d.length !== DO_LENGTH) out.push(`D/O ยาว ${d.length} หลัก (ปกติ ${DO_LENGTH} หลัก)`);
    const p = plantFromDO(d);
    if (p.options.length === 0) out.push(`ไม่พบหน่วยผลิตรหัส ${p.code}`);
    if (p.options.length > 1) out.push(`รหัส ${p.code} ซ้ำกันหลายหน่วยผลิต (${p.options.join(", ")}) — เลือกเอง`);
    return out;
  }

  /**
   * D/O numbers must never repeat. Look in every job on this device:
   * returns where the number is already used, or null. `skip` = { jobId, index } of the row being edited.
   */
  function findDO(doNo, jobs, skip = {}) {
    const d = cleanDO(doNo);
    if (!d) return null;
    for (const j of jobs) {
      const i = j.trucks.findIndex((t, k) => cleanDO(t.do) === d && !(j.id === skip.jobId && k === skip.index));
      if (i >= 0) return { jobId: j.id, project: j.header.project, index: i, sameJob: j.id === skip.jobId };
    }
    return null;
  }

  const dupMessage = (hit) => hit.sameJob
    ? `D/O นี้บันทึกไปแล้ว — ลำดับที่ ${hit.index + 1} ในงานนี้`
    : `D/O นี้บันทึกไปแล้ว — งาน "${hit.project || "(ไม่มีชื่อ)"}" ลำดับที่ ${hit.index + 1}`;

  /** Row indexes in a job whose D/O appears more than once (e.g. after importing a backup). */
  function duplicateRows(trucks) {
    const seen = new Map(), out = new Set();
    trucks.forEach((t, i) => {
      const d = cleanDO(t.do); if (!d) return;
      if (seen.has(d)) { out.add(i); out.add(seen.get(d)); } else seen.set(d, i);
    });
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

  /**
   * Split trucks into printed pages of 15. Each page carries the volume brought
   * forward from earlier pages, its own total and the running total, so the pages
   * reconcile: carried + total = cumulative = next page's carried.
   */
  function pages(trucks, size = ROWS_PER_PAGE) {
    const out = [];
    let carried = 0;
    for (let i = 0; i < Math.max(trucks.length, 1); i += size) {
      const rows = trucks.slice(i, i + size);
      const total = rows.reduce((s, t) => s + num(t.volume), 0);
      out.push({ start: i, rows, carried, total, cumulative: carried + total });
      carried += total;
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

  return { PLANTS, ROWS_PER_PAGE, cleanDO, plantFromDO, checkDO, findDO, dupMessage, duplicateRows, summary, pages, nowHHMM, newTruck, newJob };
});
