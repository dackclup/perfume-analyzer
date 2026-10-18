# ข้อมูลชั้นโน้ตของวัตถุดิบ (ระยะ 1 ของระบบเลือกทีละชั้น)

การออกแบบอยู่ในไฟล์ 12 ของ Project (`project-docs/วิจัยน้ำหอมดีไซน์เนอร์/12-ระบบเลือกกลิ่นทีละชั้น.md`)
ข้อมูลนี้ยังไม่ได้ใส่ในแอป (ระยะ 2)

## ไฟล์

| ไฟล์ | คืออะไร |
|---|---|
| `notes.json` | ผลลัพธ์ต่อรหัสสินค้า: ชั้น ช่วงชั้น ป้าย แหล่ง แง่กลิ่น บทบาท ความแรง ระดับใช้ คู่ที่ใช้ร่วมกัน ลิงก์แหล่ง (คำอธิบาย key อยู่ในช่อง `about`) |
| `coverage.md` | ตารางความครอบคลุม และการเทียบว่าแต่ละแหล่งตรงกันแค่ไหน |
| `sources/file5_tenacity.json` | ตารางติดทนบนแถบจากไฟล์ 5 ส่วนที่ 3 จับคู่กับรหัสสินค้า |
| `sources/project_roles.json` | บันไดเจือจาง (ไฟล์ 5) ตัวเชื่อม (ไฟล์ 5) ลายเซ็น (ไฟล์ 2 ส่วน 7) ฐานที่เด่นตั้งแต่ต้น (ไฟล์ 5) |
| `sources/supplier.jsonl` | ข้อเท็จจริงสั้นจากหน้า ScenTree และ Fraterworks ต่อรหัส (ชั้น ชั่วโมงติดทน ระดับใช้ คำบรรยาย ≤8 คำ คู่ที่ใช้ร่วม) พร้อมลิงก์และวันที่ดึง · ไม่เก็บตัวเลข IFRA จากหน้าผู้ขาย (กติกาข้อ 3) และไม่คัดลอกข้อความบรรยาย |
| `sources/refs.json` | ป้ายคำบรรยาย Leffingwell และระดับความติดทนจากคำบรรยายของ Arctander ผ่าน pyrfume-data (เฉพาะป้ายและตัวเลข) |
| `sources/overrides.json` | (ถ้ามี) ผลตัดสินจากการตรวจด้วยมือ ชนะทุกแหล่ง |

## ลำดับหลักฐานของชั้น

1. ผลดมบนแถบของผู้ใช้ (ระยะ 4 · ยังไม่มี) — ยืนยันแล้ว
2. ตารางไฟล์ 5 · ScenTree "Volatility" · Fraterworks "note" — **ยืนยันแล้ว** (ถ้าขัดกัน ช่วงชั้นขยายให้ครอบทุกแหล่ง และขึ้นใน `coverage.md`)
3. คำบรรยายความติดทนของ Arctander → ชั้น — **อนุมาน**
4. กฎชนิดน้ำมันธรรมชาติ · กฎกลุ่มสารและน้ำหนักโมเลกุล — **อนุมาน**
5. ค่าตั้งต้นของตระกูลในแอป — **เดา**

## สัญญาอนุญาตและที่มา

- **ScenTree** (scentree.co, © Scentree SAS) และ **Fraterworks** (fraterworks.com): เก็บเฉพาะข้อเท็จจริงสั้นพร้อมลิงก์ ดึงด้วย WebFetch ตาม robots.txt ที่อนุญาต (ตรวจ 18 ต.ค. 2026)
- **Leffingwell** (Leffingwell & Associates, cleaned by Sanchez-Lengeling et al., via pyrfume-data): CC BY-NC
- **Arctander** (digitized by the Mainland lab, via pyrfume-data): CC BY-NC 4.0 · ข้อมูลใน `refs.json` ดัดแปลงเป็นป้ายและเกรด
- ไม่ใช้ IFRA Fragrance Ingredient Glossary และข้อมูล The Good Scents Company (ไฟล์ 12 ส่วน 12)
- ข้อมูลชุดนี้ใช้ส่วนตัว ไม่ใช่เชิงพาณิชย์ (ผู้ใช้ยืนยัน 18 ต.ค. 2026)

## รัน

```sh
python3 -I tools/notes/build_notes.py          # สร้าง notes.json และ coverage.md ใหม่
python3 -m unittest discover -s tools/notes -p 'test_*.py'   # รวมเช็กว่าไฟล์ผลลัพธ์ตรงกับการสร้างใหม่
# refs.json สร้างใหม่ได้ด้วย tools/notes/extract_refs.py (วิธีดึง pyrfume-data อยู่ต้นไฟล์)
```
