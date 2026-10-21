// Step-by-step summary (file 12, phase 3): starting proportions, the Jean Carles plan, the imbalance warnings.
// The numbers are checked against tools/notes/plan_ref.py, written separately from the rules in file 12.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { loadApp, sleep } from './harness.mjs';

let app;
afterEach(() => { if (app) app.close(); app = null; });
const ROOT = new URL('../../', import.meta.url);

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function cases(W, C) {
  const r = rng(20261021), reps = W.reps(), out = [];
  const alts = reps.flatMap((p) => C.alts(p).filter((q) => q !== p && W.note(q)));   // codes "เลือกเอง" can add
  const pick = (a) => a[Math.floor(r() * a.length)];
  const profs = [null, 'fresh', 'fougere', 'sweet'];
  for (let i = 0; i < 400; i++) {
    const n = 1 + Math.floor(r() * 9), lines = [], seen = new Set();
    while (lines.length < n) {
      const p = r() < 0.1 && alts.length ? pick(alts) : pick(reps);
      if (seen.has(C.mat(p))) continue;
      seen.add(C.mat(p));
      const nt = W.note(p), L = nt.lo + Math.floor(r() * (nt.hi - nt.lo + 1));
      lines.push([p, L]);
    }
    const chain = [2, 1, 0].flatMap((L) => lines.filter((l) => l[1] === L)), jc = {};
    for (let k = 1; k < chain.length; k++) if (r() < (i % 3 ? 0.6 : 0.2)) jc[chain.slice(0, k + 1).map((l) => l[0]).join(',')] = 1 + Math.floor(r() * 9);
    out.push({ lines, prof: pick(profs), jc, full: r() < 0.5, batch: pick([5, 10, 20, 50]) });
  }
  // the published accords, each material in its own layer, and a few edges
  for (const a of C.accords) {
    const lines = a.m.filter((p) => W.note(p)).map((p) => [p, W.note(p).l]);
    for (const prof of profs) out.push({ lines, prof, jc: {}, full: false, batch: 10 });
  }
  out.push({ lines: [[2845, 2]], prof: 'fresh', jc: {}, full: false, batch: 10 });   // one material
  out.push({ lines: [[2557, 2], [2807, 1], [2864, 0]], prof: 'sweet', jc: {}, full: true, batch: 5 });   // strong ones only
  out.push({ lines: [], prof: null, jc: {}, full: false, batch: 10 });
  return out;
}

describe('proportions and the trial plan match the Python reference', () => {
  it('on 400 generated formulas, the 5 published accords and edge cases', () => {
    app = loadApp();
    const W = app.win.__layers, C = app.win.__compat, cs = cases(W, C);
    const ref = JSON.parse(execFileSync('python3', ['-I', 'tools/notes/plan_ref.py'], { cwd: ROOT, input: JSON.stringify(cs), maxBuffer: 64 << 20 }).toString());
    let rows = 0, sets = 0, chosen = 0, warns = 0;
    cs.forEach((c, i) => {
      const got = W.plan({ lines: c.lines.map(([pid, L]) => ({ pid, L })), prof: c.prof, jc: c.jc, full: c.full, batch: c.batch }), want = ref[i], tag = 'case ' + i;
      expect(got.rows.length, tag).toBe(want.rows.length);
      got.rows.forEach((g, j) => {
        const w = want.rows[j];
        expect([g.pid, g.L, g.use.src, g.d, g.bulk, g.td], tag).toEqual([w.pid, w.L, w.src, w.d, w.bulk, w.td]);
        for (const k of ['part', 'start', 'pct', 'weigh']) expect(close(g[k], w[k]), tag + ' ' + g.pid + ' ' + k + ' ' + g[k] + ' vs ' + w[k]).toBe(true);
        for (const k of ['u', 'lo', 'hi']) expect(close(g.use[k], w[k]), tag + ' ' + g.pid + ' ' + k).toBe(true);
        rows++;
      });
      expect(got.upto, tag).toBe(want.upto);
      got.sets.forEach((s, j) => {
        const w = want.sets[j];
        expect([s.k, s.near, s.used, s.chosen, s.out], tag).toEqual([w.k, w.near, w.used, w.chosen, w.out]);
        expect(close(s.at, w.at), tag + ' set ' + s.k).toBe(true);
        sets++; if (s.used) chosen++;
      });
      expect(got.layers.map((l) => l.pct).every((v, L) => close(v, want.layers[L])), tag).toBe(true);
      expect(got.layers.map((l) => l.target).every((v, L) => close(v, want.targets[L])), tag).toBe(true);
      expect(close(got.weigh, want.weigh) && close(got.natural, want.natural) && close(got.total, want.total) && got.down === want.down, tag).toBe(true);
      const gw = got.warn.map((x) => JSON.stringify([x.k, x.at, x.lb])).sort(), ww = want.warn.map((x) => JSON.stringify(x)).sort();   // kind, where and label
      expect(gw, tag).toEqual(ww);
      warns += gw.length;
    });
    expect(rows).toBeGreaterThan(1500);
    expect(chosen).toBeGreaterThan(100);   // trial ratios really were exercised
    expect(warns).toBeGreaterThan(200);
  });
});

