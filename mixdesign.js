/*
 * Concrete mix design calculator — ACI 211.1-91 (Reaffirmed 2009), SI units.
 * Absolute volume method. Aggregate masses are on oven-dry (OD) basis,
 * then adjusted for field moisture (ACI 211.1 §6.3.10).
 *
 * Results are a starting point for trial batches only. They must be verified
 * by trial mixes and approved by the responsible engineer before production.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MixDesign = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Nominal maximum aggregate size (mm)
  const SIZES = [9.5, 12.5, 19, 25, 37.5, 50];

  // Table 6.3.3 — mixing water (kg/m³) by slump range and NMAS
  const WATER = {
    nonAE: {
      "25-50": [207, 199, 190, 179, 166, 154],
      "75-100": [228, 216, 205, 193, 181, 169],
      "150-175": [243, 228, 216, 202, 190, 178],
    },
    AE: {
      "25-50": [181, 175, 168, 160, 150, 142],
      "75-100": [202, 193, 184, 175, 165, 157],
      "150-175": [216, 205, 197, 184, 174, 166],
    },
  };

  // Slump ranges of Table 6.3.3 are interpolated between their midpoints (mm).
  // Clamped outside 37.5–162.5 mm, so 25–37.5 and 162.5–175 use the end ranges.
  const SLUMP_MID = { "25-50": 37.5, "75-100": 87.5, "150-175": 162.5 };

  function mixingWater(ae, slumpMm, i) {
    const t = WATER[ae ? "AE" : "nonAE"];
    const keys = Object.keys(SLUMP_MID);
    return interp(keys.map((k) => SLUMP_MID[k]), keys.map((k) => t[k][i]), slumpMm);
  }

  // Table 6.3.3 — air content (%)
  const AIR = {
    entrapped: [3, 2.5, 2, 1.5, 1, 0.5],
    mild: [4.5, 4.0, 3.5, 3.0, 2.5, 2.0],
    moderate: [6.0, 5.5, 5.0, 4.5, 4.5, 4.0],
    severe: [7.5, 7.0, 6.0, 6.0, 5.5, 5.0],
  };

  // Table 6.3.4(a) — w/c by mass vs 28-day cylinder strength (MPa)
  const WC_TABLE = {
    strength: [15, 20, 25, 30, 35, 40],
    nonAE: [0.79, 0.69, 0.61, 0.54, 0.47, 0.42],
    AE: [0.70, 0.60, 0.52, 0.45, 0.39, null],
  };

  // Table 6.3.6 — dry-rodded coarse aggregate volume per unit volume of concrete
  const FM_POINTS = [2.4, 2.6, 2.8, 3.0];
  const COARSE_VOL = [
    [0.50, 0.48, 0.46, 0.44],
    [0.59, 0.57, 0.55, 0.53],
    [0.66, 0.64, 0.62, 0.60],
    [0.71, 0.69, 0.67, 0.65],
    [0.75, 0.73, 0.71, 0.69],
    [0.78, 0.76, 0.74, 0.72],
  ];

  // ACI 318-19 Table 26.4.3.1(b) / ACI 301 — SD modification factor for 15–29 tests
  const SD_FACTOR = [[15, 1.16], [20, 1.08], [25, 1.03], [30, 1.0]];

  function interp(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    for (let i = 1; i < xs.length; i++) {
      if (x <= xs[i]) {
        const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
        return ys[i - 1] + t * (ys[i] - ys[i - 1]);
      }
    }
  }

  function sizeIndex(nmas) {
    const i = SIZES.indexOf(Number(nmas));
    if (i < 0) throw new Error("ขนาดโตสุดของหินไม่อยู่ในตาราง: " + nmas);
    return i;
  }

  // Required average compressive strength f'cr (MPa), ACI 318-19 §26.4.3 / ACI 301 §4.2.3.3
  function requiredStrength(fc, sd, nTests) {
    if (sd == null || !(nTests >= 15)) {
      if (fc < 21) return { fcr: fc + 7.0, method: "ไม่มีข้อมูล SD: f'c + 7.0" };
      if (fc <= 35) return { fcr: fc + 8.3, method: "ไม่มีข้อมูล SD: f'c + 8.3" };
      return { fcr: 1.1 * fc + 5.0, method: "ไม่มีข้อมูล SD: 1.10f'c + 5.0" };
    }
    const k = nTests >= 30 ? 1.0 : interp(SD_FACTOR.map((r) => r[0]), SD_FACTOR.map((r) => r[1]), nTests);
    const s = k * sd;
    const a = fc + 1.34 * s;
    const b = fc <= 35 ? fc + 2.33 * s - 3.5 : 0.9 * fc + 2.33 * s;
    return {
      fcr: Math.max(a, b),
      sdUsed: s,
      method: (fc <= 35
        ? "max(f'c + 1.34s, f'c + 2.33s − 3.5)"
        : "max(f'c + 1.34s, 0.90f'c + 2.33s)") + (k !== 1 ? ` โดย s × ${k.toFixed(2)}` : ""),
    };
  }

  function wcFromStrength(fcr, airEntrained) {
    const ys = airEntrained ? WC_TABLE.AE : WC_TABLE.nonAE;
    const xs = WC_TABLE.strength.filter((_, i) => ys[i] != null);
    const yv = ys.filter((y) => y != null);
    const warn = [];
    if (fcr > xs[xs.length - 1]) warn.push(`f'cr = ${fcr.toFixed(1)} MPa เกินช่วงตาราง 6.3.4(a) (สูงสุด ${xs[xs.length - 1]} MPa) — ใช้ค่าปลายตาราง ต้องหาความสัมพันธ์ w/c–กำลังจากวัสดุจริง`);
    if (fcr < xs[0]) warn.push(`f'cr ต่ำกว่าช่วงตาราง (${xs[0]} MPa)`);
    return { wc: interp(xs, yv, fcr), warn };
  }

  /**
   * @param {object} p
   * fc            specified 28-day cylinder strength (MPa)
   * sd, nTests    plant standard deviation (MPa) and number of tests (optional)
   * slump         target slump (mm), 25–200 (above 175 the table's top row is used, with a warning)
   * nmas          nominal max aggregate size (mm)
   * exposure      "none" | "mild" | "moderate" | "severe"  (none = non-air-entrained)
   * wcMax         durability w/c limit (optional)
   * cementMin     minimum cementitious (binder) content kg/m³ (optional)
   * waterReduction  % water reduction from admixture (optional, 0 = none)
   * sgCement, fm, druw (coarse dry-rodded unit mass, kg/m³)
   * coarse/fine: { sg (bulk OD), absorption %, moisture % }
   * flyAsh, slag: { pct (% of binder mass), sg } (optional)
   * admixtures: [{ name, dose (cc per kg binder), sg, solids % }] (optional)
   *   e.g. binder 350 kg × dose 3 = 1,050 cc
   */
  function design(p) {
    const warnings = [];
    const i = sizeIndex(p.nmas);
    const ae = p.exposure && p.exposure !== "none";

    // 1) f'cr
    const req = requiredStrength(p.fc, p.sd, p.nTests);

    // 2) Mixing water and air
    if (!(p.slump >= 25 && p.slump <= 200)) throw new Error("Slump ต้องอยู่ระหว่าง 2.5–20 cm");
    let water = mixingWater(ae, p.slump, i);
    if (p.slump > 175) warnings.push(`Slump ${p.slump / 10} cm เกินช่วง ACI 211.1 Table 6.3.3 (สูงสุด 15–17.5 cm) — ใช้น้ำของช่วงบนสุด ส่วน slump ที่เกินต้องได้จากสารลดน้ำ/superplasticizer และยืนยันด้วย trial batch`);
    const waterTable = water;
    const red = Number(p.waterReduction) || 0;
    if (red > 0) {
      water = water * (1 - red / 100);
      warnings.push(`ลดน้ำ ${red}% ด้วยสารผสมเพิ่ม — ไม่ได้อยู่ในวิธีพื้นฐานของ ACI 211.1 ต้องยืนยันด้วย trial batch`);
    }
    const air = ae ? AIR[p.exposure][i] : AIR.entrapped[i];

    // 3) w/cm — strength vs durability
    // With SCMs, Table 6.3.4(a) is applied to w/(c+p) by mass (ACI 211.1 §6.3.4)
    const wcs = wcFromStrength(req.fcr, ae);
    warnings.push(...wcs.warn);
    let wc = wcs.wc;
    let wcGoverns = "กำลัง (Table 6.3.4a)";
    if (p.wcMax && p.wcMax < wc) { wc = p.wcMax; wcGoverns = "ความคงทน (w/cm max)"; }

    // 4) Binder split into cement + SCMs
    let binder = water / wc;
    if (p.cementMin && binder < p.cementMin) {
      binder = p.cementMin;
      wc = water / binder;
      wcGoverns = "ปริมาณวัสดุประสานขั้นต่ำ";
    }
    const faPct = (p.flyAsh && p.flyAsh.pct) || 0;
    const slagPct = (p.slag && p.slag.pct) || 0;
    if (faPct < 0 || slagPct < 0 || faPct + slagPct >= 100) throw new Error("สัดส่วน fly ash + slag ต้องอยู่ระหว่าง 0–100%");
    const flyAsh = binder * faPct / 100;
    const slag = binder * slagPct / 100;
    const cement = binder - flyAsh - slag;
    if (faPct > 0 || slagPct > 0) {
      warnings.push("ใช้ w/cm จากตาราง ACI ของปูนปอร์ตแลนด์ล้วน — วัสดุประสาน (fly ash/slag) ทำให้กำลัง 28 วันพัฒนาช้ากว่า ต้องยืนยันความสัมพันธ์ w/cm–กำลังด้วย trial batch");
    }
    if (faPct > 35) warnings.push(`Fly ash ${faPct}% ค่อนข้างสูง — ตรวจกำลังช่วงอายุต้นและข้อกำหนดของโครงการ`);
    if (slagPct > 70) warnings.push(`Slag ${slagPct}% ค่อนข้างสูง — ตรวจกำลังช่วงอายุต้นและข้อกำหนดของโครงการ`);

    // 5) Coarse aggregate (OD)
    if (p.fm < 2.3 || p.fm > 3.1) warnings.push(`FM ทราย = ${p.fm} อยู่นอกช่วงที่แนะนำ 2.3–3.1 (ACI 211.1)`);
    const bb0 = interp(FM_POINTS, COARSE_VOL[i], p.fm);
    const coarseOD = bb0 * p.druw;

    // 6) Fine aggregate by absolute volume
    const vol = {
      water: water / 1000,
      cement: cement / (p.sgCement * 1000),
      flyAsh: flyAsh ? flyAsh / (p.flyAsh.sg * 1000) : 0,
      slag: slag ? slag / (p.slag.sg * 1000) : 0,
      coarse: coarseOD / (p.coarse.sg * 1000),
      air: air / 100,
    };
    vol.fine = 1 - vol.water - vol.cement - vol.flyAsh - vol.slag - vol.coarse - vol.air;
    if (vol.fine <= 0) throw new Error("ปริมาตรทรายติดลบ — ตรวจสอบข้อมูลวัสดุ");
    const fineOD = vol.fine * p.fine.sg * 1000;

    // 7) Moisture adjustment (§6.3.10)
    const wetCoarse = coarseOD * (1 + p.coarse.moisture / 100);
    const wetFine = fineOD * (1 + p.fine.moisture / 100);
    const freeCoarse = coarseOD * (p.coarse.moisture - p.coarse.absorption) / 100;
    const freeFine = fineOD * (p.fine.moisture - p.fine.absorption) / 100;

    // 8) Admixtures — dose in cc per kg binder; water in the admixture counts as mixing water
    const admixtures = (p.admixtures || []).filter((a) => a && a.dose > 0).map((a) => {
      const cc = a.dose * binder;
      const kg = cc * a.sg / 1000;
      return { name: a.name, dose: a.dose, cc, litre: cc / 1000, kg, water: kg * (1 - (a.solids || 0) / 100) };
    });
    const admixWater = admixtures.reduce((t, a) => t + a.water, 0);
    const admixKg = admixtures.reduce((t, a) => t + a.kg, 0);
    const batchWater = water - freeCoarse - freeFine - admixWater;

    const design = { cement, flyAsh, slag, water, coarse: coarseOD, fine: fineOD };
    const batch = { cement, flyAsh, slag, water: batchWater, coarse: wetCoarse, fine: wetFine };
    const sum = (o, extra = 0) => o.cement + o.flyAsh + o.slag + o.water + o.coarse + o.fine + extra;

    return {
      fcr: req.fcr, fcrMethod: req.method, sdUsed: req.sdUsed,
      waterTable, water, air, airEntrained: ae,
      wcStrength: wcs.wc, wc, wcGoverns,
      bb0, volumes: vol,
      binder, design, designDensity: sum(design),
      batch, batchDensity: sum(batch, admixKg),
      admixtures, admixWater,
      freeWater: { coarse: freeCoarse, fine: freeFine },
      warnings,
    };
  }

  return { SIZES, requiredStrength, wcFromStrength, mixingWater, design, interp };
});
