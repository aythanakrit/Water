/*
 * Core / small cylinder compression results, following the plant's Excel sheet:
 * area from average diameter, density from weight and dimensions,
 * strength ksc = kN × 101.97 ÷ area (cm²), MPa = ksc × 0.0981,
 * and the load each specimen needs to reach 100% / 85% of the specified ksc.
 * Added: L:D correction (ASTM C42) and group acceptance (ACI 318 (core acceptance; clause number varies by edition)):
 * average ≥ 85% and no single core < 75% of the specified strength.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CoreTest = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PI = 3.1415926;
  const KGF_PER_KN = 101.97;
  const MPA_PER_KSC = 0.0981;

  // ASTM C42 strength correction factors for L:D ≤ 1.75 (interpolated); above 1.75 no correction
  const LD = [1.0, 1.25, 1.5, 1.75];
  const LD_FACTOR = [0.87, 0.93, 0.96, 0.98];

  function ldFactor(ld) {
    if (!(ld >= 1.0)) return null; // L:D below 1.0 is not a valid test
    if (ld > 1.75) return 1.0;
    for (let i = 1; i < LD.length; i++) {
      if (ld <= LD[i]) return LD_FACTOR[i - 1] + (ld - LD[i - 1]) / (LD[i] - LD[i - 1]) * (LD_FACTOR[i] - LD_FACTOR[i - 1]);
    }
  }

  // Flags for values that usually mean a typing or unit error
  const LOW_PCT = 0.5;
  const LOW_DENSITY = 2100;

  /** s: { d (mm), l (mm), w (kg), load (kN) }, spec: specified strength (ksc) */
  function specimen(s, spec) {
    const area = PI * (s.d / 2) ** 2; // mm²
    const volumeCm3 = PI * ((s.d / 10) ** 2 / 4) * (s.l / 10);
    const ld = s.l / s.d;
    const factor = s.l > 0 ? ldFactor(ld) : 1;
    const ksc = s.load * KGF_PER_KN / (area / 100);
    const corrected = factor ? ksc * factor : null;
    // Load needed so that the corrected strength reaches the spec
    const target100 = spec * (area / 100) / KGF_PER_KN / (factor || 1);
    const density = s.w * 1000 / volumeCm3 * 1000; // kg/m³
    const flags = [];
    if (s.l > 0 && !factor) flags.push("L:D ต่ำกว่า 1.0 ไม่ควรใช้ผล");
    if (s.load > 0 && corrected != null && corrected / spec < LOW_PCT) flags.push(`ได้ต่ำกว่า ${LOW_PCT * 100}% ของ Mix — ตรวจหน่วยแรงกด/ข้อมูล`);
    if (s.l > 0 && s.w > 0 && density < LOW_DENSITY) flags.push(`ความหนาแน่นต่ำกว่า ${LOW_DENSITY} kg/m³ — ตรวจขนาด/น้ำหนัก`);
    return {
      ld, factor,
      area,
      density,
      ksc,
      mpa: ksc * MPA_PER_KSC,
      corrected,
      pct: corrected != null ? corrected / spec : null,
      target100,
      target85: target100 * 0.85,
      flags,
    };
  }

  const complete = (s) => [s.d, s.l, s.w, s.load].every((x) => x > 0);

  // ACI 318 (core acceptance; clause number varies by edition): group of cores is acceptable when avg ≥ 0.85 f'c and each ≥ 0.75 f'c
  function acceptGroup(values, spec) {
    const avg = values.reduce((t, v) => t + v, 0) / values.length;
    const min = Math.min(...values);
    return { n: values.length, avg, min, avgOk: avg >= 0.85 * spec, minOk: min >= 0.75 * spec,
      ok: avg >= 0.85 * spec && min >= 0.75 * spec };
  }

  function evaluate(samples, spec) {
    const results = samples.map((s) => (s.d > 0 ? specimen(s, spec) : null));
    const groups = new Map();
    results.forEach((r, i) => {
      if (!r || !(samples[i].load > 0) || r.corrected == null) return;
      const g = String(samples[i].group ?? "").trim() || "-";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ name: samples[i].name, value: r.corrected });
    });
    return {
      results,
      spec100: spec,
      spec85: spec * 0.85,
      spec75: spec * 0.75,
      groups: [...groups].map(([name, items]) => ({ name, items, ...acceptGroup(items.map((x) => x.value), spec) })),
    };
  }

  return { ldFactor, specimen, acceptGroup, evaluate };
});
