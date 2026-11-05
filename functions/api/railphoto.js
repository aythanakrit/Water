/*
 * /api/railphoto — photos attached to an equipment move (rail project), sent and served as they are.
 *   POST ?key=…&move=<move id>   body: JPEG/PNG   → stored in R2 under rail/photos/
 *   GET  ?key=…&id=…                              → the picture
 */
import { ensureSchema } from "../_lib/store.js";

const MAX = 8 * 1024 * 1024;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const okKey = (env, url) => env.FIELD_SYNC_KEY && url.searchParams.get("key") === env.FIELD_SYNC_KEY;

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!okKey(env, url)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!env.DB || !env.PHOTOS) return json({ ok: false, error: "no_storage" }, 500);
  const move = String(url.searchParams.get("move") || "");
  await ensureSchema(env.DB);
  if (!(await env.DB.prepare("SELECT id FROM rail_moves WHERE id = ?").bind(move).first())) return json({ ok: false, error: "no_move" }, 400);
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > MAX) return json({ ok: false, error: "too_large" }, 413);
  const type = /png/i.test(request.headers.get("content-type") || "") ? "image/png" : "image/jpeg";
  const id = crypto.randomUUID(), rkey = `rail/photos/${move}/${id}.${type === "image/png" ? "png" : "jpg"}`;
  await env.PHOTOS.put(rkey, body, { httpMetadata: { contentType: type } });
  await env.DB.prepare("INSERT INTO rail_photos (id, move_id, rkey, created) VALUES (?,?,?,?)").bind(id, move, rkey, Date.now()).run();
  return json({ ok: true, id });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!okKey(env, url)) return new Response("unauthorized", { status: 401 });
  if (!env.DB || !env.PHOTOS) return new Response("no storage", { status: 500 });
  await ensureSchema(env.DB);
  const r = await env.DB.prepare("SELECT rkey FROM rail_photos WHERE id = ?").bind(String(url.searchParams.get("id") || "")).first();
  const obj = r && (await env.PHOTOS.get(r.rkey));
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType || "image/jpeg", "cache-control": "private, max-age=86400" } });
}
