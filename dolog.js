/*
 * D/O ticket log: type (or scan) a ticket number; at 13 digits it is saved at once and numbered 1, 2, 3 …
 * A number already in the list is saved as well, marked as a duplicate of the earlier entry.
 * Pure functions shared by do-log.html and the tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DoLog = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LEN = 13;
  const digits = (s) => String(s == null ? "" : s).replace(/\D/g, "");

  /** True when the typed text is a whole ticket number and should be saved now. */
  const complete = (s) => digits(s).length === LEN;

  /** Add a ticket; returns the entry with its running number and, when the number repeats, the earlier entry's number. */
  function add(list, s, at) {
    const d = digits(s).slice(0, LEN);
    const first = list.findIndex((e) => e.do === d);
    const entry = { no: list.length + 1, do: d, at, dupOf: first >= 0 ? list[first].no : null };
    list.push(entry);
    return entry;
  }

  /** Remove entry `no`; the rest are renumbered 1, 2, 3 … and repeat marks worked out again. */
  function remove(list, no) {
    const kept = list.filter((e) => e.no !== no);
    list.length = 0;
    kept.forEach((e) => add(list, e.do, e.at));
    return list;
  }

  /** Numbers of the entries whose ticket appears more than once (the first one included). */
  function duplicates(list) {
    const count = new Map();
    list.forEach((e) => count.set(e.do, (count.get(e.do) || 0) + 1));
    return new Set(list.filter((e) => count.get(e.do) > 1).map((e) => e.no));
  }

  /** Tab-separated lines for pasting into Excel: ลำดับ, D/O, เวลา, ซ้ำ */
  function toText(list, time) {
    const dup = duplicates(list);
    return ["ลำดับ\tD/O\tเวลาบันทึก\tซ้ำ"].concat(list.map((e) => `${e.no}\t${e.do}\t${time(e.at)}\t${dup.has(e.no) ? "ซ้ำ" : ""}`)).join("\n");
  }

  return { LEN, digits, complete, add, remove, duplicates, toText };
});