describe('proportions follow file 12 section 7', () => {
  it('fill each layer from its bulk materials, keep strong ones at their start, and leave a shortfall empty', () => {
    app = loadApp();
    const W = app.win.__layers;
    const lines = [{ pid: 2845, L: 2 }, { pid: 2884, L: 2 }, { pid: 2810, L: 2 }, { pid: 2665, L: 1 }, { pid: 2685, L: 1 }, { pid: 127688, L: 0 }, { pid: 2557, L: 1 }];
    const p = W.plan({ lines, prof: 'fresh', batch: 10 });
    const by = Object.fromEntries(p.rows.map((r) => [r.pid, r]));
    expect(by[2845].bulk && by[2884].bulk && by[2665].bulk && by[2685].bulk && by[127688].bulk).toBe(true);   // file 3: 10–30 · 5–20 · 5–25 · 2–8 (middle 5) · 5–20
    expect(by[2810].bulk || by[2557].bulk).toBe(false);   // 1–8 · ≤0.5
    expect(by[2810].part).toBe(4.5);   // Ambroxan stays at the middle of 1–8%: not stretched
    expect(by[2557].part).toBe(0.25);   // Calone ≤0.5%
    expect(by[2845].part + by[2884].part + by[2810].part).toBeCloseTo(50, 9);   // base and mid meet their budgets
    expect(by[2665].part + by[2685].part + by[2557].part).toBeCloseTo(25, 9);
    expect(by[2845].part / by[2884].part).toBeCloseTo(20 / 12.5, 9);   // one factor for the layer
    expect(by[127688].part).toBe(20);   // the top's 25 needs Bergamot past its file 3 maximum of 20 …
    expect(by[127688].pct).toBe(20);   // … so the top stays at 20 and 5 of the formula stay empty (round 47: nothing is stretched)
    expect(p.total).toBeCloseTo(95, 9);
    for (const r of p.rows) expect(r.pct).toBe(r.part);   // % of the formula = the part, strong ones at their use
    expect(p.warn.some((w) => w.k === 'range' && w.at === 0)).toBe(false);   // 20% is still inside fresh's 20–30
  });
  it('without a style starts from equal thirds, and an empty layer keeps its share empty', () => {
    app = loadApp();
    const W = app.win.__layers;
    const p = W.plan({ lines: [{ pid: 2845, L: 2 }, { pid: 2665, L: 1 }], prof: null, batch: 10 });
    expect(p.layers.map((l) => l.target)).toEqual([0, 100 / 3, 100 / 3].map((v) => expect.closeTo(v, 9)));
    expect(p.layers.map((l) => l.pct)).toEqual([0, 25, 30].map((v) => expect.closeTo(v, 9)));   // Hedione and Iso E Super at their file 3 maximum
    expect(p.warn.some((w) => w.k === 'gap' && w.at === 0)).toBe(true);
    expect(p.warn.some((w) => w.k === 'range')).toBe(false);   // no style, no profile range
  });
  it('never stretches strong materials: a formula of strong ones only stays tiny (round 47)', () => {
    app = loadApp();
    const p = app.win.__layers.plan({ lines: [{ pid: 2557, L: 2 }, { pid: 2807, L: 1 }, { pid: 2864, L: 0 }], prof: 'sweet', batch: 10 });
    expect(p.rows.map((r) => r.pct)).toEqual([0.25, 0.1, 0.2].map((v) => expect.closeTo(v, 12)));   // Calone ≤0.5 · Indole (Fraterworks 0.1) · Javanol ราว 0.2
    expect(p.total).toBeCloseTo(0.55, 12);
    for (const r of p.rows) expect(r.weigh).toBeLessThan(5);   // was 454.55 g of Calone 1% before round 47
  });
  it('scales everything down when the parts add up to more than 100', () => {
    app = loadApp();
    const W = app.win.__layers, C = app.win.__compat, many = [], seen = new Set();
    let sum = 0;
    for (const pid of W.reps().filter((q) => W.use(q).u < 5).sort((x, y) => W.use(y).u - W.use(x).u)) {   // fixed (not bulk) ones, largest first
      if (sum > 110 || seen.has(C.mat(pid))) continue;
      seen.add(C.mat(pid)); many.push(pid); sum += W.use(pid).u;
    }
    const p = W.plan({ lines: many.map((pid) => ({ pid, L: W.note(pid).l })), prof: null });
    expect(p.rows.reduce((s, r) => s + r.part, 0)).toBeGreaterThan(100);
    expect(p.down).toBe(true);
    expect(p.total).toBeCloseTo(100, 9);
    for (const r of p.rows) expect(r.pct).toBeLessThan(r.part);
  });
  it('says where each starting use comes from', () => {
    app = loadApp();
    const U = app.win.__layers.use;
    expect(U(2845)).toMatchObject({ u: 20, lo: 10, hi: 30, src: 'f3' });
    expect(U(2864)).toMatchObject({ u: 0.2, src: 'f3' });   // "ราว 0.2%"
    expect(U(3223).src).toBe('fw');   // Lavender Bulgarian: the Fraterworks average
    expect(U(2807).src).toBe('fw');   // Indole: file 3 says "ระดับ ppm" (no number), Fraterworks has one
    expect(U(10498)).toMatchObject({ u: 1, src: 'none' });   // no number anywhere: 1% [guess]
  });
});

