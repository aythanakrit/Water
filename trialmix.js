/*
 * Trial mix record (M Concrete Trial Mix form): slump and temperature every 30 min up to 180 min,
 * then unit weight, air content and bleeding. Pure functions shared by trial.html and the tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TrialMix = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MINUTES = [0, 30, 60, 90, 120, 150, 180];
  const ROW_FIELDS = ["air", "con", "cone", "flow"];

  const toMin = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const hhmm = (m) => {
    const x = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  };
  const num = (v) => (v === "" || v == null || !isFinite(Number(v)) ? null : Number(v));

  function newTrial(id, date) {
    const t = Date.now();
    return {
      id, created: t, updated: t, status: "open",
      header: { project: "", date: date || "", customer: "", code: "", truck: "", slump: "" },
      rows: MINUTES.map((min) => ({ min, time: "", air: "", con: "", cone: "", flow: "" })),
      unitWeight: "", airContent: "", bleeding: "", remark: "", photos: [],
    };
  }

  /** Planned clock time of each check: the 0-min time plus the row's minutes (crosses midnight). */
  function plannedTime(trial, i) {
    const start = toMin(trial.rows[0].time);
    return start == null ? "" : hhmm(start + trial.rows[i].min);
  }

  const rowHasData = (r) => ROW_FIELDS.some((k) => String(r[k] ?? "").trim() !== "");

  /** Slump loss (cm) of each row against the 0-min slump, cone and flow separately. */
  function slumpLoss(trial) {
    const c0 = num(trial.rows[0].cone), f0 = num(trial.rows[0].flow);
    return trial.rows.map((r) => {
      const c = num(r.cone), f = num(r.flow);
      return {
        cone: c0 == null || c == null ? null : Math.round((c0 - c) * 10) / 10,
        flow: f0 == null || f == null ? null : Math.round((f0 - f) * 10) / 10,
      };
    });
  }

  /** Last checked minute at which the slump was still at least the required slump (header), or null. */
  function holdsSlumpUntil(trial) {
    const target = num(trial.header.slump);
    if (target == null) return null;
    let last = null;
    for (const r of trial.rows) {
      const v = num(r.cone) ?? num(r.flow);
      if (v == null) continue;
      if (v < target) break;
      last = r.min;
    }
    return last;
  }

  /**
   * Photo slots, in the order they follow the main page in the PDF.
   * Slump has one slot per check (any of the 7 may be left empty).
   */
  const PHOTO_SLOTS = [
    { key: "mix", label: "มิกซ์ที่ใช้ในการผลิต" },
    { key: "plant", label: "หน้าจอผลิต" },
    { key: "scale", label: "หน้าจอตาชั่ง" },
    { key: "ticket", label: "หน้าตั๋ว" },
    ...MINUTES.map((m, i) => ({ key: "slump" + (i + 1), label: `สลัม ครั้งที่ ${i + 1} (${m} นาที)` })),
    { key: "sample", label: "ภาพเก็บลูกปูน / Slip Test" },
  ];
  const slotIndex = (key) => PHOTO_SLOTS.findIndex((s) => s.key === key);

  /** Photos in PDF order (slot order, then the order they were added), each with its caption. */
  function orderedPhotos(trial) {
    const ps = (trial.photos || []).filter((p) => slotIndex(p.slot) >= 0)
      .slice().sort((a, b) => slotIndex(a.slot) - slotIndex(b.slot) || a.added - b.added);
    return ps.map((p) => {
      const same = ps.filter((x) => x.slot === p.slot);
      const label = PHOTO_SLOTS[slotIndex(p.slot)].label;
      return { ...p, caption: same.length > 1 ? `${label} (${same.indexOf(p) + 1}/${same.length})` : label };
    });
  }

  /** Rows filled so far (for the list view). */
  const filledRows = (trial) => trial.rows.filter(rowHasData).length;

  return { MINUTES, ROW_FIELDS, PHOTO_SLOTS, toMin, hhmm, newTrial, plannedTime, rowHasData, slumpLoss, holdsSlumpUntil, orderedPhotos, filledRows };
});
