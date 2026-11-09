/*
 * /api/repairphoto — photos and PDF memos of a repair job, sent and served as they are.
 *   POST ?key=…&job=<repair id>[&name=<file name>]   body: JPEG/PNG/PDF   → stored in R2 under repair/<job>/
 *   GET  ?key=…&id=…                              → the picture
 */
import { ensureSchema } from "../_lib/store.js";

const MAX = 8 * 1024 * 1024, MAX_PDF = 20 * 1024 * 1024;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const okKey = (env, url) => env.FIELD_SYNC_KEY && url.searchParams.get("key") === env.FIELD_SYNC_KEY;

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!okKey(env, url)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!env.DB || !env.PHOTOS) return json({ ok: false, error: "no_storage" }, 500);
  const job = String(url.searchParams.get("job") || "");
  await ensureSchema(env.DB);
  if (!(await env.DB.prepare("SELECT id FROM repairs WHERE id = ? AND removed IS NULL").bind(job).first())) return json({ ok: false, error: "no_job" }, 400);
  const ct = request.headers.get("content-type") || "", pdf = /pdf/i.test(ct);
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > (pdf ? MAX_PDF : MAX)) return json({ ok: false, error: "too_large" }, 413);
  if (pdf && new TextDecoder().decode(new Uint8Array(body, 0, 5)) !== "%PDF-") return json({ ok: false, error: "not_pdf" }, 400);
  const type = pdf ? "application/pdf" : /png/i.test(ct) ? "image/png" : "image/jpeg";
  const id = crypto.randomUUID(), rkey = `repair/${job}/${id}.${pdf ? "pdf" : type === "image/png" ? "png" : "jpg"}`, now = Date.now();
  const name = pdf ? (String(url.searchParams.get("name") || "").replace(/[\u0000-\u001f\\/]+/g, " ").trim().slice(0, 120) || "เมมโม่.pdf") : null;
  await env.PHOTOS.put(rkey, body, { httpMetadata: { contentType: type } });
  await env.DB.batch([env.DB.prepare("INSERT INTO repair_photos (id, repair_id, rkey, created, name) VALUES (?,?,?,?,?)").bind(id, job, rkey, now, name),
    env.DB.prepare("UPDATE repairs SET updated = ? WHERE id = ?").bind(now, job)]);
  return json({ ok: true, id });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!okKey(env, url)) return new Response("unauthorized", { status: 401 });
  if (!env.DB || !env.PHOTOS) return new Response("no storage", { status: 500 });
  await ensureSchema(env.DB);
  const r = await env.DB.prepare("SELECT rkey, name FROM repair_photos WHERE id = ? AND removed IS NULL").bind(String(url.searchParams.get("id") || "")).first();
  const obj = r && (await env.PHOTOS.get(r.rkey));
  if (!obj) return new Response("not found", { status: 404 });
  const h = { "content-type": obj.httpMetadata?.contentType || "image/jpeg", "cache-control": "private, max-age=86400" };
  if (r.name) h["content-disposition"] = `inline; filename*=UTF-8''${encodeURIComponent(r.name)}`;
  return new Response(obj.body, { headers: h });
}
