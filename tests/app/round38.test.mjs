// Round 38: fixes for the independent review of the formula tab (file 8 section 11).
// Every test here fails on the build reviewed in round 38 (commit 088a5fd), except "stays green for a formula of
// plain capped and unrestricted materials", which guards against the fix turning every formula amber.
import { describe, it, expect, afterEach } from 'vitest';
import { loadApp, sleep } from './harness.mjs';

let app;
afterEach(() => { if (app) app.close(); app = null; });

const line = (pid, g, dil = 100) => ({ pid, g, dil, filt: false });
const doc = (items, conc = 8, certs = {}) => ({ v: 1, conc, certs, at: 1, items });
const EX2 = doc([line(127688, 1.2), line(2493, 0.6), line(2685, 0.4), line(3222, 0.4), line(2665, 2.0), line(2845, 2.5),
  line(2810, 1.0, 10), line(2821, 1.5, 10), line(2877, 0.4)]);
const txt = (sel) => app.$(sel).textContent.replace(/\s+/g, ' ').trim();
const sumTxt = () => app.$$('#f-sum > div').map((d) => [...d.children].map((c) => c.textContent.trim()).join(' ')).join(' | ');

async function calc(fdraft, opts = {}) {
  app = loadApp({ docs: { fdraft }, ...opts });
  await sleep(30);
  app.click('#tab-form');
  app.click('[data-fview="calc"]');
  return app;
}

describe('shared IFRA caps (HIGH-1)', () => {
  it('adds up Rose ketones sold as two products', async () => {
    await calc(doc([line(2779, 0.3), line(2763, 0.3), line(2665, 99.4)]));   // 0.024% + 0.024% at 8%
    const v = txt('#f-verdict');
    expect(v).toContain('ยังไม่ผ่าน IFRA ที่ 8%');
    expect(v).toContain('Beta Damascone + Damascenone ใช้เพดานเดียวกัน รวม 0.048% เกินเพดานร่วม 0.0414%');
    expect(txt('#fr-2779')).toContain('ไม่ผ่าน');
    expect(txt('#fr-2763')).toContain('รวมกับ Beta Damascone');
  });
  it('adds up Sandalore ×2 and limits the concentration by the shared cap', async () => {
    await calc(doc([line(2846, 10), line(33721, 10), line(2665, 80)]));   // 0.8% + 0.8% > 1.2%
    expect(txt('#f-verdict')).toContain('ยังไม่ผ่าน IFRA ที่ 8%');
    expect(sumTxt()).toContain('ใส่หัวน้ำหอมได้สูงสุด 6%');
    expect(sumTxt()).toContain('จำกัดโดยเพดานร่วม Sandalore + sandal pentanol');
  });
  it('adds up Oakmoss with Treemoss, and MHC with MOC (0.047% together)', async () => {
    await calc(doc([line(3260, 0.6), line(3837, 0.6), line(2665, 98.8)], 10));   // 0.06% + 0.06% > 0.1%
    expect(txt('#f-verdict')).toContain('เกินเพดานร่วม 0.10%');
    app.close();
    await calc(doc([line(2629, 0.4), line(2627, 0.1), line(2665, 99.5)], 10));   // 0.04% + 0.01% > 0.047%, each under its own cap
    const v = txt('#f-verdict');
    expect(v).toContain('ยังไม่ผ่าน IFRA ที่ 10%');
    expect(v).toContain('เกินเพดานร่วม 0.047%');
    expect(v).not.toContain('เกินเพดาน 0.01%');
  });
  it('groups exactly the products the IFRA index puts under one standard', () => {
    app = loadApp();
    const { kind, group, PHOTO } = app.win.__ifra;
    const g = new Map();
    for (const x of app.data.items) {
      const k = kind(x).k, key = group(x);
      if (k !== 'cap' || !key || PHOTO.has(x.i)) continue;
      if (!g.has(key)) g.set(key, []);
      g.get(key).push(x.i);
    }
    const shared = [...g.values()].filter((v) => v.length > 1).map((v) => v.sort((a, b) => a - b).join(',')).sort();
    expect(shared).toEqual([
      '2428,2660,2661', '2559,2658,2763,2779,9236,33801', '2602,33794', '2621,3801', '2627,2629', '2846,33721',
      '2907,33762', '3178,3265', '3259,253413', '3260,3837,33884', '3466,33784'].sort());
    for (const v of g.values()) { const caps = v.map((i) => kind(app.data.items.find((x) => x.i === i)).cap); if (v.length > 1 && !v.includes(2627)) expect(new Set(caps).size).toBe(1); }
  });
});

