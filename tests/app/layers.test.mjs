// Step-by-step picker (file 12, phase 2): the embedded note data, the suggestions, the view, and the back-test.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadApp, sleep } from './harness.mjs';
import { run as backtest } from '../../tools/notes/backtest.mjs';

let app;
afterEach(() => { if (app) app.close(); app = null; });
const ROOT = new URL('../../', import.meta.url);
const txt = (sel) => app.$(sel).textContent.replace(/\s+/g, ' ').trim();
const sec = (t) => app.$$('#l-body .fsec').find((s) => s.querySelector('h3').textContent.startsWith(t));   // a summary section by its title
async function layerView(opts) {
  app = loadApp(opts);
  await sleep(30);
  app.click('#tab-form');
  app.click('[data-fview="layer"]');
  return app;
}

describe('note data in the app', () => {
  it('matches notes/notes.json and notes/sources/styles.json (embed_notes.py --check)', () => {
    execFileSync('python3', ['-I', 'tools/notes/embed_notes.py', '--check'], { cwd: ROOT });   // throws when out of date
  });
  it('covers every selectable material and nothing else', () => {
    app = loadApp();
    const W = app.win.__layers, by = new Map(app.data.items.map((x) => [x.i, x]));
    for (const x of app.data.items) expect(!!W.note(x.i), x.i + ' ' + x.n).toBe(x.t === 1 || x.t === 2);
    for (const p of W.reps()) expect([1, 2]).toContain(by.get(p).t);
    expect(W.styles().length).toBe(10);
  });
});

