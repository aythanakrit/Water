/*
 * Field tools from the plant's Excel sheet:
 * - compression test unit conversion (kN ↔ ksc) for 15 cm cylinder and cube
 * - site cement adjustment keeping admixture dose per kg binder, scaled to mixer load
 * Strength uses the same constants as the core page: π and 1 kN = 101.97 kgf.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FieldTools = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KGF_PER_KN = 101.97;
  // Loaded area (cm²): cylinder Ø15 cm, cube 15 × 15 cm
  const AREA = { cylinder: Math.PI * 7.5 ** 2, cube: 225 };

  // ksc = kN × 101.97 ÷ area (cm²)
  const knToKsc = (kn, shape) => (kn * KGF_PER_KN) / AREA[shape];
  const kscToKn = (ksc, shape) => (ksc * AREA[shape]) / KGF_PER_KN;
  // MPa = ksc × 0.0981, as on the core page
  const MPA_PER_KSC = 0.0981;
  const kscToMpa = (ksc) => ksc * MPA_PER_KSC;
  const mpaToKsc = (mpa) => mpa / MPA_PER_KSC;

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

  return { AREA, knToKsc, kscToKn, kscToMpa, mpaToKsc, adjustMix };
});