describe('no edits before the saved formula is known (HIGH-2)', () => {
  it('blocks + while the first view is still loading, so the saved formula survives', async () => {
    app = loadApp({ docs: { fdraft: EX2 }, firstDelay: 300 });
    await sleep(20);
    app.click('#tab-form');
    expect(txt('#form-banner')).toContain('กำลังโหลดสูตร');
    app.click('[data-fadd="2810"]');
    expect(txt('#toast')).toContain('กำลังโหลดสูตรที่บันทึกไว้');
    await sleep(1200);
    expect(app.writes.filter((w) => w.id === 'fdraft').length).toBe(0);
    expect(app.store.get('fdraft').items.length).toBe(9);
    expect(app.$('#form-badge').textContent).toBe('9');
    expect(txt('#form-banner')).toBe('');
  });
  it('does not save over the server copy from a stale cached view', async () => {
    const stale = doc(EX2.items.slice(0, 3));
    app = loadApp({ docs: { fdraft: EX2 }, cached: { fdraft: stale }, firstDelay: 300 });
    await sleep(30);
    app.click('#tab-form');
    expect(app.$('#form-badge').textContent).toBe('3');
    app.click('[data-fadd="2884"]');
    await sleep(1200);
    expect(app.store.get('fdraft').items.length).toBe(9);
    expect(app.$('#form-badge').textContent).toBe('9');
  });
});

describe('green only when everything was checked (MEDIUM-1)', () => {
  it('stays green for a formula of plain capped and unrestricted materials', async () => {
    await calc(doc([line(2845, 20), line(2665, 80)]));
    expect(app.$('#f-verdict .verdict').className).toContain('ok');
    expect(txt('#f-verdict')).toContain('ผ่านเพดาน IFRA ที่ 8%');
  });
  it('is amber with an empty line, a quality spec, or a cap that holds for one form only', async () => {
    await calc(doc([line(2845, 2), line(2821, null)]));
    expect(txt('#f-verdict')).toContain('ยังใส่กรัมไม่ครบ');
    expect(app.$('#f-verdict .verdict').className).toContain('amb');
    app.close();
    await calc(doc([line(2845, 20), line(2685, 10), line(33091, 2), line(3178, 0.1), line(2665, 67.9)]));
    const v = txt('#f-verdict');
    expect(v).toContain('มีข้อต้องเช็กเอง');
    expect(v).toContain('Linalool (ข้อกำหนดคุณภาพ)');
    expect(v).toContain('Lemon Oil (มีสารจำกัดในน้ำมัน)');
    expect(v).toContain('Styrax Resinoid (บางรูปแบบ IFRA ห้าม)');
    expect(app.$('#f-verdict .verdict').className).toContain('amb');
  });
  it('does not call a solvent-only formula a pass', async () => {
    await calc(doc([line(706, 5)]));
    expect(txt('#f-verdict')).toContain('ยังไม่มีสารหอมในสูตร');
  });
});

describe('EU limits lower than IFRA (MEDIUM-2)', () => {
  it('warns over the EU limit while IFRA passes, with group sums', async () => {
    await calc(doc([line(2728, 50), line(2665, 50)]));   // Hexyl salicylate 4% in the bottle: IFRA 6.5%, EU 2%
    const v = txt('#f-verdict');
    expect(v).toContain('มีข้อต้องเช็กเอง');
    expect(v).toContain('เกินกฎหมายเครื่องสำอาง EU: Hexyl Salicylate 4.00% (EU 2%)');
    expect(txt('#fr-2728')).toContain('EU 2% เกิน');
    app.close();
    await calc(doc([line(2779, 0.15), line(2763, 0.15), line(2665, 99.7)], 10));   // 0.015% + 0.015%: IFRA 0.0414% ok, EU 0.02% together
    expect(txt('#f-verdict')).toContain('Beta Damascone + Damascenone 0.03% (EU 0.02%)');
    expect(txt('#f-verdict')).not.toContain('ยังไม่ผ่าน');
  });
  it('takes every EU number from the product\'s own EU line, and only where it is below IFRA', () => {
    app = loadApp();
    const { EU, kind } = app.win.__ifra;
    for (const [pid, [n]] of Object.entries(EU)) {
      const x = app.data.items.find((y) => y.i === +pid);
      const said = [...x.eu.matchAll(/ไม่เกิน ([\d.]+)%/g)].map((m) => parseFloat(m[1]));
      expect(said, pid).toContain(n);
      expect(n, pid).toBeLessThan(kind(x).cap);
    }
    expect(Object.keys(EU).length).toBe(19);
  });
});

