/*
 * /api/raildoc — PDF files of the rail-project library, sent and served as they are (no base64).
 *   POST ?key=…&title=…&cat=…   body: the PDF        → stores it in R2 and lists it
 *   GET  ?key=…&id=…[&dl=1]                           → the PDF (inline for viewing/printing, or as a download)
 */
import { ensureSchema } from "../_lib/store.js";

const MAX = 25 * 1024 * 1024;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const okKey = (env, url) => env.FIELD_SYNC_KEY && url.searchParams.get("key") === env.FIELD_SYNC_KEY;

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (!okKey(env, url)) return json({ ok: false, error: "unauthorized" }, 401);
  if (!env.DB || !env.PHOTOS) return json({ ok: false, error: "no_storage" }, 500);
  const title = String(url.searchParams.get("title") || "").trim().slice(0, 150);
  const cat = String(url.searchParams.get("cat") || "").trim().slice(0, 60);
  const len = Number(request.headers.get("content-length") || 0);
  if (!title) return json({ ok: false, error: "no_title" }, 400);
  if (len > MAX) return json({ ok: false, error: "too_large" }, 413);
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX) return json({ ok: false, error: "too_large" }, 413);
  if (new TextDecoder().decode(new Uint8Array(body.slice(0, 5))) !== "%PDF-") return json({ ok: false, error: "not_pdf" }, 400);
  await ensureSchema(env.DB);
  const id = crypto.randomUUID(), rkey = `rail/docs/${id}.pdf`;
  await env.PHOTOS.put(rkey, body, { httpMetadata: { contentType: "application/pdf" } });
  await env.DB.prepare("INSERT INTO rail_docs (id, title, cat, size, rkey, created, removed) VALUES (?,?,?,?,?,?,NULL)")
    .bind(id, title, cat, body.byteLength, rkey, Date.now()).run();
  return json({ ok: true, id });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!okKey(env, url)) return new Response("unauthorized", { status: 401 });
  if (!env.DB || !env.PHOTOS) return new Response("no storage", { status: 500 });
  await ensureSchema(env.DB);
  const r = await env.DB.prepare("SELECT title, rkey FROM rail_docs WHERE id = ? AND removed IS NULL").bind(String(url.searchParams.get("id") || "")).first();
  const obj = r && (await env.PHOTOS.get(r.rkey));
  if (!obj) return new Response("not found", { status: 404 });
  const name = encodeURIComponent(r.title.replace(/[\\/:*?"<>|]+/g, "-") + ".pdf");
  return new Response(obj.body, { headers: { "content-type": "application/pdf", "cache-control": "private, max-age=300",
    "content-disposition": `${url.searchParams.get("dl") ? "attachment" : "inline"}; filename*=UTF-8''${name}` } });
}