describe('warnings (section 9)', () => {
  it('flag three muguet aldehydes as one role, but not the published fougère heart (round 47)', () => {
    app = loadApp();
    const W = app.win.__layers, C = app.win.__compat;
    const muguet = W.plan({ lines: [2636, 2706, 2707].map((pid) => ({ pid, L: 1 })), prof: null });   // Florhydral · Cyclamen Aldehyde · Hydroxycitronellal
    expect(muguet.warn.find((w) => w.k === 'dup')).toMatchObject({ at: 1, lb: 1 });
    for (const a of C.accords) for (const prof of [null, 'fresh', 'fougere', 'sweet']) {
      const p = W.plan({ lines: a.m.filter((q) => W.note(q)).map((pid) => ({ pid, L: W.note(pid).l })), prof });
      expect(p.warn.filter((w) => w.k === 'dup' || w.k === 'many' || w.k === 'over' || w.k === 'strong'), a.l + ' ' + prof).toEqual([]);   // no false alarm on what was published
    }
  });
  it('warn at 5 main materials in one layer, not at 4, as an inference', () => {
    app = loadApp();
    const W = app.win.__layers, base = [2845, 2884, 2877, 2894, 2749];   // Iso E Super · Galaxolide · Ethylene Brassylate · Habanolide · Benzyl Salicylate
    const five = W.plan({ lines: base.map((pid) => ({ pid, L: 2 })), prof: 'sweet' });
    expect(five.rows.filter((r) => r.pct >= 5).length).toBe(5);
    expect(five.warn.find((w) => w.k === 'many')).toMatchObject({ at: 2, lb: 1 });
    const four = W.plan({ lines: base.slice(0, 4).map((pid) => ({ pid, L: 2 })), prof: 'sweet' });
    expect(four.warn.some((w) => w.k === 'many')).toBe(false);
  });
  it('label a material past a guessed bound as a guess (round 47)', () => {
    app = loadApp();
    const W = app.win.__layers;
    const p = W.plan({ lines: [{ pid: 2845, L: 2 }, { pid: 2580, L: 2 }], prof: null, jc: { '2845,2580': 1 } });   // Allyl Amyl Glycolate: Fraterworks average only
    const w = p.warn.find((x) => x.at && x.at[0] === 2580);
    expect(w).toMatchObject({ k: 'strong', lb: 2 });
    expect(w.t).toMatch(/เกิน 2 เท่าของค่าเฉลี่ยของ Fraterworks \(0\.25%\)/);
  });
});

