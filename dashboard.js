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

  const hhmm = (m) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;

  /**
   * Put clock times of one job on a single timeline (minutes), so a pour that
   * runs past midnight keeps going forward: 23:50 → 1430, 00:20 → 1460.
   */
  function onTimeline(trucks, field) {
    // each time is taken relative to the previous truck (in entry/arrival order), so a job of 24 h or more
    // keeps counting forward instead of folding back at the 12-hour mark
    let prev = null;
    return trucks.map((t) => {
      const m = clock(t[field]);
      if (m == null) return null;
      if (prev == null) { prev = m; return m; }
      let d = (m - (prev % 1440) + 1440) % 1440;
      if (d > 720) d -= 1440;
      prev += d;
      return prev;
    });
  }

  /**
   * One project over a date range:
   *  plants — volume, trips and production rate (m³/h) from batching times
   *  hourly — volume per batching hour per plant
   *  trucks — each mixer truck, its trips and time windows
   *  issues — trips with a remark (typed or from the time checks)
   */
  function projectView(jobs, project, { from, to } = {}) {
    const picked = jobs.filter((j) => j.status !== "deleted" && (j.header.project || "(ไม่มีชื่อ)") === project &&
      (!from || (j.header.date || "") >= from) && (!to || (j.header.date || "") <= to));
    const all = [];
    picked.forEach((j) => {
      const tr = (j.trucks || []).filter((t) => String(t.do || "").trim());
      const bt = onTimeline(tr, "batching"), at = onTimeline(tr, "arrival"), et = onTimeline(tr, "end");
      tr.forEach((t, i) => all.push({ job: j, t, date: j.header.date || "", plant: t.plant || "(ไม่ระบุ)", volume: num(t.volume), b: bt[i], a: at[i], e: et[i] }));
    });

    // production rate per plant (per day when the range has several days):
    // volume ÷ batching span, the span covering n trucks as n intervals
    const multiDay = new Set(all.map((r) => r.date)).size > 1;
    const plants = new Map();
    all.forEach((r) => {
      const key = multiDay ? r.date + "|" + r.plant : r.plant;
      if (!plants.has(key)) plants.set(key, { plant: r.plant, date: r.date, volume: 0, trips: 0, pours: new Map() });
      const p = plants.get(key);
      p.volume += r.volume; p.trips++;
      const k = r.job.id;
      if (!p.pours.has(k)) p.pours.set(k, []);
      if (r.b != null) p.pours.get(k).push(r);
    });
    const plantRows = [...plants.values()].map((p) => {
      let vol = 0, hours = 0, first = null, last = null;
      p.pours.forEach((rs) => {
        if (!rs.length) return;
        const ts = rs.map((r) => r.b).sort((x, y) => x - y);
        const n = ts.length, spanMin = ts[n - 1] - ts[0];
        if (first == null || ts[0] < first) first = ts[0];
        if (last == null || ts[n - 1] > last) last = ts[n - 1];
        if (n < 2 || spanMin <= 0) return;
        vol += rs.reduce((s, r) => s + r.volume, 0);
        hours += spanMin * n / (n - 1) / 60;
      });
      return { plant: p.plant, date: multiDay ? p.date : "", volume: p.volume, trips: p.trips, rate: hours ? vol / hours : null,
        first: first == null ? "" : hhmm(first), last: last == null ? "" : hhmm(last) };
    }).sort((a, b) => a.date.localeCompare(b.date) || b.volume - a.volume);

    // volume per batching hour (per date when the range has several days)
    const hours = new Map();
    all.forEach((r) => {
      if (r.b == null) return;
      const h = Math.floor(r.b / 60);
      const key = `${r.date}|${String(h).padStart(5, "0")}`;
      if (!hours.has(key)) hours.set(key, { date: multiDay ? r.date : "", label: hhmm(h * 60).slice(0, 2) + ":00", byPlant: {}, total: 0 });
      const o = hours.get(key);
      o.byPlant[r.plant] = (o.byPlant[r.plant] || 0) + r.volume; o.total += r.volume;
    });
    const hourly = [...hours.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);

    // mixer trucks
    const trucks = new Map();
    all.forEach((r) => {
      const k = String(r.t.truck || "").trim() || "(ไม่ระบุเลขรถ)";
      if (!trucks.has(k)) trucks.set(k, { truck: k, trips: 0, volume: 0, windows: [] });
      const o = trucks.get(k);
      o.trips++; o.volume += r.volume;
      o.windows.push({ date: r.date, batching: r.t.batching || "", arrival: r.t.arrival || "", end: r.t.end || "", do: r.t.do, plant: r.plant, sortKey: r.date + String(r.b ?? r.a ?? 0).padStart(6, "0") });
    });
    const truckRows = [...trucks.values()].map((o) => ({ ...o, windows: o.windows.sort((a, b) => a.sortKey.localeCompare(b.sortKey)) }))
      .sort((a, b) => b.trips - a.trips || a.truck.localeCompare(b.truck, "th", { numeric: true }));

    // whole-hour columns by batching time (06:00, 07:00 …), continuous from the first to the last hour of each day
    const hourKey = (r) => `${r.date}|${String(Math.floor(r.b / 60)).padStart(5, "0")}`;
    const span2 = {};
    all.forEach((r) => {
      if (r.b == null) return;
      const h = Math.floor(r.b / 60), d = span2[r.date] || (span2[r.date] = [h, h]);
      d[0] = Math.min(d[0], h); d[1] = Math.max(d[1], h);
    });
    const columns = [];
    Object.keys(span2).sort().forEach((d) => {
      for (let h = span2[d][0]; h <= span2[d][1]; h++) {
        columns.push({ key: `${d}|${String(h).padStart(5, "0")}`, date: multiDay ? d : "", label: hhmm(h * 60) });
      }
    });
    const travelOf = (r) => {
      if (FieldReport.timeAlerts(r.t).some((x) => x.text.startsWith("ตรวจเวลา"))) return null;
      return span(clock(r.t.batching), clock(r.t.arrival));
    };
    const byPlant = new Map();
    const totalByHour = {};
    all.forEach((r) => {
      if (!byPlant.has(r.plant)) byPlant.set(r.plant, { plant: r.plant, volume: 0, trips: 0, byHour: {}, travel: [] });
      const o = byPlant.get(r.plant);
      o.volume += r.volume; o.trips++;
      const tr = travelOf(r);
      if (tr != null) o.travel.push(tr);
      if (r.b == null) return;
      const k = hourKey(r);
      o.byHour[k] = (o.byHour[k] || 0) + r.volume;
      totalByHour[k] = (totalByHour[k] || 0) + r.volume;
    });
    // m³ per hour = average over the hours that plant actually batched
    const perHour = (m) => { const xs = Object.values(m).filter((x) => x > 0); return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null; };
    const plantHours = [...byPlant.values()].map((o) => ({ plant: o.plant, volume: o.volume, trips: o.trips, byHour: o.byHour,
      perHour: perHour(o.byHour), avgTravel: avg(o.travel) })).sort((a, b) => b.volume - a.volume);
    const allTravel = [].concat(...[...byPlant.values()].map((o) => o.travel));
    const truckHours = [...trucks.values()].map((o) => {
      // each hour: the trips batched in it, as batching → arrival
      const byHour = {};
      all.filter((r) => (String(r.t.truck || "").trim() || "(ไม่ระบุเลขรถ)") === o.truck && r.b != null)
        .sort((x, y) => x.b - y.b)
        .forEach((r) => { const k = hourKey(r); (byHour[k] = byHour[k] || []).push({ batching: r.t.batching || "", arrival: r.t.arrival || "", do: r.t.do, plant: r.plant }); });
      return { truck: o.truck, trips: o.trips, volume: o.volume, byHour };
    }).sort((a, b) => b.trips - a.trips || a.truck.localeCompare(b.truck, "th", { numeric: true }));

    const issues = all.map((r) => ({ date: r.date, truck: r.t.truck, do: r.t.do, plant: r.plant,
      remark: FieldReport.remarkWithAlerts(r.t), alerts: FieldReport.timeAlerts(r.t), typed: String(r.t.remark || "").trim() }))
      .filter((x) => x.remark);

    return {
      project, multiDay, jobs: picked.length, volume: all.reduce((s, r) => s + r.volume, 0), trips: all.length,
      plants: plantRows, hourly, plantNames: [...new Set(plantRows.map((p) => p.plant))], trucks: truckRows, issues,
      columns, plantHours, totalByHour, perHour: perHour(totalByHour), avgTravel: avg(allTravel), truckHours,
    };
  }

  return { trips, stats, groupBy, daily, toCSV, projectView };
});
