/*
 * Concrete order volume from member dimensions, with a waste allowance per member type.
 * Allowance defaults are common site practice, not from a standard (ว.ส.ท., ACI and ASTM C94
 * give no fixed figure); each comes with the reasons it is needed so the order can be explained.
 * Dimensions in m, volumes in m³.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Volume = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // shape "rect": a × b × h; "round": Ø a × h; "direct": a is m³
  const TYPES = {
    slab: {
      name: "พื้นบนคาน / พื้นสำเร็จ", shape: "rect", dims: ["กว้าง", "ยาว", "หนา"], waste: 4,
      reasons: ["ความหนาจริงมักเกินแบบ (หนาเกิน 1 ซม. บนพื้น 100 m² = 1 m³)", "ระดับท้องพื้นหรือแผ่นสำเร็จไม่เรียบ", "ค้างในถัง ราง และหกระหว่างเท"],
    },
    ground: {
      name: "พื้นวางบนดิน", shape: "rect", dims: ["กว้าง", "ยาว", "หนา"], waste: 7,
      reasons: ["ดินหรือทรายรองพื้นบดอัดไม่เรียบ ทำให้ความหนาจริงไม่สม่ำเสมอ", "ทรายรองพื้นยุบตัวระหว่างเท", "ค้างในถัง ราง และหกระหว่างเท"],
    },
    beam: {
      name: "คาน", shape: "rect", dims: ["กว้าง", "ลึก", "ยาว"], waste: 3,
      reasons: ["แบบหล่อโก่งหรือบวมเมื่อรับแรงดันคอนกรีต", "ค้างในถัง ราง และหกระหว่างเท"],
    },
    column: {
      name: "เสาเหลี่ยม", shape: "rect", dims: ["กว้าง", "ยาว", "สูง"], waste: 3,
      reasons: ["แบบหล่อบวม (แรงดันด้านข้างสูงเพราะเทสูง)", "ค้างในถัง ราง และหกระหว่างเท"],
    },
    roundColumn: {
      name: "เสากลม", shape: "round", dims: ["Ø", "สูง"], waste: 3,
      reasons: ["แบบหล่อบวม (แรงดันด้านข้างสูงเพราะเทสูง)", "ค้างในถัง ราง และหกระหว่างเท"],
    },
    wall: {
      name: "ผนัง", shape: "rect", dims: ["ยาว", "สูง", "หนา"], waste: 4,
      reasons: ["แบบหล่อบวม ผนังบางจึงมีผลต่อปริมาตรเป็นสัดส่วนสูง", "ค้างในถัง ราง และหกระหว่างเท"],
    },
    footing: {
      name: "ฐานราก (หล่อชนดิน)", shape: "rect", dims: ["กว้าง", "ยาว", "หนา"], waste: 7,
      reasons: ["ขุดดินเกินขนาด ผนังบ่อไม่ตรง", "ก้นบ่อไม่เรียบ มีดินร่วงลงก่อนเท", "ค้างในถัง ราง และหกระหว่างเท"],
    },
    pile: {
      name: "เสาเข็มเจาะ", shape: "round", dims: ["Ø", "ลึก"], waste: 15,
      reasons: ["ดินพัง (overbreak) ทำให้รูโตกว่า Ø ที่เจาะ ขึ้นกับชั้นดินมาก", "คอนกรีตไหลเข้าโพรงหรือชั้นทราย", "ต้องเทเกินระดับตัดหัวเข็มเพื่อไล่ส่วนที่ปนดินและสารละลายขึ้นมา"],
    },
    other: {
      name: "อื่น ๆ (กรอก m³)", shape: "direct", dims: ["ปริมาตร"], waste: 5,
      reasons: ["ขนาดจริงอาจไม่ตรงแบบ", "ค้างในถัง ราง และหกระหว่างเท"],
    },
  };

  // Net volume of one item (m³): dims a, b, h in m, n pieces
  function netVolume(type, { a = 0, b = 0, h = 0, n = 1 }) {
    const t = TYPES[type];
    if (!t) throw new Error("ไม่รู้จักชนิดงาน " + type);
    if (t.shape === "direct") return a;
    if (t.shape === "round") return (Math.PI / 4) * a * a * b * n; // Ø = a, height = b
    return a * b * h * n;
  }

  /**
   * items: [{ type, a, b, h, n, waste }]  waste in % (defaults to the type's value)
   * opts: { cap: truck load m³, step: round order up to this m³, pump: extra m³ to prime the pump line }
   */
  function order(items, { cap = 5, step = 0.5, pump = 0 } = {}) {
    const rows = items.map((it) => {
      const waste = it.waste ?? TYPES[it.type].waste;
      const net = netVolume(it.type, it);
      return { ...it, waste, net, extra: (net * waste) / 100, total: net * (1 + waste / 100) };
    });
    const net = rows.reduce((s, r) => s + r.net, 0);
    const extra = rows.reduce((s, r) => s + r.extra, 0);
    const need = net + extra + pump;
    // Round up, with a small tolerance so 10.0000001 does not become 10.5
    const ordered = step > 0 ? Math.ceil(need / step - 1e-9) * step : need;
    const trips = cap > 0 && ordered > 0 ? Math.ceil(ordered / cap - 1e-9) : 0;
    const last = trips ? ordered - (trips - 1) * cap : 0;
    return { rows, net, extra, pump, need, ordered, trips, last, wastePct: net > 0 ? ((need - net) / net) * 100 : 0 };
  }

  return { TYPES, netVolume, order };
});
