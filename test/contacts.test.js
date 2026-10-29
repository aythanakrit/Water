const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../contacts.js");

test("phones: digits only, +66 becomes 0, shown with dashes", () => {
  assert.equal(C.cleanPhone("081-234-5678"), "0812345678");
  assert.equal(C.cleanPhone("+66 81 234 5678"), "0812345678");
  assert.equal(C.showPhone("0812345678"), "081-234-5678");
  assert.equal(C.showPhone("021234567"), "02-123-4567");
  assert.equal(C.phoneOk("0812345678"), true);
  assert.equal(C.phoneOk("812345678"), false);
  assert.equal(C.phoneOk("08123"), false);
});

test("check: required name, surname, phone and plant", () => {
  const ok = C.check({ first: " สมศักดิ์ ", last: "อริยะ", nick: "ศักดิ์", phone: "081 234 5678", plant: "คลองตัน" });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.contact.first, "สมศักดิ์");
  assert.equal(ok.contact.phone, "0812345678");
  assert.equal(C.check({}).errors.length, 4);
});

test("org chart: departments and positions in the admin's order, unknown ones after, unassigned last", () => {
  const settings = { depts: [{ name: "ผลิต", positions: ["ผู้จัดการฝ่ายผลิต", "หัวหน้าแพล้น", "พนักงานผลิต"] }, { name: "QC", positions: ["หัวหน้า QC", "QC"] }, { name: "ผลิต", positions: [] }, { name: " " }] };
  const p = (first, dept, pos) => ({ first, last: "x", dept, pos });
  const chart = C.orgChart([
    p("ข", "QC", "QC"), p("ก", "ผลิต", "พนักงานผลิต"), p("ค", "ผลิต", "ผู้จัดการฝ่ายผลิต"), p("ง", "", ""),
    p("จ", "ขนส่ง", "คนขับ"), p("ฉ", "ผลิต", "หัวหน้าแพล้น"), p("ช", "QC", "หัวหน้า QC"), p("ซ", "ผลิต", ""),
  ], settings);
  assert.deepEqual(chart.map((d) => d.dept), ["ผลิต", "QC", "ขนส่ง", C.NO_DEPT]);
  assert.deepEqual(chart[0].groups.map((g) => g.pos), ["ผู้จัดการฝ่ายผลิต", "หัวหน้าแพล้น", "พนักงานผลิต", C.NO_POS]);
  assert.deepEqual(chart[1].groups.map((g) => g.people[0].first), ["ช", "ข"]);
  assert.equal(chart[0].count, 4);
  assert.equal(C.cleanSettings(settings).depts.length, 2); // repeats and blanks dropped
});

test("search by name, nickname, plant or part of the phone", () => {
  const p = { first: "สมศักดิ์", last: "อริยะ", nick: "ศักดิ์", phone: "0812345678", plant: "คลองตัน", dept: "ผลิต", pos: "ผู้จัดการฝ่ายผลิต" };
  assert.equal(C.matches(p, "ศักดิ์"), true);
  assert.equal(C.matches(p, "คลองตัน ผลิต"), true);
  assert.equal(C.matches(p, "5678"), true);
  assert.equal(C.matches(p, "บางพลี"), false);
});

test("paste from Excel: titles dropped, columns found by content, header and blank rows skipped", () => {
  const text = [
    "\tPQ Trial Mix Team",
    "No.\tName\tNickname\tTel.\tEmail.",
    "1\tคุณทดสอบ ตัวอย่าง\tช่างหนึ่ง\t082-000-0001\tTest.One@example.com",
    "\tนายสมมุติ นามสกุล\tสอง\t082-000-0002\ttwo@example.com",
    "\tคุณสาม\tช่างสาม\t082-000-0003\t",
    "",
  ].join("\n");
  const rows = C.parsePaste(text);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { first: "ทดสอบ", last: "ตัวอย่าง", nick: "ช่างหนึ่ง", phone: "0820000001", email: "Test.One@example.com" });
  assert.equal(rows[1].first, "สมมุติ");
  assert.equal(rows[2].last, "");
  assert.deepEqual(C.check({ ...rows[2], dept: "PQ" }, { loose: true }).errors, []);
  assert.ok(C.check(rows[2]).errors.length > 0); // self-registration still needs surname and plant
  assert.equal(C.check({ ...rows[0], plant: "x" }).contact.email, "test.one@example.com");
  assert.equal(C.splitName("นางสาวสมหญิง รักงาน").first, "สมหญิง");
});
