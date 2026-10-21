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
        expect([g.pid, g.L, g.use.src, g.d], tag).toEqual([w.pid, w.L, w.src, w.d]);
        for (const k of ['start', 'pct', 'weigh']) expect(close(g[k], w[k]), tag + ' ' + g.pid + ' ' + k + ' ' + g[k] + ' vs ' + w[k]).toBe(true);
        rows++;
      });
      expect(got.upto, tag).toBe(want.upto);
      got.sets.forEach((s, j) => {
        const w = want.sets[j];
        expect([s.k, s.near, s.used, s.chosen], tag).toEqual([w.k, w.near, w.used, w.chosen]);
        expect(close(s.at, w.at), tag + ' set ' + s.k).toBe(true);
        sets++; if (s.used) chosen++;
      });
      expect(got.layers.map((l) => l.pct).every((v, L) => close(v, want.layers[L])), tag).toBe(true);
      expect(close(got.weigh, want.weigh) && close(got.natural, want.natural), tag).toBe(true);
      const gw = got.warn.map((x) => JSON.stringify([x.k, x.at])).sort(), ww = want.warn.map((x) => JSON.stringify(x)).sort();
      expect(gw, tag).toEqual(ww);
      warns += gw.length;
    });
    expect(rows).toBeGreaterThan(1500);
    expect(chosen).toBeGreaterThan(100);   // trial ratios really were exercised
    expect(warns).toBeGreaterThan(200);
  });
});

describe('proportions follow file 12 section 7', () => {
  it('fill each layer from its bulk materials, keep strong ones at their start, and add up to 100', () => {
    app = loadApp();
    const W = app.win.__layers;
    const lines = [{ pid: 2845, L: 2 }, { pid: 2884, L: 2 }, { pid: 2810, L: 2 }, { pid: 2665, L: 1 }, { pid: 2685, L: 1 }, { pid: 127688, L: 0 }, { pid: 2557, L: 1 }];
    const p = W.plan({ lines, prof: 'fresh', batch: 10 });
    const by = Object.fromEntries(p.rows.map((r) => [r.pid, r]));
    expect(p.rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 9);
    expect(by[2845].bulk && by[2884].bulk && by[2665].bulk && by[2685].bulk && by[127688].bulk).toBe(true);   // file 3: 10–30 · 5–20 · 5–25 · 2–8 (middle 5) · 5–20
    expect(by[2810].bulk || by[2557].bulk).toBe(false);   // 1–8 · ≤0.5
    expect(by[2810].part).toBe(4.5);   // Ambroxan stays at the middle of 1–8%: not stretched
    expect(by[2557].part).toBe(0.25);   // Calone ≤0.5%
    expect(by[2845].part + by[2884].part + by[2810].part).toBeCloseTo(50, 9);   // base and mid meet their budgets
    expect(by[2665].part + by[2685].part + by[2557].part).toBeCloseTo(25, 9);
    expect(by[2845].part / by[2884].part).toBeCloseTo(20 / 12.5, 9);   // one factor for the layer
    expect(by[127688].part).toBe(20);   // the top's 25 needs Bergamot past its file 3 maximum of 20 …
    expect(by[127688].pct).toBeCloseTo(20 / 95 * 100, 9);   // … so the whole is 95 parts
    expect(p.warn.some((w) => w.k === 'range' && w.at === 0)).toBe(false);   // 21.1% is still inside fresh's 20–30
  });
  it('without a style starts from equal thirds, and an empty layer hands its share to the others', () => {
    app = loadApp();
    const W = app.win.__layers;
    const p = W.plan({ lines: [{ pid: 2845, L: 2 }, { pid: 2665, L: 1 }], prof: null, batch: 10 });
    expect(p.layers.map((l) => l.target)).toEqual([0, 50, 50].map((v) => expect.closeTo(v, 9)));
    expect(p.warn.some((w) => w.k === 'gap' && w.at === 0)).toBe(true);
    expect(p.warn.some((w) => w.k === 'range')).toBe(false);   // no style, no profile range
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
    expect(b.warn.some((w) => w.k === 'strong' && w.at[0] === 2810)).toBe(true);   // Ambroxan 11.8% > file 3's 8%
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
    expect(p.rows.reduce((s, r) => s + r.pure, 0)).toBeCloseTo(5, 9);
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
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 0);
    expect(rows[1].text).toMatch(/ชั่ง 5\.\d\d g ของสารละลาย 10%/);   // Ambroxan at file 5's 10%
    expect(rows[0].text).toMatch(/ระดับใช้ 10–30% \(ไฟล์ 3\).*ถึงค่าสูงสุดของช่วง/);
    expect(txt('#l-body')).not.toMatch(/รุ่นถัดไป/);
    expect(sec('ชั้นฐาน').querySelector('h3').textContent).toMatch(/40\.8% · ช่วง 45–55%/);
    const warn = txt('#l-body .lwarn');
    expect(warn).toMatch(/ชั้นฐาน 40\.8% ต่ำกว่าช่วงของโปรไฟล์นี้ \(45–55%\).*อนุมาน/);
    expect(warn).toMatch(/IFRA งบผิวแพ้แสง และสารห้าม เช็กที่ "คำนวณ"/);
    expect(txt('#form-layer')).not.toMatch(/เพดาน|ผ่าน/);   // still no IFRA verdict outside the calc view
    expect(sec('แผนทดลองแบบ Jean Carles').querySelector('h3').textContent).toMatch(/4 ชุด × 5 แถบ = 20 แถบ/);
    expect(app.$$('#l-body .jcr').map((g) => g.querySelectorAll('.near').length)).toEqual([1, 1, 1, 1]);   // one dashed strip per set
    expect(txt('#l-body')).toMatch(/สูตรนี้มีน้ำมันธรรมชาติ 20%/);   // Bergamot FCF, held at file 3's 20%
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
});
