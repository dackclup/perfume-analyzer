// Round 39: fixes for the second independent review (file 8 section 11). Most tests here fail on the build that
// review checked (commit 81fd12e); the ones marked "guard" pass on both and close gaps its mutation run found
// (a test that would not notice the fix being removed).
import { describe, it, expect, afterEach } from 'vitest';
import { loadApp, sleep } from './harness.mjs';

let app;
afterEach(() => { if (app) app.close(); app = null; });

const line = (pid, g, dil = 100) => ({ pid, g, dil, filt: false });
const doc = (items, conc = 8, certs = {}) => ({ v: 1, conc, certs, at: 1, items });
const txt = (sel) => app.$(sel).textContent.replace(/\s+/g, ' ').trim();
const sumTxt = () => app.$$('#f-sum > div').map((d) => [...d.children].map((c) => c.textContent.trim()).join(' ')).join(' | ');
async function calc(fdraft, opts = {}) {
  app = loadApp({ docs: { fdraft }, ...opts });
  await sleep(30);
  app.click('#tab-form');
  app.click('[data-fview="calc"]');
  return app;
}

describe('shared caps', () => {
  it('adds up Trifernal 3579 and 3-Phenylbutanal 33759 (one substance)', async () => {
    await calc(doc([line(3579, 3.75), line(33759, 3.75), line(2665, 92.5)]));   // 0.30% + 0.30% > 0.44%
    expect(txt('#f-verdict')).toContain('ยังไม่ผ่าน IFRA ที่ 8%');
    expect(sumTxt()).toContain('ใส่หัวน้ำหอมได้สูงสุด 5.8%');   // 8 × 0.44 / 0.60 = 5.87, shown rounded down
  });
  it('puts every two capped products with the same CAS in one group (photo oils: in the budget) · guard', () => {
    app = loadApp();
    const { kind, group, PHOTO } = app.win.__ifra;
    const byCas = new Map();
    for (const x of app.data.items) {
      const cas = x.a && x.a.cas;
      if (!cas || kind(x).k !== 'cap') continue;
      if (!byCas.has(cas)) byCas.set(cas, []);
      byCas.get(cas).push(x);
    }
    let pairs = 0;
    for (const xs of byCas.values()) {
      if (xs.length < 2) continue;
      pairs++;
      if (xs.every((x) => PHOTO.has(x.i))) continue;
      expect(new Set(xs.map(group)).size, xs.map((x) => x.i).join(',')).toBe(1);
    }
    expect(pairs).toBeGreaterThan(0);
  });
});

describe('saving', () => {
  it('skips a late view of an older save from this page', async () => {
    app = loadApp({ hold: true });
    await sleep(30);
    app.click('#tab-form');
    app.click('[data-fadd="2810"]');
    await sleep(700);
    app.land(); await sleep(0);   // save 1 (Ambroxan) done, no view yet
    app.click('[data-fadd="2845"]');
    await sleep(700);
    app.land(); await sleep(0);   // save 2 (Ambroxan + Iso E Super) done
    app.view({ fdraft: app.writes[0].v }); await sleep(0);   // the view of save 1 turns up late
    expect(app.$('#form-badge').textContent).toBe('2');
    // round 40: if the server really kept the older save, the page saves the newest again (once)
    expect(app.held.length).toBe(1);
    expect(app.writes[2].v.items.map((i) => i.pid)).toEqual([2810, 2845]);
    app.land(); await sleep(0);
    app.click('[data-fadd="2821"]');
    await sleep(700);
    app.land(); await sleep(0);
    expect(app.store.get('fdraft').items.map((i) => i.pid)).toEqual([2810, 2845, 2821]);
  });
  it('still shows a newer formula saved on another device · guard', async () => {
    app = loadApp({ hold: true });
    await sleep(30);
    app.click('#tab-form');
    app.click('[data-fadd="2810"]');
    await sleep(700);
    app.land(); await sleep(0);
    app.view({ fdraft: { v: 1, conc: 10, certs: {}, at: 1, sid: 'other', n: 1, items: [line(2665, 5), line(2845, 5), line(2810, 5)] } });
    await sleep(0);
    expect(app.$('#form-badge').textContent).toBe('3');
  });
  it('shows a change from another device that arrived while a save was out', async () => {
    app = loadApp({ hold: true });
    await sleep(30);
    app.click('#tab-form');
    app.click('[data-fadd="2810"]');
    await sleep(700);   // save is out
    app.view({ fdraft: { v: 1, conc: 10, certs: {}, at: 1, sid: 'other', n: 1, items: [line(2665, 5), line(2845, 5), line(2810, 5)] } });
    await sleep(0);
    expect(app.$('#form-badge').textContent).toBe('1');   // still this page's formula while its save is out
    app.land(); await sleep(0);
    expect(app.$('#form-badge').textContent).toBe('3');
    expect(txt('#toast')).toContain('แสดงสูตรล่าสุดที่บันทึกไว้');
  });
  it('sends one save at a time, the second with the newest content', async () => {
    app = loadApp({ hold: true });
    await sleep(30);
    app.click('#tab-form');
    app.click('[data-fadd="2810"]');
    await sleep(700);
    app.click('[data-fadd="2845"]');
    await sleep(700);
    expect(app.held.length).toBe(1);
    app.land(); await sleep(0);
    expect(app.held.length).toBe(1);
    expect(app.writes[1].v.items.map((i) => i.pid)).toEqual([2810, 2845]);
  });
  it('saves on page hide also when a failed save is waiting for its retry', async () => {
    let failing = true;
    app = loadApp({ fail: (id) => id === 'fdraft' && failing });
    await sleep(30);
    app.click('#tab-form');
    app.click('[data-fadd="2810"]');
    await sleep(2400);   // failed, retry waits 3 s
    const before = app.writes.filter((w) => w.id === 'fdraft').length;
    failing = false;
    Object.defineProperty(app.doc, 'visibilityState', { value: 'hidden', configurable: true });
    app.doc.dispatchEvent(new app.win.Event('visibilitychange'));
    await sleep(20);
    expect(app.writes.filter((w) => w.id === 'fdraft').length).toBe(before + 1);
    expect(app.store.get('fdraft').items.length).toBe(1);
  }, 10000);
  it('says so when it saved over a change made on another device', async () => {
    app = loadApp();
    await sleep(30);
    app.click('#tab-form');
    app.click('[data-fadd="2810"]');
    app.remote('fdraft', doc([line(2665, 5), line(2845, 5)]));   // arrives before this page's save
    await sleep(800);
    expect(app.store.get('fdraft').items.length).toBe(1);
    expect(txt('#toast')).toContain('สูตรถูกแก้จากหน้าอื่นหรือเครื่องอื่น');   // round 40 wording: it may be this device's earlier page
  });
  it('blocks the concentration chips while the saved formula is loading · guard', async () => {
    app = loadApp({ docs: { fdraft: doc([line(2845, 20)]) }, firstDelay: 400 });
    await sleep(20);
    app.click('#tab-form');
    app.click('[data-fview="calc"]');
    app.click('[data-fconc="25"]');
    expect(txt('#toast')).toContain('กำลังโหลดสูตร');
    await sleep(900);
    expect(app.writes.filter((w) => w.id === 'fdraft').length).toBe(0);
    expect(app.win.__formula.get().conc).toBe(8);
  });
});

