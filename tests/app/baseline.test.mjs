// Regression net for the published ingredient app (catalog + shopping list).
// Written before any change to app/index.html: every test here passed on the
// version published 15 Oct 2026 (artifact version 1792068912-ba44).
import { describe, it, expect, afterEach } from 'vitest';
import { loadApp, sleep } from './harness.mjs';

let app;
afterEach(() => { if (app) app.close(); app = null; });

describe('catalog data', () => {
  it('has 1,106 items and none of the hidden products', () => {
    app = loadApp();
    const { data } = app;
    expect(data.items.length).toBe(1106);
    // codes listed in file 9 "สิ่งที่ไม่แสดงในแอป" (IFRA 51 prohibited, EU banned, advised against, not perfumery)
    const HIDDEN = [2886, 2885, 3180, 3284, 2505, 3562, 32496, 2433, 33755, 33763, 33756, 3467, 2488, 33686,
      2710, 3991, 3989, 3430, 3874, 2747, 2830, 2788, 2883, 125410, 125409];
    const codes = new Set(data.items.map((x) => x.i));
    for (const c of HIDDEN) expect(codes.has(c), 'hidden code ' + c).toBe(false);
  });
  it('has 117 numeric IFRA caps, every one parseable', () => {
    app = loadApp();
    const caps = app.data.items.filter((x) => /^[\d.]+%$/.test(x.ifra || ''));
    expect(caps.length).toBe(117);
    for (const x of caps) expect(Number.isFinite(parseFloat(x.ifra))).toBe(true);
  });
});

describe('helpers', () => {
  it('capPct rounds down', () => {
    app = loadApp();
    expect(app.win.__capPct(1.5, 8)).toBe(18.75);
    expect(app.win.__capPct(0.4, 25)).toBe(1.6);
    expect(app.win.__capPct(0.0414, 20)).toBe(0.2);
  });
  it('numIn reads Thai digits, decimal and thousands commas', () => {
    app = loadApp();
    const n = app.win.__numIn;
    expect(n('๓๐')).toBe(30);
    expect(n('2,5')).toBe(2.5);
    expect(n('1,125')).toBe(1125);
    expect(Number.isNaN(n('abc'))).toBe(true);
    expect(n('')).toBe(null);
  });
});

describe('catalog view', () => {
  it('boots with all items listed', async () => {
    app = loadApp();
    await sleep(20);
    expect(app.$('#count').textContent).toContain('1,106 รายการ');
    expect(app.$$('#list .row').length).toBe(150);
  });
  it('searches by product code', async () => {
    app = loadApp();
    app.type('#q', '2845');
    await sleep(200);
    expect(app.$('#list .row .nm').textContent).toContain('Iso E Super');
  });
  it('filters by family chip', async () => {
    app = loadApp();
    app.click('#chips [data-fam="musk"]');
    const n = parseInt(app.$('#count').textContent.replace(/,/g, ''), 10);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(1106);
  });
  it('opens the detail sheet with the IFRA table', async () => {
    app = loadApp();
    app.click('[data-open="2821"]');
    expect(app.$('#sheet').hidden).toBe(false);
    expect(app.$('#sheet-title').textContent).toBe('Coumarin');
    expect(app.$('#sheet-body .ifra-grid').textContent).toContain('≤18.75%');
  });
});

describe('shopping list', () => {
  it('adds an item and saves it to the store', async () => {
    app = loadApp();
    await sleep(30);
    app.click('[data-add="2845"]');
    await sleep(30);
    expect(app.$('#cart-badge').textContent).toBe('1');
    const w = app.writes.find((x) => x.id === 'p2845');
    expect(w && w.op).toBe('set');
    expect(w.v.g).toBe(30);
  });
  it('edits grams and saves after the pause', async () => {
    app = loadApp({ docs: { p2845: { pid: 2845, g: 30, ppg: 41, pe: false, ordered: false, at: 1 } } });
    await sleep(30);
    app.click('#tab-cart');
    const gi = app.$('#g-2845');
    expect(gi).toBeTruthy();
    app.type(gi, '45');
    await sleep(800);
    const last = app.writes.filter((x) => x.id === 'p2845').pop();
    expect(last.v.g).toBe(45);
  });
  it('removes an item', async () => {
    app = loadApp({ docs: { p2810: { pid: 2810, g: 3, ppg: 619, pe: false, ordered: false, at: 1 } } });
    await sleep(30);
    app.click('#tab-cart');
    app.click('[data-remove="2810"]');
    await sleep(30);
    expect(app.writes.some((x) => x.op === 'delete' && x.id === 'p2810')).toBe(true);
    expect(app.$('#cart-badge').textContent).toBe('');
  });
  it('shows a line added on another device', async () => {
    app = loadApp();
    await sleep(30);
    app.remote('p2665', { pid: 2665, g: 30, ppg: 47, pe: false, ordered: false, at: 2 });
    await sleep(10);
    expect(app.$('#cart-badge').textContent).toBe('1');
  });
  it('warns when it cannot save (no runtime)', async () => {
    app = loadApp({ runtime: 'none' });
    await sleep(20);
    app.click('#tab-cart');
    expect(app.$('#cart-banner').textContent).toContain('บันทึกรายการไม่ได้');
  });
  it('adds the starter set', async () => {
    app = loadApp();
    await sleep(30);
    app.click('#tab-cart');
    app.click('#btn-starter');
    expect(app.$$('[data-st]').length).toBe(13);
    app.click('#st-go');
    await sleep(100);
    expect(app.$('#cart-badge').textContent).toBe('13');
  });
});
