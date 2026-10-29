const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../time24.js");

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
