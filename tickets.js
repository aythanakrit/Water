/*
 * Ticket scan (สแกนตั๋ว): a list of scanned D/O numbers with repeats marked and counts per plant and ticket date.
 * A 13-digit D/O is plant (3) + YYMMDD (Christian year) + running number (4).
 * Pure functions shared by tickets.html and the tests; plant names come from FieldReport.plantFromDO.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./fieldreport.js"));
  else root.Tickets = factory(root.FieldReport);
})(typeof self !== "undefined" ? self : this, function (FieldReport) {
  "use strict";
  const LEN = 13;
  const digits = (s) => String(s == null ? "" : s).replace(/\D/g, "");
  const complete = (s) => digits(s).length === LEN;

  /** What a ticket number says: plant code and name, ticket date (yyyy-mm-dd), running number. */
  function parse(d) {
    const s = digits(d);
    const p = FieldReport.plantFromDO(s);
    const y = 2000 + Number(s.slice(3, 5)), m = s.slice(5, 7), dd = s.slice(7, 9);
    const ok = s.length === LEN && +m >= 1 && +m <= 12 && +dd >= 1 && +dd <= 31;
    return { code: s.slice(0, 3), plant: p.name || (p.options.length > 1 ? p.options.join(" / ") : ""), date: ok ? `${y}-${m}-${dd}` : "", seq: s.length === LEN ? Number(s.slice(9)) : null };
  }

  /** Add a scan; numbers run 1, 2, 3 …; a ticket already in the list is kept and marked. */
  function add(list, s, at) {
    const d = digits(s).slice(0, LEN);
    const first = list.find((e) => e.do === d);
    const e = { no: list.length + 1, do: d, at, dupOf: first ? first.no : null };
    list.push(e);
    return e;
  }
  /** Remove scan `no`; the rest are renumbered and repeats worked out again. */
  function remove(list, no) {
    const kept = list.filter((e) => e.no !== no);
    list.length = 0;
    kept.forEach((e) => add(list, e.do, e.at));
    return list;
  }
  /** Scan numbers of every ticket that appears more than once (the first scan included). */
  function duplicates(list) {
    const n = new Map();
    list.forEach((e) => n.set(e.do, (n.get(e.do) || 0) + 1));
    return new Set(list.filter((e) => n.get(e.do) > 1).map((e) => e.no));
  }

  /** Counts: scans, tickets (each number once), repeat scans, and tickets per plant and per ticket date. */
  function summary(list) {
    const seen = new Map();
    list.forEach((e) => { if (!seen.has(e.do)) seen.set(e.do, parse(e.do)); });
    const by = (key) => {
      const m = new Map();
      seen.forEach((p) => { const k = key(p); m.set(k, (m.get(k) || 0) + 1); });
      return [...m.entries()].map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key)));
    };
    const dupTickets = [...seen.keys()].filter((d) => list.filter((e) => e.do === d).length > 1).length;
    return {
      scans: list.length, tickets: seen.size, repeats: list.length - seen.size, dupTickets,
      plants: by((p) => p.plant || `ไม่พบรหัส ${p.code}`),
      dates: by((p) => p.date || "วันที่ไม่ถูกต้อง").sort((a, b) => String(a.key).localeCompare(String(b.key))),
    };
  }

  /** Rows for the Excel sheet (D/O stays text so its leading zeros are kept). */
  function rows(list, time) {
    const dup = duplicates(list);
    return list.map((e) => {
      const p = parse(e.do);
      return { "ลำดับ": e.no, "เลข D/O": e.do, "รหัสแพล้นท์": p.code, "หน่วยผลิต": p.plant, "วันที่ตั๋ว": p.date, "เลขรัน": p.seq,
        "เวลาสแกน": time(e.at), "ซ้ำ": e.dupOf ? `ซ้ำกับลำดับ ${e.dupOf}` : dup.has(e.no) ? "มีสแกนซ้ำ" : "" };
    });
  }

  return { LEN, digits, complete, parse, add, remove, duplicates, summary, rows };
});
