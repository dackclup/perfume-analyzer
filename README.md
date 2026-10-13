# perfume-analyzer · MSR catalog

ดึงรายชื่อวัตถุดิบน้ำหอม หัวน้ำหอม Benchmark และอุปกรณ์ จาก sitemap สาธารณะของ
[MySkinRecipes Thailand](https://www.myskinrecipes.com/shop/th/) ด้วย GitHub Actions

## ใช้งาน

1. GitHub → **Actions** → **MSR catalog scrape** → **Run workflow** (stage = `sitemap`)
2. ผลอยู่ที่ branch **`msr-data`** → `data/msr/`
   - `perfumery_products.csv` สินค้าที่เกี่ยวกับน้ำหอม (id, category, name, url)
   - `tools_packaging.csv` ขวด ปิเปต เครื่องชั่ง และอุปกรณ์
   - `category_counts.csv` จำนวนสินค้าต่อหมวดทั้งร้าน
   - `run_log.txt` สรุปการรัน

workflow รันเองเมื่อมีการแก้โค้ดใน `tools/msr-catalog/`, `tests/` หรือไฟล์ workflow บน `main`

## ราคา

stage `all` จะเปิดหน้าสินค้าด้วย headless Chromium เพื่ออ่านราคา แต่ตั้งแต่ 13 ต.ค. 2026
ร้านตอบเบราว์เซอร์อัตโนมัติด้วย HTTP 403 สคริปต์จึงหยุดทันทีที่โดนปฏิเสธ — อย่าหาทางเลี่ยง

## ทดสอบในเครื่อง

```sh
npm ci
npm test          # vitest: parsing, classification, CSV
npm run scrape    # ต้องเข้าถึง myskinrecipes.com ได้
```

## ประวัติ

repo นี้เคยเป็นเว็บแอป perfume analyzer + formulation engine ถูกรื้อออกเมื่อ 13 ต.ค. 2026
โค้ดเดิมยังอยู่ในประวัติ git ที่ commit `558e69c`
