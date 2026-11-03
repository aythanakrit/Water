// Build step (Cloudflare Pages / Netlify): writes config.js from environment variables so the
// Apps Script key is not stored in the repository.
// Set FIELD_SYNC_URL and FIELD_SYNC_KEY in the host's environment variables (Cloudflare Pages → Settings → Variables and Secrets).
const fs = require("fs");
const path = require("path");
// Keep only the Web app URL itself (…/macros/s/<id>/exec): a value pasted twice or with spaces still works
const rawUrl = (process.env.FIELD_SYNC_URL || "").trim();
const m = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/.exec(rawUrl);
const url = m ? m[0] : rawUrl;
if (m && url !== rawUrl) console.warn("FIELD_SYNC_URL had extra text after /exec — trimmed");
const key = (process.env.FIELD_SYNC_KEY || "").trim();
// FIELD_SYNC_BACKEND = cloudflare → the app talks to /api (Cloudflare D1 + R2, functions/api.js);
// anything else → straight to the Apps Script as before. Switching back is just changing this variable.
const cloud = (process.env.FIELD_SYNC_BACKEND || "").trim().toLowerCase() === "cloudflare";
if (!url || !key) console.warn("FIELD_SYNC_URL / FIELD_SYNC_KEY not set — field report keeps data on each device only");
fs.writeFileSync(path.join(__dirname, "..", "config.js"),
  `// Generated at build time by tools/write-config.js\nwindow.FIELD_SYNC = ${JSON.stringify({ url: cloud && key ? "/api" : url, key })};\n`);
console.log("config.js written" + (cloud && key ? " (Cloudflare D1 + R2 via /api)" : url ? " (Google Sheets sync on)" : ""));
