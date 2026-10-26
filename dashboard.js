/*
 * Delivery dashboard: totals and time performance from field-report jobs.
 * Pure functions over jobs ({ id, header, status, trucks }) so the page and tests share them.
 * Time rules come from FieldReport.timeAlerts (same limits as the field report).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./fieldreport.js"));
  else root.Dashboard = factory(root.FieldReport);
})(typeof self !== "undefined" ? self : this, function (FieldReport) {
  "use strict";

  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const clock = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const span = (a, b) => (a == null || b == null ? null : (b - a + 1440) % 1440);
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  /** One row per delivered truck (has a D/O), with its job and time spans in minutes. */
  function trips(jobs, { from, to, plant } = {}) {
    const out = [];
    jobs.forEach((j) => {
      if (j.status === "deleted") return;
      const date = j.header.date || "";
      if (from && date < from) return;
      if (to && date > to) return;
      (j.trucks || []).forEach((t) => {
        if (!String(t.do || "").trim()) return;
        if (plant && t.plant !== plant) return;
        const b = clock(t.batching), a = clock(t.arrival), s = clock(t.start), e = clock(t.end);
        const alerts = FieldReport.timeAlerts(t);
        out.push({
          date, jobId: j.id, project: j.header.project || "(ไม่มีชื่อ)", customer: j.header.customer || "",
          truck: t.truck, do: t.do, plant: t.plant || "(ไม่ระบุ)", volume: num(t.volume),
          travel: span(b, a), wait: span(a, s), pour: span(s, e), age: span(b, e),
          slump: t.slump === "" || t.slump == null ? null : num(t.slump),
          conTemp: t.conTemp === "" || t.conTemp == null ? null : num(t.conTemp),
          alerts, bad: alerts.some((x) => x.level === "bad"), late: alerts.length > 0,
          orderError: alerts.some((x) => x.text.startsWith("ตรวจเวลา")),
        });
      });
    });
    return out;
  }

  // averages ignore trips whose times are out of order
  const times = (rows, k) => rows.filter((r) => !r.orderError && r[k] != null).map((r) => r[k]);

  function stats(rows) {
    const L = FieldReport.LIMITS;
    const count = (k, lim) => times(rows, k).filter((x) => x > lim).length;
    return {
      trips: rows.length,
      volume: rows.reduce((s, r) => s + r.volume, 0),
      jobs: new Set(rows.map((r) => r.jobId)).size,
      avgTravel: avg(times(rows, "travel")), avgWait: avg(times(rows, "wait")),
      avgPour: avg(times(rows, "pour")), avgAge: avg(times(rows, "age")),
      overAge: count("age", L.age), overWait: count("wait", L.wait),
      overTravel: count("travel", L.travel), overPour: count("pour", L.pour),
      orderErrors: rows.filter((r) => r.orderError).length,
      flagged: rows.filter((r) => r.late).length,
      avgSlump: avg(rows.filter((r) => r.slump != null).map((r) => r.slump)),
      maxConTemp: rows.some((r) => r.conTemp != null) ? Math.max(...rows.filter((r) => r.conTemp != null).map((r) => r.conTemp)) : null,
    };
  }

  /** Group rows by a key and compute stats for each group, largest volume first. */
  function groupBy(rows, key) {
    const g = new Map();
    rows.forEach((r) => { const k = typeof key === "function" ? key(r) : r[key]; if (!g.has(k)) g.set(k, []); g.get(k).push(r); });
    return [...g].map(([k, rs]) => ({ key: k, ...stats(rs) })).sort((a, b) => b.volume - a.volume);
  }

  /** Volume per day for every day in [from, to], zero-filled. */
  function daily(rows, from, to) {
    const by = {};
    rows.forEach((r) => { by[r.date] = (by[r.date] || 0) + r.volume; });
    const days = [];
    if (!from || !to) return Object.keys(by).sort().map((d) => ({ date: d, volume: by[d] }));
    for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      days.push({ date: k, volume: by[k] || 0 });
    }
    return days;
  }

  /** CSV of the trips (Excel opens UTF-8 with BOM). */
  function toCSV(rows) {
    const head = ["วันที่", "โครงการ", "ลูกค้า", "หน่วยผลิต", "รถ", "D/O", "คิว", "เดินทาง(นาที)", "รอเท(นาที)", "เท(นาที)", "ผลิตถึงเทเสร็จ(นาที)", "Slump", "อุณหภูมิคอนกรีต", "แจ้งเตือน"];
    const q = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = rows.map((r) => [r.date, r.project, r.customer, r.plant, r.truck, "'" + r.do, r.volume, r.travel, r.wait, r.pour, r.age,
      r.slump, r.conTemp, r.alerts.map((a) => a.text).join(" · ")].map(q).join(","));
    return "﻿" + [head.join(",")].concat(lines).join("\n");
  }

  return { trips, stats, groupBy, daily, toCSV };
});
