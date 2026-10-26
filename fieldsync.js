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

  /**
   * Trucks in order of arrival at site. Times are clock times that may cross midnight,
   * so each arrival is taken relative to the first truck's arrival (within ±12 h).
   * Trucks without an arrival time keep their entry order after the others.
   */
  function sortTrucks(trucks) {
    const byEntry = trucks.slice().sort((a, b) => (a.created || 0) - (b.created || 0));
    const first = byEntry.find((t) => toMin(t.arrival) != null);
    const base = first ? toMin(first.arrival) : 0;
    const key = (t) => {
      const m = toMin(t.arrival);
      if (m == null) return Infinity;
      let d = (m - base + 1440) % 1440;
      if (d > 720) d -= 1440;
      return d;
    };
    return byEntry.sort((a, b) => key(a) - key(b) || (a.created || 0) - (b.created || 0));
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
      if (!cur || (t.updated || 0) > (cur.updated || 0)) trucks.set(t.id, t);
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

  return { cleanDO, toMin, sortTrucks, newId, upgradeJob, mergeJobs, findConflict };
});
