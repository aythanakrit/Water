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

## ส่วนที่ 2: เอาเว็บขึ้น Netlify (ฟรี)

1. เข้า https://app.netlify.com แล้วกด **Sign up with GitHub** ใช้บัญชี `aythanakrit`
2. กด **Add new site → Import an existing project → GitHub**
3. อนุญาตให้ Netlify เข้าถึง repo **Water**
4. ตั้งค่าการ deploy
   - Branch to deploy: `claude/capabilities-overview-4oqzvh` (หรือ `main` ถ้ารวม branch แล้ว)
   - Build command และ Publish directory: ไม่ต้องแก้ (อ่านจาก `netlify.toml` เอง)
5. ก่อนกด Deploy ให้กด **Add environment variables** แล้วเพิ่ม 2 ตัว
   - `FIELD_SYNC_URL` = Web app URL จากส่วนที่ 1
   - `FIELD_SYNC_KEY` = ค่า KEY จากส่วนที่ 1
   (ถ้า deploy ไปแล้ว: Site configuration → Environment variables → Add a variable แล้ว Deploys → Trigger deploy)
6. กด **Deploy** จะได้ลิงก์ เช่น `https://xxxx.netlify.app` ตั้งชื่อใหม่ได้ที่ Site configuration → Change site name

ต่อจากนี้ทุกครั้งที่ Claude push โค้ดใหม่ Netlify จะอัปเดตเว็บให้เองภายใน 1–2 นาที

---

## ข้อควรรู้

- **ความปลอดภัย:** ค่า KEY ไม่อยู่ใน GitHub แต่ Netlify จะใส่ไว้ในไฟล์ `config.js` บนเว็บ คนที่มีลิงก์เว็บจึงเขียนข้อมูลลงชีตได้ ให้แชร์ลิงก์เฉพาะในทีม ถ้า KEY หลุด ให้เปลี่ยนค่าใน Script properties และใน Netlify Environment variables ให้ตรงกัน แล้วกด Trigger deploy
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

