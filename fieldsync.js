/*
 * Field report sync rules, shared by the web page and the Google Apps Script
 * backend (paste this file into the Apps Script project as fieldsync.gs).
 *
 * Several devices may edit the same job. Jobs merge field-group by field-group:
 * header and status keep the newer edit; trucks merge by their id, newer edit wins;
 * removed trucks are kept as tombstones so a removal is not undone by another device.
 * A D/O number may appear only once across all jobs.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FieldSync = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const cleanDO = (s) => String(s == null ? "" : s).replace(/\s+/g, "");
  const toMin = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };

  // ---------- truck order ----------
  const DAY = 86400000, TH = 7 * 3600000; // Thai time, UTC+7
  /**
   * Ticket date in a 13-digit D/O: digits 4–9 are YYMMDD (Christian year), e.g. 037 261028 0010 = 28 Oct 2026.
   * Returns a day number (days since 1970-01-01) or null. The last 4 digits run from 0001 each day.
   */
  function doDay(d) {
    const s = cleanDO(d).replace(/\D/g, "");
    if (s.length !== 13) return null;
    const y = 2000 + Number(s.slice(3, 5)), m = Number(s.slice(5, 7)), dd = Number(s.slice(7, 9));
    if (m < 1 || m > 12 || dd < 1 || dd > 31) return null;
    return Date.UTC(y, m - 1, dd) / DAY;
  }
  const doSeq = (d) => { const s = cleanDO(d).replace(/\D/g, ""); return s.length === 13 ? Number(s.slice(-4)) : null; };
  const thaiDay = (ms) => Math.floor((ms + TH) / DAY);

  /**
   * Trucks in order of arrival at site, by date and time.
   * The date comes from when the truck was recorded (the arrival time nearest to it). Without that,
   * from the ticket date in the D/O: an arrival clock time earlier than the batching time is after
   * midnight, so it counts on the next day. With neither, arrivals are taken relative to the first
   * truck's arrival (within ±12 h), as clock times may cross midnight.
   * Trucks without an arrival time go last, in the order they were entered. Same minute: ticket date, running number, entry.
   */
  function sortTrucks(trucks) {
    const byEntry = trucks.slice().sort((a, b) => (a.created || 0) - (b.created || 0));
    const dayOf = (t) => { const d = doDay(t.do); return d != null ? d : t.created > 1e12 ? thaiDay(t.created) : null; };
    const dated = byEntry.find((t) => dayOf(t) != null && toMin(t.arrival) != null);
    const undated = byEntry.find((t) => dayOf(t) == null && toMin(t.arrival) != null);
    const base = undated ? toMin(undated.arrival) : 0, baseDay = dated ? dayOf(dated) : 0;
    const key = (t) => {
      const m = toMin(t.arrival);
      if (m == null) return Infinity;
      // recorded on a device: the arrival is the clock time nearest to when the truck was recorded
      // (a plant's ticket date can stay on the previous day after midnight, so it cannot place the day)
      if (t.created > 1e12) {
        const now = (t.created + TH) / 60000, cd = thaiDay(t.created);
        return [cd - 1, cd, cd + 1].map((d) => d * 1440 + m).reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
      }
      const day = dayOf(t);
      if (day == null) { let d = (m - base + 1440) % 1440; if (d > 720) d -= 1440; return baseDay * 1440 + base + d; }
      const bat = toMin(t.batching);
      let next = bat != null ? m < bat : false;
      if (bat == null && doDay(t.do) != null && t.created > 1e12 && thaiDay(t.created) > day && m < 720) next = true;
      return (day + (next ? 1 : 0)) * 1440 + m;
    };
    const seq = (t) => doSeq(t.do) ?? Infinity;
    return byEntry.sort((a, b) => {
      const ka = key(a), kb = key(b);
      if (ka !== kb) return ka - kb;
      return (ka === Infinity ? 0 : (dayOf(a) ?? 0) - (dayOf(b) ?? 0) || seq(a) - seq(b)) || (a.created || 0) - (b.created || 0);
    });
  }

  /**
   * Arrival of each truck as minutes since 1970-01-01 (Thai clock), the same rule sortTrucks uses:
   * from when the truck was recorded, else from the D/O ticket date. null when the truck has no arrival
   * time or no date can be found (no recording time, no valid D/O). Aligned with the input array.
   */
  function arrivalMinutes(trucks) {
    return trucks.map((t) => {
      const m = toMin(t.arrival);
      if (m == null) return null;
      if (t.created > 1e12) {
        const now = (t.created + TH) / 60000, cd = thaiDay(t.created);
        return [cd - 1, cd, cd + 1].map((d) => d * 1440 + m).reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
      }
      const day = doDay(t.do);
      if (day == null) return null;
      const bat = toMin(t.batching);
      return (day + (bat != null && m < bat ? 1 : 0)) * 1440 + m;
    });
  }

  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /** Give old (local-only) jobs the ids and timestamps sync needs. */
  function upgradeJob(job) {
    const t0 = job.updated || job.created || Date.now();
    job.headerUpdated = job.headerUpdated || t0;
    job.statusUpdated = job.statusUpdated || t0;
    job.removed = job.removed || [];
    job.trucks.forEach((t, i) => {
      t.id = t.id || newId("t");
      t.created = t.created || (job.created || t0) + i;
      t.updated = t.updated || t0;
    });
    return job;
  }

  function mergeJobs(a, b) {
    if (!a) return b;
    if (!b) return a;
    const newer = (x, y, k) => ((x[k] || 0) >= (y[k] || 0) ? x : y);
    const h = newer(a, b, "headerUpdated"), s = newer(a, b, "statusUpdated");

    const removed = new Map();
    [].concat(a.removed || [], b.removed || []).forEach((r) => {
      if (!removed.has(r.id) || removed.get(r.id).updated < r.updated) removed.set(r.id, r);
    });
    const trucks = new Map();
    [].concat(a.trucks || [], b.trucks || []).forEach((t) => {
      const cur = trucks.get(t.id);
      // same edit on both sides: keep the copy whose D/O still has its leading zeros
      if (!cur || (t.updated || 0) > (cur.updated || 0) ||
        ((t.updated || 0) === (cur.updated || 0) && cleanDO(t.do).length > cleanDO(cur.do).length)) trucks.set(t.id, t);
    });
    const live = sortTrucks([...trucks.values()]
      .filter((t) => !(removed.has(t.id) && removed.get(t.id).updated >= (t.updated || 0))));

    return {
      id: a.id, created: Math.min(a.created || Infinity, b.created || Infinity),
      updated: Math.max(a.updated || 0, b.updated || 0),
      header: { ...h.header }, headerUpdated: h.headerUpdated || 0,
      status: s.status, statusUpdated: s.statusUpdated || 0,
      trucks: live, removed: [...removed.values()],
    };
  }

  /**
   * First D/O that is repeated inside the job or already used by another job.
   * others: [{ jobId, project, do, no }] for trucks of all other jobs.
   */
  function findConflict(job, others) {
    const seen = new Map();
    for (let i = 0; i < job.trucks.length; i++) {
      const d = cleanDO(job.trucks[i].do);
      if (!d) continue;
      if (seen.has(d)) return { do: d, jobId: job.id, project: job.header.project, no: seen.get(d) + 1, sameJob: true };
      seen.set(d, i);
    }
    for (const o of others) {
      if (o.jobId !== job.id && seen.has(cleanDO(o.do))) return { do: cleanDO(o.do), jobId: o.jobId, project: o.project, no: o.no, sameJob: false };
    }
    return null;
  }

  return { cleanDO, toMin, doDay, doSeq, sortTrucks, arrivalMinutes, newId, upgradeJob, mergeJobs, findConflict };
});
