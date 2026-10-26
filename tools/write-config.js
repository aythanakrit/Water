// Netlify build step: writes config.js from environment variables so the
// Apps Script key is not stored in the repository.
// Set FIELD_SYNC_URL and FIELD_SYNC_KEY in Netlify → Site configuration → Environment variables.
const fs = require("fs");
const path = require("path");
const url = process.env.FIELD_SYNC_URL || "";
const key = process.env.FIELD_SYNC_KEY || "";
if (!url || !key) console.warn("FIELD_SYNC_URL / FIELD_SYNC_KEY not set — field report keeps data on each device only");
fs.writeFileSync(path.join(__dirname, "..", "config.js"),
  `// Generated at build time by tools/write-config.js\nwindow.FIELD_SYNC = ${JSON.stringify({ url, key })};\n`);
console.log("config.js written" + (url ? " (Google Sheets sync on)" : ""));
