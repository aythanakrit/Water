/*
 * Core / small cylinder compression results, following the plant's Excel sheet:
 * area from average diameter, density from weight and dimensions,
 * strength ksc = kN × 101.97 ÷ area (cm²), MPa = ksc × 0.0981,
 * and the load each specimen needs to reach 100% / 85% of the specified ksc.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CoreTest = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PI = 3.1415926;
  const KGF_PER_KN = 101.97;
  const MPA_PER_KSC = 0.0981;

  /** s: { d (mm), l (mm), w (kg), load (kN) }, spec: specified strength (ksc) */
  function specimen(s, spec) {
    const area = PI * (s.d / 2) ** 2; // mm²
    const volumeCm3 = PI * ((s.d / 10) ** 2 / 4) * (s.l / 10);
    const ksc = s.load * KGF_PER_KN / (area / 100);
    const target100 = spec * (area / 100) / KGF_PER_KN;
    return {
      ld: s.l / s.d,
      area,
      density: s.w * 1000 / volumeCm3 * 1000, // kg/m³
      ksc,
      mpa: ksc * MPA_PER_KSC,
      pct: ksc / spec,
      target100,
      target85: target100 * 0.85,
    };
  }

  const complete = (s) => [s.d, s.l, s.w, s.load].every((x) => x > 0);

  function evaluate(samples, spec) {
    const results = samples.map((s) => (s.d > 0 ? specimen(s, spec) : null));
    const targets = results.filter(Boolean);
    const tested = results.filter((r, i) => r && samples[i].load > 0);
    return {
      results,
      spec100: spec,
      spec85: spec * 0.85,
      minTarget100: targets.length ? Math.min(...targets.map((r) => r.target100)) : null,
      minTarget85: targets.length ? Math.min(...targets.map((r) => r.target85)) : null,
      avgKsc: tested.length ? tested.reduce((t, r) => t + r.ksc, 0) / tested.length : null,
      minKsc: tested.length ? Math.min(...tested.map((r) => r.ksc)) : null,
    };
  }

  return { specimen, evaluate, complete };
});
