/*
 * Photos attached to a special-project report (รายงานโครงการ): slump at the plant, slump on site
 * and the plant printout, one per truck, matched to the report's trucks by D/O number.
 * Pure helpers shared by field.html and the tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ReportPhotos = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // In the order they appear in the report PDF (after the field report pages)
  const KINDS = [
    { key: "printout", title: "Printout", dept: "ส่วนงานผู้ดูแล", locked: true, stamp: false }, // administrator only
    { key: "plant", title: "ชักสลัมก่อนออกแพล้น", dept: "ส่วนงานผลิต", stamp: true },
    { key: "site", title: "ชักสลัมหน้างาน", dept: "ส่วนงานคิวซี", stamp: true },
  ];
  const PER_PAGE = 4;

  const digits = (s) => String(s == null ? "" : s).replace(/\D/g, "");
  const pad = (n) => String(n).padStart(2, "0");

  /** 30/10/2569 14:35 (Buddhist year, 24-hour) */
  function stampText(ms) {
    const d = new Date(ms);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear() + 543} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /**
   * Photos of one kind in report order: by the truck's row (matched on D/O), then by time.
   * Returns [{ photo, no, truck }]; no/truck are empty for a D/O not in the report.
   */
  function forReport(photos, trucks, kind) {
    const idx = new Map();
    (trucks || []).forEach((t, i) => { const d = digits(t.do); if (d && !idx.has(d)) idx.set(d, i); });
    return photos.filter((p) => p.kind === kind).map((p) => {
      const i = idx.has(digits(p.do)) ? idx.get(digits(p.do)) : -1;
      return { photo: p, i, no: i >= 0 ? i + 1 : "", truck: i >= 0 ? trucks[i].truck || "" : "" };
    }).sort((a, b) => (a.i < 0 ? 1e9 : a.i) - (b.i < 0 ? 1e9 : b.i) || (a.photo.takenAt || 0) - (b.photo.takenAt || 0))
      .map(({ photo, no, truck }) => ({ photo, no, truck }));
  }

  /** Report rows (1-based) whose D/O has no photo of this kind yet. */
  function missing(photos, trucks, kind) {
    const have = new Set(photos.filter((p) => p.kind === kind).map((p) => digits(p.do)));
    return (trucks || []).map((t, i) => (digits(t.do) && !have.has(digits(t.do)) ? i + 1 : 0)).filter(Boolean);
  }

  const chunk = (list, n = PER_PAGE) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

  return { KINDS, PER_PAGE, stampText, forReport, missing, chunk };
});