describe('trial ratios (section 8)', () => {
  it('replace the start among the materials they cover and keep their share', () => {
    app = loadApp();
    const W = app.win.__layers;
    const lines = [{ pid: 2845, L: 2 }, { pid: 2810, L: 2 }, { pid: 3241, L: 2 }, { pid: 2665, L: 1 }];
    const a = W.plan({ lines, prof: 'fresh', batch: 10 });
    const b = W.plan({ lines, prof: 'fresh', batch: 10, jc: { '2845,2810': 7, '2845,2810,3241': 9 } });
    expect(b.upto).toBe(2);
    const share = (p) => p.rows.slice(0, 3).reduce((s, r) => s + r.pct, 0);
    expect(share(b)).toBeCloseTo(share(a), 9);
    const [iso, amb, pat] = b.rows;
    expect(iso.pct / amb.pct).toBeCloseTo(7 / 3, 9);   // both at 10% in the trial
    expect((iso.pct + amb.pct) / pat.pct).toBeCloseTo(9, 9);
    expect(b.sets[0].at).toBeCloseTo(7, 9);
    expect(b.sets[1].at).toBeCloseTo(9, 9);
    expect(b.rows[3].pct).toBeCloseTo(a.rows[3].pct, 9);   // Hedione keeps its start
    const over = b.warn.find((w) => w.at[0] === 2810);   // Ambroxan 10.5% > file 3's 1–8%, and strong: "may cover" is inferred
    expect(over).toMatchObject({ k: 'over', lb: 1 });
    expect(over.t).toMatch(/เกินช่วงใช้ 1–8% ของไฟล์ 3 และเป็นตัวแรง/);
  });
  it('count only an unbroken run from the first set', () => {
    app = loadApp();
    const W = app.win.__layers;
    const lines = [{ pid: 2845, L: 2 }, { pid: 2810, L: 2 }, { pid: 2665, L: 1 }];
    const p = W.plan({ lines, prof: null, jc: { '2845,2810,2665': 5 } });
    expect(p.upto).toBe(0);
    expect(p.sets[1].chosen).toBe(5);
    expect(p.sets[1].used).toBe(false);
  });
  it('mark the strip nearest the current proportions, with strong materials at their trial dilution', () => {
    app = loadApp();
    const W = app.win.__layers;
    const p = W.plan({ lines: [{ pid: 2845, L: 2 }, { pid: 2557, L: 1 }], prof: null });   // Calone: trial at 1%
    const [iso, cal] = p.rows;
    const A = iso.pct / 10, B = cal.pct / 1;
    expect(p.sets[0].at).toBeCloseTo(10 * A / (A + B), 9);
    expect(p.sets[0].near).toBe(p.sets[0].at > 8 ? 9 : 7);
  });
});

describe('what to weigh', () => {
  it('uses file 5 dilutions, stays at or above 0.1 g, and never goes below the formula tab\'s 1%', () => {
    app = loadApp();
    const W = app.win.__layers;
    const p = W.plan({ lines: [{ pid: 2845, L: 2 }, { pid: 2810, L: 2 }, { pid: 2557, L: 1 }, { pid: 2807, L: 1 }, { pid: 127688, L: 0 }], prof: 'sweet', batch: 5 });
    const by = Object.fromEntries(p.rows.map((r) => [r.pid, r]));
    expect(by[2845].d).toBe(100);
    expect(by[2810].d).toBe(10);   // file 5: Ambroxan 10%
    expect(by[2557].d).toBe(1);   // file 5: Calone 1%
    expect(by[2807].d).toBe(1);   // file 5 says 0.1% for Indole; the formula tab goes down to 1%
    for (const r of p.rows) {
      expect(r.weigh * r.d / 100).toBeCloseTo(r.pure, 12);
      if (r.d > 1) expect(r.weigh).toBeGreaterThanOrEqual(0.1);
    }
    expect(p.rows.reduce((s, r) => s + r.pure, 0)).toBeCloseTo(p.total * 5 / 100, 9);   // grams follow % of the formula
  });
});

