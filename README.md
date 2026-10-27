# KIOSA Back Office

หน้าเว็บ back office ของ KIOSA (ทรัพย์ · ลูกค้า · ดีล · รายงาน · โบรชัวร์)

- **หน้าเว็บ (ไฟล์นี้)** อยู่บน GitHub Pages: `index.html`, `backend.js`, `config.js`
- **ข้อมูลทั้งหมด** อยู่ใน Google Sheet ของบริษัท ผ่าน Google Apps Script (`apps-script/Code.gs`)
- **รูปและเอกสาร** อยู่ใน Google Drive โฟลเดอร์ `KIOSA Hub Files`
- **เข้าใช้งาน** ด้วยรหัสผ่านทีม (ตั้งในแท็บ `users` ของ Sheet)

repo นี้ไม่มีข้อมูลทรัพย์ เจ้าของ หรือลูกค้า มีแค่โค้ด

## เพิ่ม / เปลี่ยนรหัสผ่านทีม
เปิด Google Sheet → แท็บ `users` → พิมพ์รหัสผ่านใหม่ในคอลัมน์ `set_password` ของคนนั้น
(เพิ่มคนใหม่ = เพิ่มแถว: username, name, set_password, เว้นว่าง, เว้นว่าง, TRUE)
รหัสผ่านจะถูกเข้ารหัสและลบออกจากช่องเองตอนมีคนล็อกอินครั้งถัดไป · ปิดสิทธิ์ใคร = ตั้ง `active` เป็น FALSE

## ประวัติการแก้ไข
แท็บ `history` ใน Sheet บันทึกทุกการเพิ่ม/แก้/ลบ ว่าใครแก้อะไร เมื่อไหร่

## แก้ไขระบบ
แก้ใน Claude แล้ว build ใหม่ (`build.py`) แล้วอัปโหลด `index.html` ทับไฟล์เดิม
ห้ามแก้ `config.js` นอกจากเปลี่ยน URL ของ Apps Script
