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
3. ในหน้า Apps Script
   - ลบโค้ดเดิมในไฟล์ `Code.gs` ออกทั้งหมด แล้ววางเนื้อหาจากไฟล์ `apps-script/Code.gs` ใน repo
   - กดปุ่ม **+** ข้างคำว่า Files แล้วเลือก **Script** ตั้งชื่อว่า `fieldsync` แล้ววางเนื้อหาจากไฟล์ `fieldsync.js` ใน repo
   - กด 💾 บันทึก
4. ตั้งรหัสกันคนนอก: ไปที่ **⚙️ Project Settings → Script properties → Add script property**
   - Property: `KEY`
   - Value: ข้อความยาวที่เดายาก เช่น `mconcrete-pq-7f3k9q2x`
   - กด Save
5. เปิดใช้งาน: กดปุ่ม **Deploy → New deployment**
   - กดเฟือง ⚙️ แล้วเลือก **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - กด **Deploy** → **Authorize access** → เลือกบัญชี → Advanced → Go to … (unsafe) → Allow
6. คัดลอก **Web app URL** ที่ลงท้ายด้วย `/exec`

**ส่งให้ Claude 2 อย่าง:** Web app URL และค่า KEY แล้ว Claude จะใส่ลงไฟล์ `config.js` ให้

ชีต `Jobs` และ `Trucks` จะสร้างขึ้นเองเมื่อบันทึกงานแรก ห้ามเปลี่ยนชื่อชีตหรือหัวคอลัมน์

---

## ส่วนที่ 2: เอาเว็บขึ้น Netlify (ฟรี)

1. เข้า https://app.netlify.com แล้วกด **Sign up with GitHub** ใช้บัญชี `aythanakrit`
2. กด **Add new site → Import an existing project → GitHub**
3. อนุญาตให้ Netlify เข้าถึง repo **Water**
4. ตั้งค่าการ deploy
   - Branch to deploy: `claude/capabilities-overview-4oqzvh` (หรือ `main` ถ้ารวม branch แล้ว)
   - Build command: เว้นว่าง
   - Publish directory: `.`
5. กด **Deploy** จะได้ลิงก์ เช่น `https://xxxx.netlify.app` ตั้งชื่อใหม่ได้ที่ Site configuration → Change site name

ต่อจากนี้ทุกครั้งที่ Claude push โค้ดใหม่ Netlify จะอัปเดตเว็บให้เองภายใน 1–2 นาที

---

## ข้อควรรู้

- **ความปลอดภัย:** ค่า KEY จะอยู่ในไฟล์ `config.js` บนเว็บ คนที่มีลิงก์เว็บจึงเขียนข้อมูลลงชีตได้ ให้แชร์ลิงก์เฉพาะในทีม ถ้า KEY หลุด ให้เปลี่ยนค่าใน Script properties แล้วแจ้ง Claude ให้แก้ `config.js`
- **ออฟไลน์:** เน็ตหลุดที่หน้างานก็บันทึกต่อได้ ข้อมูลจะเก็บในเครื่องไว้ก่อน แล้วส่งขึ้นชีตเองเมื่อมีสัญญาณ
- **D/O ซ้ำจากเครื่องที่ออฟไลน์:** ถ้าสองเครื่องออฟไลน์อยู่และยิงเลขเดียวกัน ชีตจะรับเฉพาะเครื่องที่ส่งถึงก่อน เครื่องที่ส่งทีหลังจะขึ้นกรอบแดงให้แก้
- **แก้โค้ด Apps Script ภายหลัง:** ต้องกด Deploy → Manage deployments → ✏️ → Version: New version → Deploy ไม่อย่างนั้นเว็บจะยังใช้โค้ดเก่า