// ---------------------------------------------------------------- the summary view
const txt = (sel) => app.$(sel).textContent.replace(/\s+/g, ' ').trim();
const sec = (t) => app.$$('#l-body .fsec').find((s) => s.querySelector('h3').textContent.startsWith(t));
const FRESH = [[2845, 2], [2810, 2], [2665, 1], [127688, 0], [2493, 0]];   // Iso E Super · Ambroxan · Hedione · Bergamot FCF · DHM
async function summary(opts = {}, lines = FRESH, style = 'fresh-amber') {
  app = loadApp(opts);
  await sleep(30);
  app.click('#tab-form');
  app.click('[data-fview="layer"]');
  if (style) app.click('[data-lstyle="' + style + '"]');
  for (const [p, L] of lines) app.win.__formulaUI.add(p, { layer: L });
  app.click('[data-lstep="4"]');
  return app;
}
const rowsOf = () => app.$$('#l-body .lp').map((li) => ({ name: li.querySelector('.lnm').textContent, pct: parseFloat(li.querySelector('.gw').textContent), text: li.textContent }));

describe('summary view', () => {
  it('lists each line with its %, what to weigh and where the start comes from, then the warnings and the trial plan', async () => {
    await summary();
    const rows = rowsOf();
    expect(rows.map((r) => r.name)).toEqual(['Iso E Super', 'Ambroxan', 'Hedione', 'Bergamot FCF', 'Dihydromyrcenol']);
    expect(rows.map((r) => r.pct)).toEqual([30, 4.5, 25, 16.9, 8.1]);   // % of the formula: Iso E Super and Hedione at their file 3 maximum, nothing stretched
    expect(txt('#l-body .lsum')).toMatch(/^รวม 84\.5% ของสูตร · ยังว่าง 15\.5% · แอปไม่ขยายตัวอื่นมาเติม/);
    expect(rows[1].text).toMatch(/ชั่ง 4\.50 g ของสารละลาย 10%/);   // Ambroxan at file 5's 10%
    expect(rows[0].text).toMatch(/ระดับใช้ 10–30% \(ไฟล์ 3\).*ถึงค่าสูงสุดแล้ว/);
    expect(rows[0].text).not.toMatch(/แท็บสูตรรองรับ/);   // the 0.1% note is for file 5's 0.1% list only
    expect(txt('#l-body')).not.toMatch(/รุ่นถัดไป/);
    expect(sec('ชั้นฐาน').querySelector('h3').textContent).toMatch(/34\.5% · ช่วง 45–55%/);
    const warn = txt('#l-body .lwarn');
    expect(warn).toMatch(/ชั้นฐาน 34\.5% ต่ำกว่าช่วงของโปรไฟล์นี้ \(45–55%\).*อนุมาน/);
    expect(warn).toMatch(/IFRA งบผิวแพ้แสง และสารห้าม เช็กที่ "คำนวณ"/);
    expect(txt('#form-layer')).not.toMatch(/เพดาน|ผ่าน/);   // still no IFRA verdict outside the calc view
    expect(sec('แผนทดลองแบบ Jean Carles').querySelector('h3').textContent).toMatch(/4 ชุด × 5 แถบ = 20 แถบ/);
    expect(app.$$('#l-body .jcr').map((g) => g.querySelectorAll('.near').length)).toEqual([1, 1, 1, 1]);   // one dashed strip per set
    expect(txt('#l-body')).toMatch(/สูตรนี้มีน้ำมันธรรมชาติ 16\.9%/);   // Bergamot FCF
  });
  it('scales the grams with the batch and remembers it on this device', async () => {
    await summary();
    const g10 = app.$$('#l-body .lp .l2').map((e) => parseFloat(e.textContent.replace(/^ชั่ง /, '')));
    app.click('#l-body [data-lbatch="20"]');
    const g20 = app.$$('#l-body .lp .l2').map((e) => parseFloat(e.textContent.replace(/^ชั่ง /, '')));
    g10.forEach((g, i) => expect(g20[i]).toBeCloseTo(g * 2, 1));
    expect(app.win.localStorage.getItem('pf.batch')).toBe('20');
    expect(app.doc.activeElement.getAttribute('data-lbatch')).toBe('20');
  });
  it('puts the grams and dilutions into the formula, opens the calc view, and saves the same format as before', async () => {
    await summary();
    const plan = app.win.__layers.plan({ lines: FRESH.map(([pid, L]) => ({ pid, L })), prof: 'fresh', batch: 10 });
    app.click('#l-body [data-lapply]');
    expect(app.$('#form-calc').hidden).toBe(false);
    await sleep(800);
    const saved = app.store.get('fdraft');
    expect(saved.items.map((it) => Object.keys(it).sort().join())).toEqual(Array(5).fill('dil,filt,g,pid'));
    plan.rows.forEach((r) => {
      const it = saved.items.find((x) => x.pid === r.pid);
      expect([it.g, it.dil]).toEqual([app.win.__layers.gRound(r.weigh), r.d]);
    });
    const calc = app.win.__fCalc();
    expect(calc.total).toBeGreaterThan(0);   // the calc view now has grams to check
  });
  it('asks for a second tap before replacing grams, and leaves lines without layer data alone', async () => {
    const doc = { v: 1, conc: 8, certs: {}, items: [{ pid: 2845, g: 2, dil: 100, filt: false }, { pid: 34995, g: 1.5, dil: 100, filt: false }] };
    await summary({ docs: { fdraft: doc } }, [[2810, 2]]);
    expect(sec('อื่นๆ').textContent).toMatch(/กรัมเดิมในสูตรคงไว้/);
    expect(txt('#l-body')).toMatch(/สูตรมีกรัมอยู่แล้ว 1 บรรทัด จะถูกแทน/);
    app.click('#l-body [data-lapply]');
    expect(app.$('#form-calc').hidden).toBe(true);   // not yet
    expect(txt('#l-body [data-lapply]')).toMatch(/แทนกรัมเดิม 1 บรรทัด · แตะอีกครั้งเพื่อยืนยัน/);
    expect(app.doc.activeElement.getAttribute('data-lapply')).toBe('1');
    app.click('#l-body [data-lapply]');
    expect(app.$('#form-calc').hidden).toBe(false);
    await sleep(800);
    const items = app.store.get('fdraft').items;
    expect(items.find((x) => x.pid === 34995)).toMatchObject({ g: 1.5, dil: 100 });
    expect(items.find((x) => x.pid === 2845).g).not.toBe(2);
  });
  it('keeps a picked trial ratio on this device, uses it, clears it on a second tap, and forgets it with the line', async () => {
    await summary();
    const key = '2845,2810', chip = () => app.$('#l-body [data-jc="' + key + '"][data-ja="7"]');
    const before = rowsOf();
    app.click(chip());
    expect(chip().getAttribute('aria-pressed')).toBe('true');
    expect(app.doc.activeElement).toBe(chip());
    expect(JSON.parse(app.win.localStorage.getItem('pf.jc'))).toEqual({ [key]: 7 });
    const after = rowsOf();
    expect(after[0].pct / after[1].pct).toBeCloseTo(7 / 3, 0);
    expect(after[0].pct + after[1].pct).toBeCloseTo(before[0].pct + before[1].pct, 0);
    expect(after[0].text).toMatch(/จากอัตราส่วนที่คุณเลือก/);
    expect(after[2].pct).toBeCloseTo(before[2].pct, 1);
    app.click(chip());
    expect(app.win.localStorage.getItem('pf.jc')).toBe('{}');
    app.click(chip());
    app.click('#l-body [data-jcfull="1"]');   // 9 strips; the pick stays
    expect(app.$$('#l-body .jcr')[0].querySelectorAll('.chip').length).toBe(9);
    app.click('#l-body [data-jc="' + key + '"][data-ja="8"]');
    app.click('#l-body [data-jcfull="0"]');
    expect(app.$$('#l-body .jcr')[0].querySelectorAll('.chip').length).toBe(6);   // 8:2 is kept visible among the 5
    app.click('#l-body .lp [data-fdel="2810"]');   // Ambroxan out: its trial ratio goes too
    expect(app.win.localStorage.getItem('pf.jc')).toBe('{}');
  });
  it('clears every picked ratio with one button', async () => {
    const doc = { v: 1, conc: 8, certs: {}, items: [2845, 2810, 2665].map((pid) => ({ pid, g: null, dil: 100, filt: false })) };
    await summary({ docs: { fdraft: doc }, storage: { 'pf.jc': JSON.stringify({ '2845,2810': 7, '2845,2810,2665': 5, 'junk': 3, '2845,9': 4 }) } }, []);
    expect(app.$$('#l-body .jcr [aria-pressed="true"]').length).toBe(2);   // the malformed key was dropped on load
    expect(Object.keys(JSON.parse(app.win.localStorage.getItem('pf.jc'))).sort()).toEqual(['2845,2810', '2845,2810,2665']);   // and one for a line not in the formula
    app.click('#l-body [data-jcclear]');
    expect(app.$$('#l-body .jcr [aria-pressed="true"]').length).toBe(0);
    expect(app.win.localStorage.getItem('pf.jc')).toBe('{}');
  });
  it('cannot apply while the saved formula is still loading (round 38 guard · round 47 M40)', async () => {
    const doc = { v: 1, conc: 8, certs: {}, items: [2845, 2810, 2665].map((pid) => ({ pid, g: null, dil: 100, filt: false })) };
    app = loadApp({ docs: { fdraft: doc }, cached: { fdraft: doc }, firstDelay: 5000, storage: { 'pf.fview': '"layer"', 'pf.lstep': '4' } });
    await sleep(30);
    app.click('#tab-form');
    expect(app.$$('#l-body .lp').length).toBe(3);   // the cached copy is shown …
    app.click('#l-body [data-lapply]');
    await sleep(800);
    expect(app.writes.filter((w) => w.id === 'fdraft')).toHaveLength(0);   // … but nothing is written
    expect(app.$('#form-calc').hidden).toBe(true);
  });
  it('drops the second-tap state when the view changes, a line goes or the formula changes elsewhere', async () => {
    const doc = { v: 1, conc: 8, certs: {}, items: [{ pid: 2845, g: 2, dil: 100, filt: false }, { pid: 2810, g: null, dil: 100, filt: false }, { pid: 2665, g: null, dil: 100, filt: false }] };
    await summary({ docs: { fdraft: doc } }, []);
    const label = () => txt('#l-body [data-lapply]');
    app.click('#l-body [data-lapply]');
    expect(label()).toMatch(/แตะอีกครั้ง/);
    app.win.__formulaUI.view('calc'); app.win.__formulaUI.view('layer');
    expect(label()).not.toMatch(/แตะอีกครั้ง/);
    app.click('#l-body [data-lapply]');
    app.click('#tab-cat'); app.click('#tab-form');
    expect(label()).not.toMatch(/แตะอีกครั้ง/);
    app.click('#l-body [data-lapply]');
    app.remote('fdraft', { ...doc, items: doc.items.map((it) => (it.pid === 2665 ? { ...it, g: 3 } : it)), at: Date.now(), sid: 'other', n: 1 });   // another device adds grams
    await sleep(30);
    expect(label()).not.toMatch(/แตะอีกครั้ง/);   // the user agreed to replace 1 line, not 2
    expect(txt('#l-body')).toMatch(/สูตรมีกรัมอยู่แล้ว 2 บรรทัด/);
    app.click('#l-body [data-lapply]');
    app.click('#l-body .lp [data-fdel="2810"]');
    expect(label()).not.toMatch(/แตะอีกครั้ง/);
  });
  it('counts only lines with grams above 0 as grams to replace (M37)', async () => {
    const doc = { v: 1, conc: 8, certs: {}, items: [{ pid: 2845, g: 0, dil: 100, filt: false }, { pid: 2665, g: null, dil: 100, filt: false }] };
    await summary({ docs: { fdraft: doc } }, []);
    app.click('#l-body [data-lapply]');
    expect(app.$('#form-calc').hidden).toBe(false);   // one tap
  });
  it('drops a stored trial ratio that is not one of the strips, even for lines in the formula (M38)', async () => {
    const doc = { v: 1, conc: 8, certs: {}, items: [2845, 2810, 2665].map((pid) => ({ pid, g: null, dil: 100, filt: false })) };
    await summary({ docs: { fdraft: doc }, storage: { 'pf.jc': JSON.stringify({ '2845,2810': 11, '2845,2810,2665': 'x' }) } }, []);
    expect(app.$$('#l-body .jcr [aria-pressed="true"]').length).toBe(0);
    expect(app.win.localStorage.getItem('pf.jc')).toBe('{}');
  });
});
