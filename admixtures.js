/*
 * Admixture catalog shared by all tools. Values come from each manufacturer's
 * PDS: density range (kg/L) and recommended dose in cc per kg binder
 * (or `pct` = % by mass of cement). Entries without sg/dose wait for a PDS.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ADMIX = factory();
})(typeof self !== "undefined" ? self : this, function () {
  return [
    { brand: "Sika", name: "Sika Plastomix-704", type: "ASTM C494 Type A/D", sg: [1.060, 1.100], dose: [3, 8] },
    { brand: "Sika", name: "Sikament NN TH", type: "ASTM C494 Type F", sg: [1.225, 1.255], dose: [6, 30] },
    { brand: "Sika", name: "Sikament G-5", type: "ASTM C494 Type G", sg: [1.180, 1.200], dose: [8, 25] },
    { brand: "Sika", name: "Sika ViscoCrete-10 TH", type: "PCE ลดน้ำอย่างมาก", sg: [1.050, 1.070], pct: [0.6, 3.0], pce: true },
    { brand: "GCP Applied Technologies", name: "GCP DARACEM S21C", type: "ASTM C494 Type F · ห้ามใช้ร่วมกับ PCE", noPce: true },
    { brand: "อื่นๆ", name: "Concera SA 8689", type: "ASTM C494 Type F", code: "ADM0502" },
  ];
});
