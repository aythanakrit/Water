/*
 * Contact list (รายชื่อผู้ติดต่อ): everyone registers once, everyone sees everyone.
 * The admin keeps the departments and their positions in order; the list is shown
 * as an org chart: department → position (in the admin's order) → name.
 * Pure functions shared by contacts.html, the Apps Script backend and the tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Contacts = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FIELDS = ["first", "last", "nick", "phone", "plant", "dept", "pos"];
  const NO_DEPT = "ยังไม่ระบุแผนก";
  const NO_POS = "ยังไม่ระบุตำแหน่ง";

  const digits = (s) => String(s == null ? "" : s).replace(/\D/g, "");
  /** Thai phone numbers: 10 digits starting with 0 (mobile) or 9 digits starting with 0 (Bangkok landline). */
  function cleanPhone(s) {
    let d = digits(s);
    if (d.startsWith("66") && d.length >= 11) d = "0" + d.slice(2);
    return d;
  }
  const phoneOk = (s) => /^0\d{8,9}$/.test(cleanPhone(s));
  /** 0812345678 → 081-234-5678, 021234567 → 02-123-4567 */
  function showPhone(s) {
    const d = cleanPhone(s);
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return d;
  }

  /** Trimmed fields and a list of what is missing or wrong (Thai messages). */
  function check(c) {
    const o = {};
    FIELDS.forEach((k) => { o[k] = String(c[k] == null ? "" : c[k]).trim().replace(/\s+/g, " "); });
    o.phone = cleanPhone(o.phone);
    const err = [];
    if (!o.first) err.push("ใส่ชื่อ");
    if (!o.last) err.push("ใส่นามสกุล");
    if (!phoneOk(o.phone)) err.push("เบอร์โทรไม่ถูกต้อง (ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0)");
    if (!o.plant) err.push("เลือกแพล้น");
    return { contact: o, errors: err };
  }

  /** Settings as the admin left them: [{ name, positions: [..] }], cleaned of blanks and repeats. */
  function cleanSettings(s) {
    const seen = new Set();
    const depts = (s && Array.isArray(s.depts) ? s.depts : []).map((d) => ({
      name: String(d.name || "").trim(),
      positions: [...new Set((d.positions || []).map((p) => String(p).trim()).filter(Boolean))],
    })).filter((d) => d.name && !seen.has(d.name) && seen.add(d.name));
    return { depts };
  }

  /**
   * Org chart: departments in the admin's order (people in a department the admin has not listed come
   * after, then those with none), positions in the department's order, then by first name.
   * Returns [{ dept, groups: [{ pos, people: [..] }], count }].
   */
  function orgChart(people, settings) {
    const order = cleanSettings(settings).depts;
    const dIdx = (n) => { const i = order.findIndex((d) => d.name === n); return i < 0 ? (n ? order.length : order.length + 1) : i; };
    const byDept = new Map();
    people.forEach((p) => {
      const d = p.dept || NO_DEPT;
      if (!byDept.has(d)) byDept.set(d, []);
      byDept.get(d).push(p);
    });
    return [...byDept.entries()]
      .sort(([a], [b]) => dIdx(a === NO_DEPT ? "" : a) - dIdx(b === NO_DEPT ? "" : b) || a.localeCompare(b, "th"))
      .map(([dept, ps]) => {
        const positions = (order.find((d) => d.name === dept) || { positions: [] }).positions;
        const pIdx = (n) => { const i = positions.indexOf(n); return i < 0 ? (n ? positions.length : positions.length + 1) : i; };
        const byPos = new Map();
        ps.forEach((p) => { const k = p.pos || NO_POS; if (!byPos.has(k)) byPos.set(k, []); byPos.get(k).push(p); });
        const groups = [...byPos.entries()]
          .sort(([a], [b]) => pIdx(a === NO_POS ? "" : a) - pIdx(b === NO_POS ? "" : b) || a.localeCompare(b, "th"))
          .map(([pos, list]) => ({ pos, people: list.sort((x, y) => x.first.localeCompare(y.first, "th") || x.last.localeCompare(y.last, "th")) }));
        return { dept, groups, count: ps.length };
      });
  }

  /** Search name, nickname, phone, plant, department or position. */
  function matches(p, q) {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return true;
    const d = digits(s);
    const hay = [p.first, p.last, p.nick, p.plant, p.dept, p.pos].join(" ").toLowerCase();
    return s.split(/\s+/).every((w) => hay.includes(w)) || (d.length >= 3 && cleanPhone(p.phone).includes(d));
  }

  return { FIELDS, NO_DEPT, NO_POS, cleanPhone, phoneOk, showPhone, check, cleanSettings, orgChart, matches };
});
