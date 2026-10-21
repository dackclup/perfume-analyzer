// Back-test of the step-by-step picker (file 12 section 11) on the published accords in the app (#accord-data).
// For each accord: order its materials base -> mid -> top by their own layer, take the first as the seed, then for
// every next material ask the picker for that material's layer with all earlier ones chosen, and see whether it is
// in the 8 rows the picker shows. Two variants: "leave one out" hides only this accord's own evidence; "no accords"
// hides every accord (only Fraterworks pairings, facets, roles and the ★●○ rating are left — what most materials have).
// Baselines: the ★●○ rating then name within the layer, and random (8 ÷ candidates). Also: the mid/top-only score of
// file 12 section 11, and how the result moves when the weights are halved or doubled.
//
// usage: node tools/notes/backtest.mjs            # write notes/backtest.md
//        node tools/notes/backtest.mjs --check    # exit 1 if notes/backtest.md is out of date
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
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
      rows.push({ acc: a.l.split(' (')[0], seed: by.get(order[0]).n, t, name: by.get(t).n, L, k, picks, ...res,
        tierRank, tierHit: tierRank > 0 && tierRank <= 8, rand: Math.min(8, res.loo.n) / res.loo.n });
    }
  }
  // sensitivity: the same leave-one-out run with the evidence and rating weights halved / doubled
  const sens = [];
  for (const k of [0.5, 1, 2]) for (const e of [0.5, 1, 1.5]) {
    const w = { rating: [0, 5, 10, 20].map((v) => v * k), soft: [40 * e, 15 * e, 0] };
    let hit = 0;
    for (const r of rows) {
      const a = C.accords.find((x) => x.l.split(' (')[0] === r.acc);
      const picks = r.picks;
      if (W.suggest(r.L, { picks, skip: a.i, w }).some((x) => x.pid === r.t)) hit++;
    }
    sens.push(hit);
  }
  const inAcc = (m) => C.accords.filter((a) => a.has.has(m)).length;
  const share = (list, f) => list.filter(f).length / list.length;
  const candAll = W.reps().map((p) => by.get(p));
  app.close();
  const n = rows.length, pct = (v, d = n) => (100 * v / d).toFixed(0) + '%';
  const mt = rows.filter((r) => r.L < 2);
  const sum = {
    targets: n,
    loo: rows.filter((r) => r.loo.hit).length,
    noacc: rows.filter((r) => r.noacc.hit).length,
    design: rows.filter((r) => r.design.hit).length,
    tier: rows.filter((r) => r.tierHit).length,
    rand: rows.reduce((s, r) => s + r.rand, 0),
    midtop: { n: mt.length, loo: mt.filter((r) => r.loo.hit).length, noacc: mt.filter((r) => r.noacc.hit).length, tier: mt.filter((r) => r.tierHit).length },
    sens: [Math.min(...sens), Math.max(...sens), sens.filter((v) => v >= rows.filter((r) => r.tierHit).length).length, sens.length],
  };
  sum.pass = sum.loo >= sum.tier && sum.loo >= 10 * sum.rand;
  const star = (x) => x.s === 3;
  const lines = [
    '# ทดสอบย้อนระบบเลือกทีละชั้น (ไฟล์ 12 ส่วน 11)',
    '',
    'สร้างโดย `tools/notes/backtest.mjs` จากสูตรที่เผยแพร่ในแอป (#accord-data) และตัวเลือกจริงของแอป (`window.__layers`)',
    '',
    `**สรุป:** ตัวเลือกทีละชั้นได้เท่ากับการเรียงตาม ★●○ อย่างเดียว (${sum.loo} กับ ${sum.tier} จาก ${n}) ยังไม่ได้พิสูจน์ว่าดีกว่า · ถ้าตัดหลักฐานจากสูตรที่เผยแพร่ทั้งหมดได้ ${sum.noacc} จาก ${n} (น้อยกว่า ★●○) · ดีกว่าการสุ่มมาก (สุ่มได้ราว ${sum.rand.toFixed(1)} จาก ${n}) · ★●○ เองน่าจะได้เปรียบเกินจริง เพราะมาจากเอกสารชุดเดียวกับสูตรเหล่านี้ (ด้านล่าง) · ยังไม่ได้ทดสอบส่วนของสไตล์`,
    '',
    'วิธี: เรียงวัตถุดิบของแต่ละสูตร ฐาน → กลาง → หัว ตามชั้นของมันเอง · ตัวแรกเป็นตัวตั้ง · ตัวถัดไปแต่ละตัว ถามชั้นของมันโดยเลือกตัวก่อนหน้าไว้แล้ว แล้วดูว่าติด 8 แถวที่แอปแสดงไหม · ไม่เลือกสไตล์',
    '- **ซ่อนสูตรตัวเอง:** ตัดหลักฐานของสูตรนั้นออก สูตรอื่นยังนับ',
    '- **ไม่ใช้สูตรเลย:** ตัดหลักฐานจากสูตรที่เผยแพร่ทั้งหมด เหลือคู่จาก Fraterworks แง่กลิ่น บทบาท และระดับ ★●○ (แบบที่วัตถุดิบส่วนใหญ่มี)',
    '- **★●○ อย่างเดียว:** เรียงตามระดับในแอป แล้วตามชื่อ ในชั้นเดียวกัน',
    '- **น้ำหนักตั้งต้นของไฟล์ 12:** แบบซ่อนสูตรตัวเอง แต่ใช้น้ำหนักเดาเดิม (เรียงตามระดับหลักฐานก่อนคะแนน · ★ +10 · ซ้ำในชั้น −20)',
    '- **สุ่ม:** 8 ÷ จำนวนตัวเลือกในชั้นนั้น',
    '',
    `| วิธี | ติด 8 แถวแรก (ทุกตัว ${n}) | เฉพาะกลางและหัว (${mt.length} · แบบในไฟล์ 12) |`,
    '|---|---|---|',
    `| ซ่อนสูตรตัวเอง | ${sum.loo} (${pct(sum.loo)}) | ${sum.midtop.loo} |`,
    `| ไม่ใช้สูตรเลย | ${sum.noacc} (${pct(sum.noacc)}) | ${sum.midtop.noacc} |`,
    `| น้ำหนักตั้งต้นของไฟล์ 12 | ${sum.design} (${pct(sum.design)}) | ${mt.filter((r) => r.design.hit).length} |`,
    `| ★●○ อย่างเดียว | ${sum.tier} (${pct(sum.tier)}) | ${sum.midtop.tier} |`,
    `| สุ่ม (ค่าคาด) | ${sum.rand.toFixed(1)} (${pct(sum.rand)}) | ${mt.reduce((s, r) => s + r.rand, 0).toFixed(1)} |`,
    '',
    `**เกณฑ์** (ตั้งหลังวัดรอบแรก ตามที่ไฟล์ 12 ให้วัดก่อนตั้งเกณฑ์): แบบซ่อนสูตรตัวเองต้องไม่แย่กว่า ★●○ อย่างเดียว และติดอย่างน้อย 10 เท่าของการสุ่ม → **${sum.pass ? 'ผ่านเกณฑ์ขั้นต่ำ (เท่ากัน ไม่ได้ดีกว่า)' : 'ไม่ผ่าน'}**`,
    '',
    '**ปรับน้ำหนักหลังวัดรอบแรก:** น้ำหนักตั้งต้นของไฟล์ 12 แย่กว่า ★●○ อย่างเดียว (คู่จาก Fraterworks ดันตัว ● ขึ้นเหนือตัว ★ และ −20 "ซ้ำในชั้น" ทำให้ Linalool ตกเมื่อเลือก Hedione แล้ว) จึงเปลี่ยนเป็น: หลักฐานเป็นคะแนน (ยืนยันแล้ว +40 · อนุมาน +15) แทนการเรียงก่อน · ★ +20 ● +10 ○ +5 · ไม่หักคะแนนตัวที่ตระกูลซ้ำ · ปรับและวัดด้วยชุดเดียวกัน ผลจึงมีโอกาสดีเกินจริง',
    `- **ความไวต่อน้ำหนัก:** คูณน้ำหนัก ★●○ ×0.5/×1/×2 และน้ำหนักหลักฐาน ×0.5/×1/×1.5 (${sum.sens[3]} แบบ) ได้ ${sum.sens[0]}–${sum.sens[1]} จาก ${n} · ถึงระดับ ★●○ อย่างเดียว ${sum.sens[2]} จาก ${sum.sens[3]} แบบ — ผลเปราะ`,
    '',
    '**ข้อจำกัด**',
    `- มีสูตรที่เผยแพร่แค่ 5 สูตร และวัตถุดิบซ้ำกันมาก (Iso E Super อยู่ใน ${inAcc(2845)} สูตร · Hedione ${inAcc(2665)}) ผลแบบ "ซ่อนสูตรตัวเอง" จึงยังได้หลักฐานจากสูตรอื่นที่มีวัตถุดิบชุดเดียวกัน · Fougère สมัยใหม่มี ${rows.filter((r) => r.acc.startsWith('Fougère')).length} จาก ${n} ตัว · ${n} ตัวน้อยเกินจะสรุปความต่างไม่กี่ตัว`,
    `- **★●○ อาจรั่ว:** ระดับ ★●○ มาจากเอกสารวิจัยชุดเดียวกับสูตรเหล่านี้ (ไฟล์ 3–4) · วัตถุดิบเป้าหมายติด ★ ${pct(rows.filter((r) => star(by.get(r.t))).length)} ขณะที่ตัวเลือกทั้งหมดติด ★ ${pct(candAll.filter(star).length, candAll.length)} · ตัวเลือกทีละชั้นก็ใช้ ★●○ และบทบาทจากไฟล์ 2, 5 จึงได้เปรียบเดียวกัน`,
    '- ไม่ได้ทดสอบส่วนของสไตล์ (ไม่มีสูตรที่เผยแพร่ของน้ำหอมต้นแบบ) · ผลนี้บอกแค่ว่าแอปเสนอวัตถุดิบที่คนเคยใช้คู่กัน ไม่ได้บอกว่ากลิ่นเข้ากันบนผิวผู้ใช้ — การพิสูจน์จริงคือผลดมของผู้ใช้ (ระยะ 4)',
    '',
    '| สูตร | ลำดับ | วัตถุดิบ | ชั้น | ซ่อนสูตรตัวเอง | ไม่ใช้สูตร | น้ำหนักตั้งต้น | ★●○ | ตัวเลือก |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.acc} | ${r.k + 1} | (${r.t}) ${r.name} | ${LY[r.L]} | ${r.loo.hit ? '✅' : '–'} อันดับ ${r.loo.rank} | ${r.noacc.hit ? '✅' : '–'} อันดับ ${r.noacc.rank} | ${r.design.hit ? '✅' : '–'} อันดับ ${r.design.rank} | ${r.tierHit ? '✅' : '–'} อันดับ ${r.tierRank} | ${r.loo.n} |`),
    '',
  ];
  return { rows, sum, md: lines.join('\n') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {   // also with spaces in the path
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
