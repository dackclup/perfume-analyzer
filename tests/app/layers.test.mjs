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
    expect(amb.why[0]).toBe('ลายเซ็นของ Sauvage ตามไฟล์ 2');
    const hedS = W.rank(1, { style: 'fresh-amber' }).find((r) => r.pid === 2665);   // Hedione: file 3's set for this style, not a Sauvage note
    expect(hedS.tier).toBe(1);
    expect(hedS.why[0]).toBe('อยู่ในชุดวัตถุดิบแนว Fresh amber–woody ของไฟล์ 3 [อนุมาน]');
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
    app.click('[data-lstep="4"]');
    expect(txt('#l-body')).toMatch(/ชั้นฐาน ?1 ตัว/);
    expect(txt('#l-body')).toMatch(/ชั้นกลาง ?1 ตัว/);
    expect(txt('#l-body')).toMatch(/ชั้นหัว ?0 ตัว/);
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
    const order = ['มีหลักฐานว่าใช้คู่กัน', 'อนุมาน', 'เดา: แค่ชั้นตรง'];
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
