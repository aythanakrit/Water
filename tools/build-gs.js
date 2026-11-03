// Combines fieldsync.js and apps-script/Code.gs into one file to paste into Apps Script.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const out = [
  "// ===== ใบรายงานสนาม — Apps Script (วางไฟล์นี้ทั้งไฟล์ใน Code.gs) =====",
  "// สร้างจาก fieldsync.js + apps-script/Code.gs ด้วย `npm run build:gs` — อย่าแก้ไฟล์นี้โดยตรง",
  "",
  fs.readFileSync(path.join(root, "fieldsync.js"), "utf8"),
  fs.readFileSync(path.join(root, "apps-script/Code.gs"), "utf8"),
].join("\n");
fs.writeFileSync(path.join(root, "apps-script/paste-into-apps-script.gs"), out);
console.log("wrote apps-script/paste-into-apps-script.gs");
