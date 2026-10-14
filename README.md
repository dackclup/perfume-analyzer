# perfume-analyzer · MSR catalog + doc checks

เครื่องมือของ Project "น้ำหอม" บน claude.ai มีสองส่วน

- **MSR catalog** ดึงรายชื่อวัตถุดิบน้ำหอม หัวน้ำหอม Benchmark และอุปกรณ์ จาก sitemap สาธารณะของ
  [MySkinRecipes Thailand](https://www.myskinrecipes.com/shop/th/)
- **MSR verify** ตรวจเอกสารใน Project กับ sitemap ของร้าน และล้มเมื่อเจอความผิดพลาดแบบที่เคยเกิด

## MSR catalog

1. GitHub → **Actions** → **MSR catalog scrape** → **Run workflow** (stage = `sitemap`)
2. ผลอยู่ที่ branch **`msr-data`** → `data/msr/`
   - `perfumery_products.csv` สินค้าที่เกี่ยวกับน้ำหอม (id, category, name, url)
   - `tools_packaging.csv` ขวด ปิเปต เครื่องชั่ง และอุปกรณ์
   - `category_counts.csv` จำนวนสินค้าต่อหมวดทั้งร้าน
   - `run_log.txt` สรุปการรัน

workflow รันเองเมื่อมีการแก้โค้ดใน `tools/msr-catalog/`, `tests/` หรือไฟล์ workflow บน `main`

## MSR verify (ตรวจเอกสาร)

`project-docs/` คือสำเนาเอกสารใน Project (claude.ai) ทุกครั้งที่ push การแก้ไขในโฟลเดอร์นี้ขึ้น `main`
workflow **MSR verify** จะอ่าน sitemap ทั้งร้านแล้วตรวจ (และรันเองทุกวันจันทร์)

| ตรวจ | ล้มเมื่อ |
|---|---|
| `missing_id` | รหัสที่อ้างในไฟล์ 0–7 ไม่อยู่ใน sitemap แต่ไม่ได้เขียน ⓧ หลังรหัส เช่น `(2890 ⓧ)` |
| `stale_mark` | รหัสที่เขียนว่า `1234 ⓧ` กลับมาอยู่ใน sitemap แล้ว |
| `link_mismatch` | ลิงก์สินค้าไม่ตรงกับ URL ใน sitemap หรือรหัสในข้อความลิงก์ไม่ตรงกับรหัสใน URL |
| `absent_but_sold` | เอกสารบอกว่า "ร้านไม่มี X" แต่ sitemap มีสินค้าชื่อ X และบรรทัดนั้นไม่ได้อ้างรหัสของมัน |
| `banned_unmarked` | ชื่อหรือรหัสในรายการห้ามใช้ (ไฟล์ 4 ส่วน O แถว ⛔) อยู่ในไฟล์ 0–6 โดยไม่มี ⛔ หรือคำเตือน |
| `index_missing` | สารบัญในไฟล์ 0 ไม่มีแถวของไฟล์ที่มีอยู่ (สัญญาณว่ามีแชทเขียนทับจากสำเนาเก่า) |

สิ่งที่ตัวตรวจอ่านได้และอ่านไม่ได้ เขียนไว้ต้น `tools/msr-verify/docs_check.py` (เช่น รหัสต้องอยู่ในวงเล็บหลังชื่อ
ชื่อที่เขียนเป็นภาษาไทยอย่างเดียวยังตรวจไม่ได้) · ถ้าอ่าน sitemap ได้ไม่ครบ ระบบจะไม่ตรวจรหัสและล้มทันที

ผลของการรันบน `main` อยู่ที่ branch **`msr-verify-data`** (`summary.md`, `doc_check.md`, `doc_problems.csv`,
`sitemap_products.csv.gz`) · การรันจาก branch อื่นไปที่ `msr-verify-data-test`
ข้อยกเว้นที่ตรวจแล้วใส่ใน `tools/msr-verify/allow.json` เป็นรายการ `{"key": "...", "why": "..."}`
(key ดูจาก `doc_problems.csv`)

ขั้นตอนเมื่อ AI แก้เอกสารใน Project (session ของ Claude Code):

```sh
# 1. อ่านเอกสารด้วย project_read แล้วคัดลอกข้อความจริงลงสำเนา
python3 tools/msr-verify/pull_docs.py
# 2. ตรวจในเครื่องก่อน (ดึง sitemap จากการรันล่าสุดใน branch msr-verify-data ให้เอง)
python3 tools/msr-verify/docs_check.py
# 3. แก้ไฟล์ใน project-docs/ จนผ่าน แล้วอัปโหลดกลับด้วย project_write (local_path) และ push
```

## ราคา

stage `all` จะเปิดหน้าสินค้าด้วย headless Chromium เพื่ออ่านราคา แต่ตั้งแต่ 13 ต.ค. 2026
ร้านตอบเบราว์เซอร์อัตโนมัติด้วย HTTP 403 สคริปต์จึงหยุดทันทีที่โดนปฏิเสธ — อย่าหาทางเลี่ยง

## ทดสอบในเครื่อง

```sh
npm ci
npm test          # vitest: parsing, classification, CSV
npm run scrape    # ต้องเข้าถึง myskinrecipes.com ได้
python3 -m unittest discover -s tools/msr-verify -p 'test_*.py'   # MSR verify (offline)
```

## ประวัติ

repo นี้เคยเป็นเว็บแอป perfume analyzer + formulation engine ถูกรื้อออกเมื่อ 13 ต.ค. 2026
โค้ดเดิมยังอยู่ในประวัติ git ที่ commit `558e69c`