describe('suggestions', () => {
  it('stay inside the layer range, skip chosen materials and their other codes, and come with reasons', () => {
    app = loadApp();
    const W = app.win.__layers, C = app.win.__compat, by = new Map(app.data.items.map((x) => [x.i, x]));
    const picks = [{ pid: 2845, L: 2 }, { pid: 3222, L: 1 }];   // Iso E Super · Lavender French (alternates 3223, 6901, 33088)
    for (const L of [0, 1, 2]) {
      const all = W.rank(L, { picks });
      expect(all.length).toBeGreaterThan(100);
      for (const r of all) {
        const n = W.note(r.pid);
        expect(n.lo <= L && L <= n.hi, r.pid).toBe(true);
        expect([2845, 3222, 3223, 6901, 33088]).not.toContain(r.pid);
        expect(C.mat(r.pid)).toBe(r.pid);
        expect(r.why.length).toBeGreaterThan(0);
        expect(r.lay).toMatch(/^ชั้น/);
      }
      const top = W.suggest(L, { picks }), fam = {};
      expect(top.length).toBe(8);
      for (const r of top) fam[by.get(r.pid).f] = (fam[by.get(r.pid).f] || 0) + 1;
      for (const f in fam) expect(fam[f], f).toBeLessThanOrEqual(3);
      for (let i = 1; i < all.length; i++) expect(all[i - 1].score, all[i].pid).toBeGreaterThanOrEqual(all[i].score);   // evidence is in the score (round 44)
    }
  });
  it('never offers a banned material, a solvent or a finished fragrance oil', () => {
    app = loadApp();
    const W = app.win.__layers, by = new Map(app.data.items.map((x) => [x.i, x]));
    const banned = [...app.data.hidden, ...app.data.hidden_eu, ...app.data.hidden_doc].map((s) => s.split(' (')[0].toLowerCase());
    for (const style of [null, ...W.styles().map((s) => s.id)]) for (const L of [0, 1, 2]) for (const r of W.rank(L, { style })) {
      const x = by.get(r.pid);
      expect([1, 2]).toContain(x.t);
      expect(banned).not.toContain(x.n.split(/ \(|, /)[0].toLowerCase());
    }
  });
  it('counts a published accord, a Fraterworks pairing and a style note as evidence', () => {
    app = loadApp();
    const W = app.win.__layers;
    const mid = W.rank(1, { picks: [{ pid: 2845, L: 2 }] });
    const hed = mid.find((r) => r.pid === 2665);
    expect(hed.tier).toBe(0);
    expect(hed.why.join(' ')).toMatch(/สูตรที่เผยแพร่เดียวกับ Iso E Super/);
    expect(hed.why.join(' ')).toMatch(/Fraterworks ระบุว่าใช้คู่กับ Iso E Super/);
    const base = W.rank(2, { style: 'fresh-amber' });
    const amb = base.find((r) => r.pid === 2810);
    expect(amb.tier).toBe(0);
    expect(amb.why[0]).toBe('ลายเซ็นของ Sauvage · โน้ตของ Sauvage ตามไฟล์ 2');
    const hedS = W.rank(1, { style: 'fresh-amber' }).find((r) => r.pid === 2665);   // Hedione: file 3's set for this style, not a Sauvage note
    expect(hedS.tier).toBe(1);
    expect(hedS.why[0]).toBe('อยู่ในชุดวัตถุดิบแนว Fresh "blue" ambery ของไฟล์ 3 [อนุมาน]');
    expect(W.suggest(2, { style: 'aquatic' }).map((r) => r.pid)).toContain(2557);   // Calone: a base that shows early (file 5)
    const none = base.find((r) => r.tier === 2);
    expect(none.why.join(' ')).toMatch(/\[เดา\]/);
  });
  it('warns, without hiding, when Methyl Anthranilate meets an aldehyde or Vanillin (file 5)', () => {
    app = loadApp();
    const W = app.win.__layers;
    const van = W.rank(2, { picks: [{ pid: 3310, L: 1 }] }).find((r) => r.pid === 2828);
    expect(van.warn.join(' ')).toMatch(/อาจเปลี่ยนสีกับ Methyl Anthranilate/);
    const dma = W.rank(2, { picks: [{ pid: 2722, L: 1 }] }).find((r) => r.pid === 2828);   // Dimethyl Anthranilate: no free amine
    expect(dma.warn.join(' ')).not.toMatch(/เปลี่ยนสี/);
  });
});

describe('review round 44', () => {
  it('names only what file 2 confirms as a note, and says "expected" for analysis and hypotheses (H1)', () => {
    app = loadApp();
    const W = app.win.__layers;
    const cash = W.rank(1, { style: 'aromatic-fougere' }).find((r) => r.pid === 2878);   // Cashmeran in Y: a community hypothesis
    expect(cash.tier).toBe(1);
    expect(cash.why[0]).toBe('คาดว่าเป็นวัตถุดิบของ YSL Y ตามไฟล์ 2 (ยังไม่ยืนยัน) [อนุมาน]');
    const iso = W.rank(2, { style: 'fresh-amber' }).find((r) => r.pid === 2845);   // Iso E Super for Sauvage: section 5 "expected" only
    expect(iso.tier).toBe(1);
    const pyr = W.rank(1, { style: 'floral-gourmand' }).find((r) => r.pid === 2533);   // 2-Acetyl Pyrazine: file 3's stand-in
    expect(pyr.why[0]).toMatch(/ชุดวัตถุดิบแนว Floral gourmand ของไฟล์ 3/);
  });
  it('credits the right reference perfume of a style with several (M3)', () => {
    app = loadApp();
    const W = app.win.__layers;
    const amb = W.rank(2, { style: 'sweet-fougere' }).find((r) => r.pid === 2810);
    expect(amb.why[0]).toBe('ลายเซ็นของ Versace Eros · โน้ตของ Versace Eros ตามไฟล์ 2');
    const cin = W.rank(1, { style: 'sweet-fougere' }).find((r) => r.pid === 3195);
    expect(cin.why[0]).toBe('โน้ตของ Le Male ตามไฟล์ 2');
    const em = W.rank(2, { style: 'floral-gourmand' }).find((r) => r.pid === 2819);
    expect(em.why[0]).toMatch(/^ลายเซ็นของ La Vie Est Belle · คาดว่าเป็นวัตถุดิบของ La Vie Est Belle/);
  });
  it('leaves out finished fragrance oils and the solvent, fixative-base and unsorted families (M1)', () => {
    app = loadApp();
    const W = app.win.__layers, by = new Map(app.data.items.map((x) => [x.i, x]));
    const out = [2986, 3360, 3401, 33783, 3440, 3455, 253058, 33638, 33654, 3492, 33194, 33157, 33200, 4037, 3300, 5847];   // + "Synthetic" oils and "For Flavoring" extracts (round 45)
    for (const L of [0, 1, 2]) for (const r of W.rank(L)) {
      expect(out).not.toContain(r.pid);
      if (![32518, 33833, 33795, 33805].includes(r.pid)) expect(['solvent', 'base', 'other']).not.toContain(by.get(r.pid).f);
      expect(by.get(r.pid).n).not.toMatch(/fragrance oil/i);
    }
  });
  it('keeps materials with a written caution out of the 8 and says why in the full list (M2)', () => {
    app = loadApp();
    const W = app.win.__layers, by = new Map(app.data.items.map((x) => [x.i, x]));
    for (const style of [null, ...W.styles().map((s) => s.id)]) for (const L of [0, 1, 2]) for (const r of W.suggest(L, { style })) expect(by.get(r.pid).wo, r.pid).toBeFalsy();
    const oak = W.rank(2, { style: 'aquatic' }).find((r) => r.pid === 3260);
    expect(oak.warn.join(' ')).toMatch(/มีข้อควรระวังเขียนไว้ในหน้ารายละเอียด/);
    const hc = W.rank(1, { style: 'floral-fruity' }).find((r) => r.pid === 2707);   // Hydroxycitronellal: a J'adore label note, caution not from section O
    expect(hc.tier).toBe(0);
    expect(hc.warn.join(' ')).not.toMatch(/ส่วน O/);
  });
  it('keeps four real perfumery materials from the unsorted family (rounds 45–46)', () => {
    app = loadApp();
    const all = [0, 1, 2].flatMap((L) => app.win.__layers.rank(L).map((r) => r.pid));
    for (const p of [32518, 33833, 33795, 33805]) expect(all).toContain(p);
  });
  it('says "stands in for" when a shop code only stands in for a generic note (round 45)', () => {
    app = loadApp();
    const W = app.win.__layers;
    const ma = W.rank(1, { style: 'floral-gourmand' }).find((r) => r.pid === 3310);
    expect(ma.tier).toBe(1);
    expect(ma.why[0]).toBe('ใช้แทนโน้ต "ดอกส้ม" ของ La Vie Est Belle / Good Girl / Lady Million ตามไฟล์ 2 [อนุมาน]');
    const maLibre = W.rank(1, { style: 'floral-lavender' }).find((r) => r.pid === 3310);   // Libre's label names Methyl Anthranilate
    expect(maLibre.tier).toBe(0);
    const cin = W.rank(2, { style: 'woody-spicy' }).find((r) => r.pid === 2797);   // label for 1 Million, a stand-in for Sauvage Elixir
    expect(cin.why[0]).toBe('ลายเซ็นของ 1 Million · โน้ตของ 1 Million ตามไฟล์ 2 · ใช้แทนโน้ต "อบเชย" ของ Sauvage Elixir [อนุมาน]');
    expect(W.rank(2, { style: 'floral-lavender' }).find((r) => r.pid === 2810).tier).toBe(1);   // Libre: "Ambergris" in the pyramid, Ambroxan only "expected"
    expect(W.rank(1, { style: 'floral-fruity' }).find((r) => r.pid === 3259).tier).toBe(1);    // J'adore: Ylang only from an unconfirmed official line
    for (const p of [3217, 3218]) expect(W.rank(1, { style: 'floral-fruity' }).find((r) => r.pid === p).tier, p).toBe(0);   // both jasmines for "มะลิ" (round 46)
  });
  it("names the perfume when it says a material can lead the base, and only the style's own signatures (round 45)", () => {
    app = loadApp();
    const W = app.win.__layers;
    const em = W.rank(2).find((r) => r.pid === 2819);
    expect(em.why).toContain('ใช้เป็นตัวหลักได้ · ลายเซ็นของ La Vie Est Belle ตามไฟล์ 2');
    const emS = W.rank(2, { style: 'fresh-amber' }).find((r) => r.pid === 2819);
    expect(emS.why.join(' ')).not.toMatch(/ลายเซ็น|ตัวหลัก/);
  });
  it('colour warning only for Methyl Anthranilate with a free aldehyde (L5)', () => {
    app = loadApp();
    const W = app.win.__layers;
    expect(W.rank(2, { picks: [{ pid: 3971, L: 1 }] }).find((r) => r.pid === 2828).warn.join(' ')).not.toMatch(/เปลี่ยนสี/);   // Ethyl Anthranilate: file 5 names Methyl
    expect(W.rank(2, { picks: [{ pid: 3310, L: 1 }] }).find((r) => r.pid === 8174).warn.join(' ')).not.toMatch(/เปลี่ยนสี/);   // an acetal
  });
});

describe('step-by-step view', () => {
  it('walks style → base → mid → top → summary, adds to the formula, and IFRA stays in the calc view', async () => {
    await layerView();
    expect(app.$$('.seg-b').map((b) => b.textContent)).toEqual(['เลือกเอง', 'ทีละชั้น', 'คำนวณ']);
    expect(app.$('#form-pick').hidden).toBe(true);
    expect(app.$$('[data-lstyle]').length).toBe(11);
    app.click('[data-lstyle="aquatic"]');
    expect(app.$('[data-lstyle="aquatic"]').getAttribute('aria-pressed')).toBe('true');
    app.click('[data-lstep="1"]');
    expect(txt('#l-count')).toMatch(/^ชั้นฐาน · แนะนำ 8 จาก .* · สไตล์ Aquatic$/);
    const first = +app.$('#l-body [data-ladd]').getAttribute('data-ladd');
    app.click('#l-body [data-ladd]');
    await sleep(800);
    const saved = app.store.get('fdraft');
    expect(saved.items).toEqual([{ pid: first, g: null, dil: 100, filt: false }]);   // the saved formula keeps its shape
    expect(JSON.parse(app.win.localStorage.getItem('pf.ly'))[first]).toBe(2);
    expect(app.$$('#l-body .fchip').map((c) => c.textContent)).toHaveLength(1);
    expect(app.$$('#l-body [data-ladd]').map((b) => +b.getAttribute('data-ladd'))).not.toContain(first);
    app.click('[data-lstep="2"]');
    expect(txt('#l-count')).toMatch(/^ชั้นกลาง · แนะนำ/);
    const mid = +app.$('#l-body [data-ladd]').getAttribute('data-ladd');
    app.click('#l-body [data-ladd]');
    expect(app.doc.activeElement.getAttribute('data-ladd')).not.toBeNull();   // keyboard stays on the list after +
    app.click('[data-lstep="3"]');
    expect(txt('#l-count')).toMatch(/^ชั้นหัว · แนะนำ/);
    expect(txt('#form-layer')).not.toMatch(/เพดาน|ผ่าน/);   // no IFRA verdict in this view
    app.click('[data-lstep="4"]');
    expect(app.$$('#l-body .hint [data-lstep]').map((b) => b.getAttribute('data-lstep'))).toEqual(['3']);   // only the top layer is empty: "ไปเลือกชั้นหัว" goes to step 3
    expect(sec('ชั้นฐาน').querySelectorAll('.lp').length).toBe(1);   // phase 3: one row per line, with its %
    expect(sec('ชั้นกลาง').querySelectorAll('.lp').length).toBe(1);
    expect(sec('ชั้นหัว').textContent).toMatch(/0 ตัว/);
    app.click('#l-body [data-fview="calc"]');
    expect(app.$('#form-calc').hidden).toBe(false);
    expect(app.$$('#f-rows .row, #f-rows > *').length).toBeGreaterThanOrEqual(2);
    expect(txt('#f-rows')).toContain(String(first));
    expect(txt('#f-rows')).toContain(String(mid));
  });
  it('lists every candidate by evidence under "ดูทั้งหมด", rated before unrated', async () => {
    await layerView();
    app.click('[data-lstep="1"]');
    app.click('#l-body [data-ladd]');   // one base material, so the mid layer has evidence to sort by
    app.click('[data-lstep="2"]');
    app.click('[data-lall]');
    const before = app.$$('#l-body [data-ladd]').length;
    app.click('[data-lmore]');
    expect(app.$$('#l-body [data-ladd]').length).toBe(before + 40);
    while (app.$('[data-lmore]')) app.click('[data-lmore]');
    const total = +txt('#l-count').match(/จาก ([\d,]+) ตัว/)[1].replace(/,/g, '');
    expect(app.$$('#l-body [data-ladd]').length).toBe(total);   // 8 suggested + the rest, each once
    const groups = app.$$('#l-body .lgrp').map((g) => g.textContent);
    expect(groups.length).toBeGreaterThanOrEqual(4);
    const order = ['มีหลักฐาน', 'อนุมาน', 'เดา: แค่ชั้นตรง'];
    for (const g of groups) expect(order.some((o) => g.startsWith(o)), g).toBe(true);   // round 46: a renamed label must not slip through
    const idx = groups.map((g) => order.findIndex((o) => g.startsWith(o)) * 2 + (g.includes('ยังไม่จัดระดับ') ? 1 : 0));
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });
  it('removes a line with × on its chip and forgets its layer', async () => {
    await layerView();
    app.click('[data-lstep="1"]');
    const pid = +app.$('#l-body [data-ladd]').getAttribute('data-ladd');
    app.click('#l-body [data-ladd]');
    app.click('#l-body .fchip [data-fdel]');
    expect(app.$('#form-badge').textContent).toBe('');
    expect(JSON.parse(app.win.localStorage.getItem('pf.ly'))[pid]).toBeUndefined();
  });
  it('cannot add while the saved formula is still loading (round 38 guard)', async () => {
    app = loadApp({ firstDelay: 400 });
    await sleep(30);
    app.click('#tab-form');
    app.click('[data-fview="layer"]');
    app.click('[data-lstep="1"]');
    app.click('#l-body [data-ladd]');
    expect(app.$('#form-badge').textContent).toBe('');
    expect(app.writes.filter((w) => w.id === 'fdraft')).toHaveLength(0);
  });
  it('remembers the view, step and style for this viewer', async () => {
    await layerView({ storage: { 'pf.fview': '"layer"', 'pf.lstep': '2', 'pf.style': '"modern-chypre"' } });
    expect(app.$('#form-layer').hidden).toBe(false);
    expect(txt('#l-count')).toMatch(/^ชั้นกลาง · .* สไตล์ Modern chypre$/);
  });
  it('keeps a line in the layer it was added to when that is not its own layer, after a reload too', async () => {
    await layerView();
    app.click('[data-lstep="3"]');
    expect(app.win.__layers.note(2685)).toMatchObject({ l: 1, lo: 0, hi: 1 });   // Linalool: mid, can sit at the top
    app.win.__formulaUI.add(2685, { layer: 0 });
    app.click('[data-lstep="4"]');
    expect([...sec('ชั้นหัว').querySelectorAll('.lp .lnm')].map((b) => b.textContent)).toEqual(['Linalool']);
    const ly = app.win.localStorage.getItem('pf.ly');
    await sleep(800);
    const saved = app.store.get('fdraft');
    app.close();
    await layerView({ docs: { fdraft: saved }, storage: { 'pf.ly': ly, 'pf.lstep': '4' } });
    await sleep(30);
    expect([...sec('ชั้นหัว').querySelectorAll('.lp .lnm')].map((b) => b.textContent)).toEqual(['Linalool']);
  });
  it('adds from the detail sheet into the current step, and remembers the picking view, not calc', async () => {
    await layerView({ storage: { 'pf.lstep': '2' } });
    app.click('#l-body [data-open]');
    const pid = +app.$('#sheet [data-fadd]').getAttribute('data-fadd');
    app.click('#sheet [data-fadd]');
    expect(JSON.parse(app.win.localStorage.getItem('pf.ly'))[pid]).toBe(1);
    expect(txt('#toast')).toMatch(/ในชั้นกลางแล้ว$/);
    app.click('[data-fview="calc"]');
    app.click('[data-fview="add"]');
    expect(app.$('#form-layer').hidden).toBe(false);   // "＋ เพิ่มวัตถุดิบ" goes back to the step-by-step view
    app.click('[data-fview="calc"]');
    expect(app.win.localStorage.getItem('pf.fview')).toBe('"layer"');
  });
  it('opens on the picking view even when the calc view was stored', async () => {
    app = loadApp({ storage: { 'pf.fview': '"calc"' } });
    await sleep(30);
    app.click('#tab-form');
    expect(app.$('#form-calc').hidden).toBe(true);
    expect(app.$('#form-pick').hidden).toBe(false);
  });
  it('forgets stored layers of lines that are no longer in the saved formula', async () => {
    const doc = { v: 1, conc: 8, certs: {}, at: 1, items: [{ pid: 2845, g: null, dil: 100, filt: false }] };
    await layerView({ docs: { fdraft: doc }, storage: { 'pf.ly': '{"2845":2,"9999":1}' } });
    await sleep(30);
    app.click('[data-lstep="1"]');
    expect(JSON.parse(app.win.localStorage.getItem('pf.ly'))).toEqual({ 2845: 2 });
  });
  it('puts a line in its own layer when the step is outside its range', async () => {
    await layerView();
    app.win.__formulaUI.add(2810, { layer: 0 });   // Ambroxan: base only
    expect(JSON.parse(app.win.localStorage.getItem('pf.ly'))[2810]).toBe(2);
    expect(txt('#toast')).toMatch(/ในชั้นฐานแล้ว$/);
  });
  it('moves focus to the count line after × and to the first new row after "แสดงเพิ่ม"', async () => {
    await layerView();
    app.click('[data-lstep="1"]');
    app.click('#l-body [data-ladd]');
    app.click('#l-body .fchip [data-fdel]');
    expect(app.doc.activeElement).toBe(app.$('#l-count'));
    app.click('[data-lall]');
    const before = app.$$('#l-body [data-ladd]').length;
    app.click('[data-lmore]');
    expect(app.doc.activeElement).toBe(app.$$('#l-body [data-ladd]')[before]);
  });
  it('keeps one live region for the count line', async () => {
    await layerView();
    const el = app.$('#l-count');
    app.click('[data-lstep="1"]');
    app.click('[data-lstep="2"]');
    expect(app.$('#l-count')).toBe(el);
    expect(el.getAttribute('aria-live')).toBe('polite');
  });
  it('ignores a broken stored step or style', async () => {
    await layerView({ storage: { 'pf.lstep': '9', 'pf.style': '"nope"', 'pf.ly': '[1,2]' } });
    expect(txt('#l-count')).toBe('ยังไม่เลือกสไตล์');
  });
});

describe('back-test (file 12 section 11)', () => {
  it('passes its criterion and notes/backtest.md is up to date', () => {
    const { md, sum } = backtest();
    expect(sum.targets).toBe(27);
    expect(sum.pass).toBe(true);
    expect(sum.loo).toBeGreaterThanOrEqual(sum.tier);
    expect(fs.readFileSync(new URL('notes/backtest.md', ROOT), 'utf8')).toBe(md);
  });
});
