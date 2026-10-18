// Back-test of the step-by-step picker (file 12 section 11) on the published accords in the app (#accord-data).
// For each accord: order its materials base -> mid -> top by their own layer, take the first as the seed, then for
// every next material ask the picker for that material's layer with all earlier ones chosen, and see whether it is
// in the 8 rows the picker shows. Two variants: "leave one out" hides only this accord's own evidence; "no accords"
// hides every accord (only Fraterworks pairings, facets, roles and the ★●○ rating are left — what most materials have).
// Baselines: the app's ★●○ order within the layer (old default) and random (8 ÷ candidates).
//
// usage: node tools/notes/backtest.mjs            # write notes/backtest.md
//        node tools/notes/backtest.mjs --check    # exit 1 if notes/backtest.md is out of date
import fs from 'node:fs';
import { loadApp } from '../../tests/app/harness.mjs';

const OUT = new URL('../../notes/backtest.md', import.meta.url);
const LY = ['หัว', 'กลาง', 'ฐาน'];

export function run() {
  const app = loadApp({ runtime: 'none' });
  const W = app.win.__layers, C = app.win.__compat, by = new Map(app.data.items.map((x) => [x.i, x]));
  const rows = [];
  for (const a of C.accords) {
    const mats = a.m.filter((m) => W.note(m));
    const order = [2, 1, 0].flatMap((L) => mats.filter((m) => W.note(m).l === L));
    if (order.length < 2) continue;
    for (let k = 1; k < order.length; k++) {
      const t = order[k], L = W.note(t).l;
      const picks = order.slice(0, k).map((m) => ({ pid: m, L: W.note(m).l }));
      const res = {};
      for (const [name, opt] of [['loo', { skip: a.i }], ['noacc', { noAcc: true }], ['design', { skip: a.i, w: W.designW() }]]) {
        const ranked = W.rank(L, { picks, ...opt });
        const shown = W.suggest(L, { picks, ...opt }).map((r) => r.pid);
        res[name] = { rank: ranked.findIndex((r) => r.pid === t) + 1, n: ranked.length, hit: shown.includes(t),
          tier: (ranked.find((r) => r.pid === t) || {}).tier };
      }
      const cand = W.rank(L, { picks, noAcc: true, noBw: true }).map((r) => r.pid);
      cand.sort((p, q) => (by.get(q).s || 0) - (by.get(p).s || 0) || by.get(p).n.localeCompare(by.get(q).n));
      const tierRank = cand.indexOf(t) + 1;
      rows.push({ acc: a.l.split(' (')[0], seed: by.get(order[0]).n, t, name: by.get(t).n, L, k, ...res,
        tierRank, tierHit: tierRank > 0 && tierRank <= 8, rand: Math.min(8, res.loo.n) / res.loo.n });
    }
  }
  app.close();
  const n = rows.length, pct = (v) => (100 * v / n).toFixed(0) + '%';
  const sum = {
    targets: n,
    loo: rows.filter((r) => r.loo.hit).length,
    noacc: rows.filter((r) => r.noacc.hit).length,
    design: rows.filter((r) => r.design.hit).length,
    tier: rows.filter((r) => r.tierHit).length,
    rand: rows.reduce((s, r) => s + r.rand, 0),
  };
  sum.pass = sum.loo >= sum.tier && sum.loo >= 10 * sum.rand;
  const lines = [
    '# ทดสอบย้อนระบบเลือกทีละชั้น (ไฟล์ 12 ส่วน 11)',
    '',
    'สร้างโดย `tools/notes/backtest.mjs` จากสูตรที่เผยแพร่ในแอป (#accord-data) และตัวเลือกจริงของแอป (`window.__layers`)',
    '',
    'วิธี: เรียงวัตถุดิบของแต่ละสูตร ฐาน → กลาง → หัว ตามชั้นของมันเอง · ตัวแรกเป็นตัวตั้ง · ตัวถัดไปแต่ละตัว ถามชั้นของมันโดยเลือกตัวก่อนหน้าไว้แล้ว แล้วดูว่าติด 8 แถวที่แอปแสดงไหม · ไม่เลือกสไตล์',
    '- **ซ่อนสูตรตัวเอง:** ตัดหลักฐานของสูตรนั้นออก สูตรอื่นยังนับ',
    '- **ไม่ใช้สูตรเลย:** ตัดหลักฐานจากสูตรที่เผยแพร่ทั้งหมด เหลือคู่จาก Fraterworks แง่กลิ่น บทบาท และระดับ ★●○ (แบบที่วัตถุดิบส่วนใหญ่มี)',
    '- **★●○ อย่างเดียว:** เรียงตามระดับในแอป (ลำดับเดิมของคลัง) ในชั้นเดียวกัน',
    '- **น้ำหนักตั้งต้นของไฟล์ 12:** แบบซ่อนสูตรตัวเอง แต่ใช้น้ำหนักเดาเดิม (เรียงตามระดับหลักฐานก่อนคะแนน · ★ +10 · ซ้ำในชั้น −20)',
    '- **สุ่ม:** 8 ÷ จำนวนตัวเลือกในชั้นนั้น',
    '',
    `| วิธี | ติด 8 แถวแรก (จาก ${n} ตัว) |`,
    '|---|---|',
    `| ซ่อนสูตรตัวเอง | ${sum.loo} (${pct(sum.loo)}) |`,
    `| ไม่ใช้สูตรเลย | ${sum.noacc} (${pct(sum.noacc)}) |`,
    `| น้ำหนักตั้งต้นของไฟล์ 12 | ${sum.design} (${pct(sum.design)}) |`,
    `| ★●○ อย่างเดียว | ${sum.tier} (${pct(sum.tier)}) |`,
    `| สุ่ม (ค่าคาด) | ${sum.rand.toFixed(1)} (${pct(sum.rand)}) |`,
    '',
    `**เกณฑ์** (ตั้งหลังวัดรอบแรกตามไฟล์ 12): แบบซ่อนสูตรตัวเองต้องไม่แย่กว่า ★●○ อย่างเดียว และติดอย่างน้อย 10 เท่าของการสุ่ม → **${sum.pass ? 'ผ่าน' : 'ไม่ผ่าน'}**`,
    '',
    '**ปรับน้ำหนักหลังวัดรอบแรก:** น้ำหนักตั้งต้นของไฟล์ 12 แย่กว่า ★●○ อย่างเดียว (คู่จาก Fraterworks ดันตัว ● ขึ้นเหนือตัว ★ และ −20 "ซ้ำในชั้น" ทำให้ Linalool ตกเมื่อเลือก Hedione แล้ว) จึงเปลี่ยนเป็น: หลักฐานเป็นคะแนน (ยืนยันแล้ว +40 · อนุมาน +15) แทนการเรียงก่อน · ★ +20 ● +10 ○ +5 · ไม่หักคะแนนตัวที่ตระกูลซ้ำ · ปรับและวัดด้วยชุดเดียวกัน 27 ตัว ผลจึงมีโอกาสดีเกินจริง',
    '',
    '**ข้อจำกัด:** มีสูตรที่เผยแพร่แค่ 5 สูตร และวัตถุดิบซ้ำกันมาก (Iso E Super, Hedione อยู่ใน 4 สูตร) ผลแบบ "ซ่อนสูตรตัวเอง" จึงดูดีเกินจริงได้ · Fougère สมัยใหม่มี 17 ตัว จึงเป็นส่วนใหญ่ของการทดสอบ · ผลนี้บอกแค่ว่าแอปเสนอวัตถุดิบที่คนเคยใช้คู่กัน ไม่ได้บอกว่ากลิ่นเข้ากันบนผิวผู้ใช้',
    '',
    '| สูตร | ลำดับ | วัตถุดิบ | ชั้น | ซ่อนสูตรตัวเอง | ไม่ใช้สูตร | น้ำหนักตั้งต้น | ★●○ | ตัวเลือก |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.acc} | ${r.k + 1} | (${r.t}) ${r.name} | ${LY[r.L]} | ${r.loo.hit ? '✅' : '–'} อันดับ ${r.loo.rank} | ${r.noacc.hit ? '✅' : '–'} อันดับ ${r.noacc.rank} | ${r.design.hit ? '✅' : '–'} อันดับ ${r.design.rank} | ${r.tierHit ? '✅' : '–'} อันดับ ${r.tierRank} | ${r.loo.n} |`),
    '',
  ];
  return { rows, sum, md: lines.join('\n') };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { md, sum } = run();
  if (process.argv.includes('--check')) {
    const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (old !== md) { console.log('notes/backtest.md is out of date: run node tools/notes/backtest.mjs'); process.exit(1); }
    console.log('notes/backtest.md is up to date');
  } else {
    fs.writeFileSync(OUT, md);
    console.log(JSON.stringify(sum));
  }
  setTimeout(() => process.exit(0), 0);   // the app's own timers would keep node alive
}
