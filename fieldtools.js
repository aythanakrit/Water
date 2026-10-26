/*
 * Field tools from the plant's Excel sheet:
 * - compression test unit conversion (kN ↔ ksc) for 15 cm cylinder and cube
 * - site cement adjustment keeping admixture dose per kg binder, scaled to mixer load
 * Formulas follow the sheet (π taken as 3.14, g = 9.81).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FieldTools = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const G = 9.81;
  // Loaded area (cm²): cylinder Ø15 cm, cube 15 × 15 cm
  const AREA = { cylinder: 3.14 * 7.5 ** 2, cube: 225 };

  // ksc = (kN × 1,000) ÷ (area × 9.81)
  const knToKsc = (kn, shape) => (kn * 1000) / (AREA[shape] * G);
  const kscToKn = (ksc, shape) => (ksc * AREA[shape] * G) / 1000;

  /**
   * old: { cement, flyAsh, admix: { key: cc } }  original mix per m³
   * cement: new site cement (kg/m³); fly ash stays as in the original mix
   * cap: mixer load (m³)
   */
  function adjustMix(old, cement, cap) {
    const oldBinder = old.cement + old.flyAsh;
    if (!(oldBinder > 0)) throw new Error("Mix เดิมต้องมีปูนหรือไฟแอช");
    const flyAsh = old.flyAsh;
    const binder = cement + flyAsh;
    const admix = {};
    for (const k of Object.keys(old.admix)) admix[k] = binder * (old.admix[k] / oldBinder);
    const load = { cement: cement * cap, flyAsh: flyAsh * cap, admix: {} };
    for (const k of Object.keys(admix)) load.admix[k] = admix[k] * cap;
    return {
      perM3: { cement, flyAsh, binder, admix },
      dose: Object.fromEntries(Object.keys(old.admix).map((k) => [k, old.admix[k] / oldBinder])),
      load, loadBinder: load.cement + load.flyAsh,
    };
  }

  return { AREA, knToKsc, kscToKn, adjustMix };
});
