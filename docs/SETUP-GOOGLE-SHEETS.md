# ตั้งค่าใบรายงานสนามให้เก็บข้อมูลกลางใน Google Sheets

ทำครั้งเดียว ใช้เวลาประมาณ 15–20 นาที ไม่มีค่าใช้จ่าย

ทำเสร็จแล้วจะได้
- ทุกเครื่องเห็นงานเดียวกัน เริ่มบันทึกที่หน้างานแล้วไปทำต่อที่ออฟฟิศได้
- กันเลข D/O ซ้ำได้ทุกเครื่อง
- ข้อมูลทั้งหมดอยู่ใน Google Sheet ของบริษัท และเปิดดูหรือดาวน์โหลดเป็น Excel ได้
- ทีมหน้างานไม่ต้องมีบัญชี Claude และกด Export PDF ได้

---

## ส่วนที่ 1: Google Sheet + Apps Script

1. เข้า Google Drive ด้วยบัญชีของบริษัท แล้วสร้าง **Google Sheets ใหม่** ตั้งชื่อว่า `ใบรายงานสนาม`
2. ในชีต ไปที่เมนู **ส่วนขยาย (Extensions) → Apps Script**
3. ในหน้า Apps Script ลบโค้ดเดิมในไฟล์ `Code.gs` ออกทั้งหมด แล้ววางเนื้อหาทั้งไฟล์จาก `apps-script/paste-into-apps-script.gs` จากนั้นกด 💾 บันทึก
4. ตั้งรหัสกันคนนอก: ไปที่ **⚙️ Project Settings → Script properties → Add script property**
   - Property: `KEY`
   - Value: ข้อความยาวที่เดายาก เช่น `mconcrete-pq-7f3k9q2x`
   - กด Save
   - (การ์ดรายชื่อผู้ติดต่อ) เพิ่ม Property: `ADMIN_KEY` · Value: รหัสผู้ดูแล — ใช้เข้าโหมดผู้ดูแลเพื่อแก้/ลบรายชื่อและตั้งแผนก/ตำแหน่ง รายชื่อเก็บในแท็บ `Contacts`
   - (ถ้าใช้ปุ่ม "ส่งเมล" ของ Trial Mix) เพิ่มอีกรายการ Property: `TRIAL_MAIL_TO` · Value: อีเมลผู้รับ (หลายอีเมลคั่นด้วย `,`) — ส่งได้เฉพาะอีเมลนี้ สูงสุด 30 ฉบับ/วัน · ครั้งแรกหลังอัปเดต Google จะขอสิทธิ์ "ส่งอีเมลในนามคุณ" ให้กดอนุญาต
5. เปิดใช้งาน: กดปุ่ม **Deploy → New deployment**
   - กดเฟือง ⚙️ แล้วเลือก **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - กด **Deploy** → **Authorize access** → เลือกบัญชี → Advanced → Go to … (unsafe) → Allow
6. คัดลอก **Web app URL** ที่ลงท้ายด้วย `/exec`

เก็บ Web app URL และค่า KEY ไว้ใช้ในส่วนที่ 2 (ไม่ต้องใส่ลง GitHub)

ชีต `Jobs` และ `Trucks` จะสร้างขึ้นเองเมื่อบันทึกงานแรก ห้ามเปลี่ยนชื่อชีตหรือหัวคอลัมน์

---

## ส่วนที่ 2: เอาเว็บขึ้น Cloudflare Pages (ฟรี)

เว็บใช้งานจริง: **https://production-mconcrete.pages.dev** (ย้ายจาก Netlify เมื่อ 29 ต.ค. 2569 เพราะ Netlify แผนฟรีคิดเครดิตทุกครั้งที่ deploy)

1. เข้า https://dash.cloudflare.com → **Workers & Pages** → **Create**
2. ใต้กล่อง "Make something new" กด **Continue to Pages** (ใช้แบบ Pages ไม่ใช่ Workers) → **Import an existing Git repository** → **Get started**
3. เชื่อม GitHub แบบ **Only select repositories** → เลือก **Water** → **Begin setup**
4. ตั้งค่า
   - Production branch: `claude/capabilities-overview-4oqzvh` (หรือ `main` ถ้ารวม branch แล้ว)
   - Framework preset: `None`
   - Build command: `node tools/write-config.js`
   - Build output directory: เว้นว่าง
