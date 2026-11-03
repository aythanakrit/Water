# ย้ายที่เก็บข้อมูลใบรายงานสนามไป Cloudflare (D1 + R2)

แอปเดิมส่งข้อมูลไป Google Apps Script → Google Sheet / Drive
ระบบใหม่ส่งไปที่ `/api` บนเว็บเดียวกัน (`functions/api.js`) ซึ่งเก็บ
- ใบรายงาน รถ D/O → **D1** (ฐานข้อมูล)
- รูปรายงานโครงการ + ไฟล์สำรองรายวัน → **R2**
- Trial Mix (ข้อมูล → D1, รูป → R2 ใต้ `trial/`) — Trial ที่เคยบันทึกไว้ในเครื่องจะส่งขึ้นเองตอนเปิดหน้า
- อีเมลรายงานโครงการ / Trial Mix → ยังส่งต่อไป Apps Script เหมือนเดิม

สลับกลับระบบเดิมได้ทุกเมื่อด้วยตัวแปรเดียว (`FIELD_SYNC_BACKEND`) ข้อมูลใน Google Sheet ไม่ถูกลบ

---

## ส่วนที่ 1 — สร้างที่เก็บข้อมูล (ทำครั้งเดียว ~10 นาที)

1. dash.cloudflare.com → **Storage & Databases → D1** → **Create Database**
   - ชื่อ: `mconcrete-field` → Create (ไม่ต้องสร้างตาราง ระบบสร้างเองตอนใช้ครั้งแรก)
2. **Storage & Databases → R2** → **Create bucket**
   - ชื่อ: `mconcrete-field-photos` · Location: Automatic → Create
   - **ห้ามเปิด Public access** (Printout ต้องดูได้เฉพาะผู้ดูแล)
3. **Workers & Pages** → โปรเจกต์ **production-mconcrete** → **Settings → Bindings** → **Add**
   - **D1 database**: Variable name `DB` → เลือก `mconcrete-field` → Save
   - **R2 bucket**: Variable name `PHOTOS` → เลือก `mconcrete-field-photos` → Save
   - ถ้ามีให้เลือก Production / Preview ให้ใส่ทั้งสองแบบ
4. **Settings → Variables and Secrets** (ของเดิมมี `FIELD_SYNC_URL`, `FIELD_SYNC_KEY` อยู่แล้ว ไม่ต้องแก้)
   - **Add** → Type **Secret** → `REPORT_ADMIN_KEY` = รหัสผู้ดูแลรายงาน **ค่าเดียวกับใน Apps Script** (Script properties)
   - **Add** → Type Text → `MIRROR_TO_SHEET` = `1` (ช่วงทดลอง: ทุกการบันทึกส่งสำเนาไป Google Sheet ด้วย)
   - ยังไม่ต้องใส่ `FIELD_SYNC_BACKEND`
5. **Deployments** → ⋯ ที่อันล่าสุด → **Retry deployment**
6. ตรวจ: เปิด `https://production-mconcrete.pages.dev/api` ต้องเห็น `"DB":true,"PHOTOS":true,...` ทุกตัวเป็น `true`

> ตอนนี้แอปยังใช้ระบบเดิมอยู่ — ส่วนที่ 1 แค่เตรียมของ ไม่กระทบการใช้งาน

## ส่วนที่ 2 — ย้ายข้อมูลเก่า

1. เปิด `https://production-mconcrete.pages.dev/migrate.html` (หน้านี้ไม่มีการ์ดในหน้าหลัก)
2. ต้องเห็น "✓ Cloudflare ตั้งค่าครบ" → ใส่รหัสผู้ดูแลรายงาน → **เริ่มย้ายข้อมูล**
3. รอจนขึ้น "เสร็จแล้ว" — กดซ้ำได้ ข้อมูลที่ย้ายแล้วจะถูกรวม ไม่ซ้ำ
   - งานที่จบเกิน 90 วันอยู่ในไฟล์เก็บถาวรใน Drive ไม่ได้ย้ายมา (ยังเปิดดูใน Drive ได้)

## ส่วนที่ 3 — เปิดใช้ระบบใหม่

1. **Settings → Variables and Secrets → Add** → Type Text → `FIELD_SYNC_BACKEND` = `cloudflare`
2. **Retry deployment**
3. ตรวจ `https://production-mconcrete.pages.dev/config.js` ต้องเห็น `"url":"/api"`
4. เปิดใบรายงานสนาม → แถบสถานะต้องขึ้น "☁️ ซิงค์กับระบบกลางแล้ว"
5. ทุกเครื่อง: ปิดแอปแล้วเปิดใหม่ — ข้อมูลที่ค้างส่งในเครื่องจะส่งเข้าระบบใหม่เอง

**ช่วงทดลอง 1–2 สัปดาห์:** `MIRROR_TO_SHEET = 1` ทำให้ Google Sheet ยังได้สำเนาทุกการบันทึก (ยกเว้นรูป)
พอมั่นใจแล้ว ลบตัวแปร `MIRROR_TO_SHEET` → Retry deployment

## ถ้ามีปัญหา — กลับระบบเดิม

ลบตัวแปร `FIELD_SYNC_BACKEND` (หรือแก้เป็นค่าอื่น) → Retry deployment แอปจะกลับไปใช้ Apps Script ทันที
(ข้อมูลที่บันทึกเข้า D1 ระหว่างนั้นมีสำเนาใน Sheet ถ้าเปิด `MIRROR_TO_SHEET` ไว้)

## สำรองข้อมูล

- ระบบเขียนไฟล์ `backup/field-YYYY-MM-DD.json` ลง R2 วันละครั้งเอง (ครั้งแรกที่มีคนเปิดใบรายงานในวันนั้น)
- กด "สำรองข้อมูลตอนนี้" ในหน้า `migrate.html` ได้ทุกเมื่อ
- ดาวน์โหลดไฟล์สำรอง: R2 → `mconcrete-field-photos` → โฟลเดอร์ `backup/`

## ความปลอดภัย

- รหัส `REPORT_ADMIN_KEY` อยู่เฉพาะใน Cloudflare (Secret) และ Apps Script — ไม่อยู่ใน GitHub
- `FIELD_SYNC_KEY` ยังอยู่ใน `config.js` บนเว็บเหมือนเดิม (คนที่มีลิงก์เว็บบันทึกข้อมูลได้) — แชร์ลิงก์เฉพาะในทีม
- R2 bucket ต้องเป็น Private เสมอ

## โควตาฟรี (ตามหน้าบัญชี ณ พ.ย. 2569)

D1: อ่าน 5M แถว/วัน · เขียน 100k แถว/วัน · 5 GB — แนะนำตั้ง **Budget Alert** ที่หน้า D1 และ R2