describe('saving (MEDIUM-3 to 5)', () => {
  it('keeps a warning while a save keeps failing, and retries by itself', async () => {
    let failing = true;
    app = loadApp({ fail: (id) => id === 'fdraft' && failing });
    await sleep(30);
    app.click('#tab-form');
    app.click('[data-fadd="2810"]');
    await sleep(2400);   // 650 ms pause + the one quick retry (400–1200 ms)
    expect(txt('#form-banner')).toContain('บันทึกสูตรไม่สำเร็จ');
    const tries = app.writes.filter((w) => w.id === 'fdraft').length;
    failing = false;
    await sleep(3500);
    expect(app.writes.filter((w) => w.id === 'fdraft').length).toBeGreaterThan(tries);
    expect(app.store.get('fdraft').items.length).toBe(1);
    expect(txt('#form-banner')).toBe('');
  }, 10000);
  it('saves at once when the page is hidden', async () => {
    app = loadApp();
    await sleep(30);
    app.click('#tab-form');
    app.click('[data-fadd="2810"]');
    Object.defineProperty(app.doc, 'visibilityState', { value: 'hidden', configurable: true });
    app.doc.dispatchEvent(new app.win.Event('visibilitychange'));
    expect(app.writes.filter((w) => w.id === 'fdraft').length).toBe(1);
  });
  it('does not lose a quick second edit when saves are slow', async () => {
    app = loadApp({ hold: true });
    await sleep(30);
    app.click('#tab-form');
    app.click('[data-fadd="2810"]');
    await sleep(700);   // save 1 (Ambroxan) is on its way
    app.click('[data-fadd="2845"]');
    await sleep(700);   // save 2 (Ambroxan + Iso E Super) is on its way too
    expect(app.held.length).toBe(2);
    app.land(); await sleep(0);   // save 1 is acknowledged …
    app.echo(); await sleep(0);   // … and its view (Ambroxan only) arrives while save 2 is still out
    expect(app.$('#form-badge').textContent).toBe('2');
    app.land(); app.echo(); await sleep(0);
    expect(app.$('#form-badge').textContent).toBe('2');
    expect(app.store.get('fdraft').items.map((i) => i.pid)).toEqual([2810, 2845]);
  });
  it('says what it dropped from a stored formula', async () => {
    app = loadApp({ docs: { fdraft: { items: [{ pid: 2886, g: 1 }, { pid: 2810, g: 1 }], conc: 30, certs: {} } } });
    await sleep(30);
    expect(txt('#toast')).toContain('ตัดวัตถุดิบที่ไม่มีในคลัง');
    expect(txt('#toast')).toContain('ความเข้มข้น 30%');
  });
});

describe('notes and small fixes (MEDIUM-6, LOW)', () => {
  it('shows the warning, EU line or a fallback in the edit sheet', async () => {
    await calc(doc([line(3282, 1), line(2828, 1), line(2728, 1), line(2665, 97)]));
    app.click('[data-fopen="3282"]');
    expect(txt('#fe-live')).toContain('ใช้ได้เฉพาะแบบ rectified');
    app.click('[data-fdone]');
    app.click('[data-fopen="2828"]');
    expect(txt('#fe-live')).toContain('แอปไม่มีตัวเลขเพดาน IFRA ของตัวนี้');
    app.click('[data-fdone]');
    app.click('[data-fopen="2728"]');
    expect(txt('#fe-live')).toContain('กฎหมายเครื่องสำอาง EU');
  });
  it('shows the draft-52 note on Calone and rejects a certificate cap over 100%', async () => {
    await calc(doc([line(2557, 0.5), line(127688, 1), line(2665, 98.5)]));
    expect(txt('#fr-2557')).toContain('ร่างฉบับ 52');
    app.click('[data-fopen="127688"]');
    app.type('#fe-cert', '4000');
    expect(app.$('#fe-cert').getAttribute('aria-invalid')).toBe('true');
    expect(app.win.__formula.get().certs[127688]).toBeUndefined();
  });
  it('marks photo oils as part of the shared budget, failing when the budget fails', async () => {
    await calc(doc([line(33091, 6), line(3216, 14), line(2665, 80)], 25));   // 75% + 87.5% of the budget
    expect(txt('#fr-33091')).toContain('นับในงบแพ้แสง · ไม่ผ่าน');
    expect(txt('#fr-3216')).toContain('นับในงบแพ้แสง · ไม่ผ่าน');
  });
  it('does not name a limiting material when nothing limits the concentration', async () => {
    await calc(doc([line(2845, 2), line(706, 98)]));
    expect(sumTxt()).toContain('ใส่หัวน้ำหอมได้สูงสุด 100% เพดานยังไม่จำกัดความเข้มข้น');
  });
  it('counts only non-draft links when drafts are off', async () => {
    app = loadApp();
    await sleep(30);
    app.click('#tab-form');
    app.click('#f-drafts');
    expect(txt('#f-count')).toContain('มีข้อมูลความเข้ากัน 247 จาก 1,106 ตัว');
  });
});