5. **Environment variables (advanced)** → เพิ่ม 2 ตัว (แยกตัวละแถว)
   - `FIELD_SYNC_URL` = Web app URL จากส่วนที่ 1 (ลงท้าย `/exec` ครั้งเดียว)
   - `FIELD_SYNC_KEY` = ค่า KEY จากส่วนที่ 1
6. กด **Save and Deploy**

ต่อจากนี้ทุกครั้งที่ Claude push โค้ดใหม่ Cloudflare จะอัปเดตเว็บให้เองภายใน 1–2 นาที

**แก้ค่าตัวแปรภายหลัง:** โปรเจกต์ → **Settings → Variables and Secrets** → ✏️ แก้แถวเดิม (อย่า Add ซ้ำชื่อ) → Save แล้ว **Deployments → ⋯ → Retry deployment** · ตรวจผลที่ `https://production-mconcrete.pages.dev/config.js`

**Netlify เดิม** (`spiffy-meringue-4b49d3.netlify.app`) ตั้ง Stopped builds ไว้ ไม่อัปเดตแล้ว

---

## ข้อควรรู้

- **ความปลอดภัย:** ค่า KEY ไม่อยู่ใน GitHub แต่ตอน build จะถูกใส่ไว้ในไฟล์ `config.js` บนเว็บ คนที่มีลิงก์เว็บจึงเขียนข้อมูลลงชีตได้ ให้แชร์ลิงก์เฉพาะในทีม ถ้า KEY หลุด ให้เปลี่ยนค่าใน Script properties และใน Cloudflare Pages → Settings → Variables and Secrets ให้ตรงกัน แล้ว Retry deployment
- **ออฟไลน์:** เน็ตหลุดที่หน้างานก็บันทึกต่อได้ ข้อมูลจะเก็บในเครื่องไว้ก่อน แล้วส่งขึ้นชีตเองเมื่อมีสัญญาณ
- **D/O ซ้ำจากเครื่องที่ออฟไลน์:** ถ้าสองเครื่องออฟไลน์อยู่และยิงเลขเดียวกัน ชีตจะรับเฉพาะเครื่องที่ส่งถึงก่อน เครื่องที่ส่งทีหลังจะขึ้นกรอบแดงให้แก้
- **แก้โค้ด Apps Script ภายหลัง:** ต้องกด Deploy → Manage deployments → ✏️ → Version: New version → Deploy ไม่อย่างนั้นเว็บจะยังใช้โค้ดเก่า

---

## อัปเดตโค้ด Apps Script (เมื่อ Claude แจ้งว่ามีเวอร์ชันใหม่)

1. เปิด Google Sheet **ใบรายงานสนาม** → **ส่วนขยาย → Apps Script**
2. ในไฟล์ `Code.gs` เลือกทั้งหมด (Ctrl+A) ลบ แล้ววางเนื้อหาใหม่จาก `apps-script/paste-into-apps-script.gs` → 💾 บันทึก
3. **การทำให้ใช้งานได้ (Deploy) → จัดการการทำให้ใช้งานได้ (Manage deployments)**
4. กดไอคอนดินสอ ✏️ → ช่อง **เวอร์ชัน (Version)** เลือก **เวอร์ชันใหม่ (New version)** → **ทำให้ใช้งานได้ (Deploy)**
5. ถ้า Google ขอสิทธิ์เพิ่ม ให้กดอนุญาตเหมือนครั้งแรก

URL ของเว็บแอปเหมือนเดิม ไม่ต้องแก้ Netlify

## ข้อมูลเก่าไปอยู่ไหน
- หน้ารายการงานในเว็บแสดงเฉพาะงานที่ยังไม่จบ และงานที่แก้ไขภายใน 7 วัน
- งานที่จบแล้วเกิน 90 วัน ระบบย้ายไปไฟล์ **"ใบรายงานสนาม - เก็บถาวร ปี"** ใน Google Drive ของบัญชีที่ตั้งสคริปต์ (วันละไม่เกิน 20 งาน)
- เลข D/O ทุกใบที่เคยใช้ยังอยู่ในแท็บ **DO** จึงกันซ้ำได้แม้งานถูกย้ายไปเก็บถาวรแล้ว

