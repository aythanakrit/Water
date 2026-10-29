const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../numpad.js");

test("typing keeps digits and adds the colon after the hours", () => {
  assert.equal(T.typing("1"), "1");
  assert.equal(T.typing("104"), "1:04");
  assert.equal(T.typing("633"), "6:33");
  assert.equal(T.typing("1048"), "10:48");
  assert.equal(T.typing("10:48"), "10:48");
  assert.equal(T.typing("10:489"), "10:48");
  assert.equal(T.typing("ab12"), "12");
});

test("leaving the field gives HH:MM in 24 hours, or null when it is not a time", () => {
  assert.equal(T.normalize("948"), "09:48");
  assert.equal(T.normalize(T.typing("633")), "06:33");
  assert.equal(T.normalize("6:33"), "06:33");
  assert.equal(T.normalize("7"), "07:00");
  assert.equal(T.normalize("2248"), "22:48");
  assert.equal(T.normalize("6.33"), "06:33");
  assert.equal(T.normalize(""), "");
  assert.equal(T.normalize("2460"), null);
  assert.equal(T.normalize("25:00"), null);
  assert.equal(T.normalize("10:48 PM"), null);
});

test("dates are shown 29/10/2569 and read back as ISO", () => {
  assert.equal(T.isoToTh("2026-10-29"), "29/10/2569");
  assert.equal(T.isoToTh(""), "");
  assert.equal(T.dateTyping("2910"), "29/10");
  assert.equal(T.dateTyping("29102569"), "29/10/2569");
  assert.equal(T.dateTyping("291025699"), "29/10/2569");
  assert.equal(T.thToIso("29/10/2569"), "2026-10-29");
  assert.equal(T.thToIso("1/2/2026"), "2026-02-01"); // a Christian year works too
  assert.equal(T.thToIso("29/02/2569"), null); // 2026 is not a leap year
  assert.equal(T.thToIso("29/10/25"), null);
  assert.equal(T.thToIso(""), "");
});

test("plain numbers: digits only, one decimal point", () => {
  assert.equal(T.numTyping("0372610280007"), "0372610280007");
  assert.equal(T.numTyping("72a10"), "7210");
  assert.equal(T.numTyping("5.5.", true), "5.5");
  assert.equal(T.numTyping("5.5", false), "55");
});