describe('verdict and text', () => {
  it('flags a quality spec on a capped product (S code) · guard', async () => {
    await calc(doc([line(2660, 10), line(2665, 90)]));
    expect(txt('#f-verdict')).toContain('Methyl Ionone γ 70% (มีข้อกำหนดคุณภาพ)');
  });
  it('is amber for Calone (draft IFRA 52)', async () => {
    await calc(doc([line(2557, 8), line(2665, 92)]));
    expect(app.$('#f-verdict .verdict').className).toContain('amb');
    expect(txt('#f-verdict')).toContain('Calone (ร่าง IFRA ฉบับ 52 อาจจำกัด)');
  });
  it('keeps the MOC-alone EU line next to the MHC + MOC group line', async () => {
    await calc(doc([line(2629, 0.08), line(2627, 0.05), line(2665, 99.87)], 10));   // 0.008% + 0.005%: EU 0.01% together, MOC 0.002%
    const v = txt('#f-verdict');
    expect(v).toContain('Methyl Heptine Carbonate + Methyl Octine Carbonate 0.013% (EU 0.01%)');
    expect(v).toContain('Methyl Octine Carbonate 0.005% (EU 0.002%)');
    expect(sumTxt()).toContain('ไม่นับกฎ EU');
  });
  it('tells two lines with the same short name apart', async () => {
    await calc(doc([line(3224, 1), line(33390, 0.5), line(2665, 98.5)]));
    expect(txt('#f-verdict')).toContain('Lemon Oil 3224 (มีสารจำกัดในน้ำมัน), Lemon Oil 33390');
  });
  it('never prints a tiny amount in exponent notation', async () => {
    await calc(doc([line(2845, 0.0001, 1), line(2665, 99.9999)]));
    expect(txt('#fr-2845')).not.toMatch(/\de-\d/);
    expect(txt('#fr-2845')).toContain('ในขวด 0.00000008%');
  });
  it('announces a fixed stored formula once, not on every view', async () => {
    app = loadApp({ docs: { fdraft: { items: [{ pid: 2886, g: 1 }, { pid: 2810, g: 1 }], conc: 8, certs: {} } } });
    await sleep(30);
    expect(txt('#toast')).toContain('ตัดวัตถุดิบที่ไม่มีในคลัง');
    app.$('#toast').textContent = '';
    app.remote('p2845', { pid: 2845, g: 30, ppg: 41, pe: false, ordered: false, at: 2 });   // a shopping-list change sends a new view
    await sleep(10);
    expect(txt('#toast')).not.toContain('ตัดวัตถุดิบ');
  });
});
