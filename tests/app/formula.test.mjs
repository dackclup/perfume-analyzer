// Formula tab: compatibility filter, IFRA maths, saving.
// Known answers come from the project docs (file 5 example 2, file 6 formula B) and from an
// independent Python build of the same compatibility graph (17 Oct 2026 mockup analysis).
import { describe, it, expect, afterEach } from 'vitest';
import { loadApp, sleep } from './harness.mjs';

let app;
afterEach(() => { if (app) app.close(); app = null; });

const EX2 = { v: 1, conc: 8, certs: {}, at: 1, items: [   // file 5, example 2, as grams for a 10 g batch
  { pid: 127688, g: 1.2, dil: 100, filt: false }, { pid: 2493, g: 0.6, dil: 100, filt: false },
  { pid: 2685, g: 0.4, dil: 100, filt: false }, { pid: 3222, g: 0.4, dil: 100, filt: false },
  { pid: 2665, g: 2.0, dil: 100, filt: false }, { pid: 2845, g: 2.5, dil: 100, filt: false },
  { pid: 2810, g: 1.0, dil: 10, filt: false }, { pid: 2821, g: 1.5, dil: 10, filt: false },
  { pid: 2877, g: 0.4, dil: 100, filt: false }] };
const B = [[3216, 8], [33091, 3], [127688, 8], [2493, 5], [3215, 1], [3287, 0.5], [2698, 4], [3198, 1.5], [2944, 1.5],   // file 6, formula B (%)
  [2665, 12], [2845, 25], [2843, 6], [32773, 3], [2846, 4], [3241, 3], [3257, 1.5], [3220, 1], [2810, 2], [2821, 1.5], [2877, 8], [2905, 0.5]];
const FORM_B = { v: 1, conc: 25, certs: { 127688: 40 }, at: 1, items: B.map(([pid, g]) => ({ pid, g, dil: 100, filt: false })) };

async function formTab(opts) {
  app = loadApp(opts);
  await sleep(30);
  app.click('#tab-form');
  return app;
}
const txt = (sel) => app.$(sel).textContent.replace(/\s+/g, ' ').trim();
const sumTxt = () => app.$$('#f-sum > div').map((d) => [...d.children].map((c) => c.textContent.trim()).join(' ')).join(' | ');

describe('compatibility data', () => {
  it('accord data names only products in the catalog', () => {
    app = loadApp();
    const acc = JSON.parse(app.doc.getElementById('accord-data').textContent);
    const codes = new Set(app.data.items.map((x) => x.i));
    for (const a of acc) for (const g of a.g) for (const c of g) expect(codes.has(c), a.l + ' ' + c).toBe(true);
    expect(acc.filter((a) => a.k === 'pub').length).toBe(5);
  });
  it('matches the independent Python build of the graph', () => {
    app = loadApp();
    const C = app.win.__compat, ids = app.data.items.map((x) => x.i);
    const nb = (a) => ids.filter((c) => c !== a && C.lvl(a, c) > 0);
    const and = (...s) => ids.filter((c) => !s.includes(c) && s.every((a) => C.lvl(a, c) > 0)).length;
    expect(C.size()).toBe(253);
    expect(nb(2810).length).toBe(49);
    expect(and(2810, 2845)).toBe(44);
    expect(and(2493, 2845, 2810)).toBe(36);
    expect(and(2821, 3293)).toBe(0);
    C.setDrafts(false);
    expect(nb(2810).length).toBe(18);
    expect(and(2810, 2845)).toBe(11);
    expect(and(2493, 2845, 2810)).toBe(4);
  });
  it('links count both ways', () => {
    app = loadApp();
    const C = app.win.__compat, ids = app.data.items.map((x) => x.i);
    for (const a of [2810, 2845, 2665, 2821, 127688]) for (const b of ids) expect(C.lvl(a, b)).toBe(C.lvl(b, a));
  });
});

describe('IFRA rules', () => {
  it('every expressed citrus / photo-sensitising oil with a cap is in the shared budget', () => {
    app = loadApp();
    const { PHOTO, CERT, kind } = app.win.__ifra;
    for (const x of app.data.items) {
      const said = /แพ้แสง/.test([x.ifn, x.wo, x.r, x.eu, x.d, x.tip].join(' '));
      const k = kind(x).k;
      if (said && (k === 'cap' || k === 'cert')) expect(PHOTO.has(x.i), 'missing ' + x.i).toBe(true);
      if (PHOTO.has(x.i)) expect(['cap', 'cert']).toContain(k);
    }
    for (const c of CERT) expect(/FCF/.test(app.data.items.find((x) => x.i === c).ifn)).toBe(true);
  });
  it('uses the same 117 caps as the detail sheet', () => {
    app = loadApp();
    const { kind } = app.win.__ifra;
    const caps = app.data.items.filter((x) => kind(x).k === 'cap');
    expect(caps.length).toBe(117);
    for (const x of caps) expect(kind(x).cap).toBe(parseFloat(x.ifra));
  });
  it('never calls a warned solvent plain "solvent"', () => {
    app = loadApp();
    const { kind } = app.win.__ifra;
    for (const x of app.data.items.filter((y) => y.t === 5 && y.w)) expect(kind(x).k).not.toBe('solvent');
  });
});

describe('calculation · file 5 example 2', () => {
  it('fails at 8% while Bergamot FCF has no certificate', async () => {
    await formTab({ docs: { fdraft: EX2 } });
    await sleep(20);
    app.click('[data-fview="calc"]');
    const v = txt('#f-verdict');
    expect(v).toContain('ยังไม่ผ่าน IFRA ที่ 8%');
    expect(v).toContain('Bergamot FCF 0.96% เกินเพดาน 0.40%');
    expect(v).toContain('งบผิวแพ้แสงรวม 240% เกิน 100%');
    expect(v).toContain('ยังตรวจไม่ได้: Lavender Oil');
    const sum = sumTxt();
    expect(sum).toContain('สารหอมจริงในขวด 6.2%');
    expect(sum).toContain('ใส่หัวน้ำหอมได้สูงสุด 3.3%');
    expect(sum).toContain('งบผิวแพ้แสงรวม 240%');
    expect(sum).toContain('≈ ฿82');
    expect(txt('#f-bottle')).toContain('หัวน้ำหอม 1.92 g + แอลกอฮอล์ 22.08 g');
  });
  it('matches file 5 once the certificate cap (40%) is entered', async () => {
    await formTab({ docs: { fdraft: EX2 } });
    await sleep(20);
    app.click('[data-fview="calc"]');
    app.click('[data-fopen="127688"]');
    expect(app.$('#fe-cert')).toBeTruthy();
    app.type('#fe-cert', '40');
    app.click('[data-fdone]');
    const v = txt('#f-verdict'), sum = sumTxt();
    expect(v).toContain('ผ่านเฉพาะตัวที่ตรวจได้ ที่ 8%');
    expect(v).not.toContain('เกินเพดาน');
    expect(sum).toContain('ใส่หัวน้ำหอมได้สูงสุด 80%');
    expect(sum).toContain('จำกัดโดย Iso E Super');
    expect(sum).toContain('งบผิวแพ้แสงรวม 2.4%');
    app.click('[data-fconc="25"]');
    expect(txt('#f-verdict')).toContain('ที่ 25%');
    expect(sumTxt()).toContain('งบผิวแพ้แสงรวม 7.5%');
    await sleep(800);
    const last = app.writes.filter((w) => w.id === 'fdraft').pop();
    expect(last.v.conc).toBe(25);
    expect(last.v.certs['127688']).toBe(40);
  });
  it('shows every row with its status', async () => {
    await formTab({ docs: { fdraft: EX2 } });
    await sleep(20);
    app.click('[data-fview="calc"]');
    expect(txt('#fr-2845')).toContain('ในขวด 2.00%');
    expect(txt('#fr-2845')).toContain('เพดาน 20% · ผ่าน');
    expect(txt('#fr-2821')).toContain('สารละลาย 10%');
    expect(txt('#fr-2821')).toContain('ในขวด 0.12%');
    expect(txt('#fr-2685')).toContain('ไม่มีเพดาน · มีข้อกำหนดคุณภาพ');
    expect(txt('#fr-3222')).toContain('ยังตรวจไม่ได้');
    expect(txt('#fr-2877')).toContain('ไม่อยู่ในมาตรฐาน IFRA 51');
  });
});

describe('calculation · file 6 formula B', () => {
  it('uses 92.5% of the phototoxic budget at 25% (file 6) and limits the concentration by it', async () => {
    await formTab({ docs: { fdraft: FORM_B } });
    await sleep(20);
    app.click('[data-fview="calc"]');
    const v = txt('#f-verdict'), sum = sumTxt();
    expect(v).not.toContain('เกินเพดาน');
    expect(sum).toContain('งบผิวแพ้แสงรวม 92.5%');
    expect(sum).toContain('ใส่หัวน้ำหอมได้สูงสุด 27%');
    expect(sum).toContain('จำกัดโดยงบผิวแพ้แสง');
    app.click('[data-fconc="20"]');
    expect(sumTxt()).toContain('งบผิวแพ้แสงรวม 74%');   // file 6: 40% + 30% + 4% = 74%
  });
});

describe('picker', () => {
  it('filters by every material in the formula', async () => {
    await formTab();
    expect(txt('#f-count')).toContain('มีข้อมูลความเข้ากัน 253 จาก 1,106 ตัว');
    app.click('[data-fadd="2810"]');
    expect(txt('#f-count')).toBe('เข้ากับ Ambroxan · 49 ตัว');
    app.click('[data-fadd="2845"]');
    expect(txt('#f-count')).toBe('เข้ากับทั้ง 2 ตัวที่กรอง · 44 ตัว');
    expect(app.$$('#f-chips .fchip.on').length).toBe(2);
    app.click('[data-ftoggle="2810"]');
    expect(txt('#f-count')).toMatch(/^เข้ากับ Iso E Super · \d+ ตัว$/);
    app.click('#f-drafts');
    app.click('[data-ftoggle="2810"]');
    expect(txt('#f-count')).toBe('เข้ากับทั้ง 2 ตัวที่กรอง · 11 ตัว');
    expect(app.$('#f-list .ev').textContent).toMatch(/^หลักฐาน: (เผยแพร่|PA)$/);
  });
  it('says "no data" (not "incompatible") at zero and offers the whole catalog', async () => {
    await formTab();
    app.click('[data-fadd="2821"]');
    app.click('[data-fadd="3293"]');
    expect(txt('#f-empty')).toContain('ยังไม่มีข้อมูลว่าเข้ากับทั้ง 2 ตัวที่กรอง');
    expect(txt('#f-empty')).toContain('ไม่ได้แปลว่าไม่เข้ากัน');
    app.click('[data-fall]');
    expect(txt('#f-count')).toBe('ค้นทั้งคลัง · 1,104 ตัว');
    app.type('#fq', 'ethyl alcohol');
    await sleep(200);
    expect(app.$('#f-list .row .nm').textContent).toContain('Ethyl Alcohol');
  });
  it('shows the sources of a pair on the detail sheet', async () => {
    await formTab();
    app.click('[data-fadd="2810"]');
    app.click('[data-fadd="2845"]');
    app.click('#f-list [data-open="2665"]');
    const body = txt('#sheet-body');
    expect(body).toContain('สำหรับสูตร');
    expect(body).toContain('เข้ากับ Ambroxan เพราะ');
    expect(body).toContain('เข้ากับ Iso E Super เพราะ');
    expect(body).toContain('Grojsman accord');
    app.click('#sheet-body [data-fadd="2665"]');
    expect(txt('#sheet-body')).toContain('อยู่ในสูตรแล้ว');
  });
  it('removes a material with ×', async () => {
    await formTab();
    app.click('[data-fadd="2810"]');
    app.click('[data-fdel="2810"]');
    expect(app.$('#f-chips-wrap').hidden).toBe(true);
    expect(app.$('#form-badge').textContent).toBe('');
  });
});

describe('editing a line', () => {
  it('reads grams, rejects text, and hints at dilution below 0.1 g', async () => {
    await formTab();
    app.click('[data-fadd="2810"]');
    app.click('#f-go');
    expect(txt('#f-verdict')).toContain('ยังไม่มีกรัมในสูตร');
    app.click('[data-fopen="2810"]');
    app.type('#fe-g', 'abc');
    expect(app.$('#fe-g').getAttribute('aria-invalid')).toBe('true');
    app.change('#fe-g');
    expect(app.$('#fe-g').value).toBe('');
    app.type('#fe-g', '0,05');
    expect(txt('#fe-live')).toContain('น้อยกว่า 0.1 g');
    app.click('[data-fdil="10"]');
    expect(txt('#fe-live')).not.toContain('น้อยกว่า 0.1 g');
    app.click('[data-fdone]');
    expect(txt('#fr-2810')).toContain('สารละลาย 10%');
  });
});

describe('saving', () => {
  it('saves the formula to the private store', async () => {
    await formTab();
    app.click('[data-fadd="2810"]');
    await sleep(800);
    const w = app.writes.filter((x) => x.id === 'fdraft').pop();
    expect(w.v.items).toEqual([{ pid: 2810, g: null, dil: 100, filt: true }]);
  });
  it('shows a formula saved on another device', async () => {
    await formTab();
    app.remote('fdraft', EX2);
    await sleep(10);
    expect(app.$('#form-badge').textContent).toBe('9');
  });
  it('keeps unsaved local changes over an older server copy', async () => {
    await formTab();
    app.click('[data-fadd="2810"]');
    app.remote('fdraft', EX2);   // arrives before the 650 ms save
    expect(app.$('#form-badge').textContent).toBe('1');
    await sleep(800);
    expect(app.store.get('fdraft').items.length).toBe(1);
  });
  it('drops unknown products and bad values from a stored formula', async () => {
    await formTab({ docs: { fdraft: { items: [{ pid: 2886, g: 1 }, { pid: 2810, g: -3, dil: 7 }, { pid: 2810, g: 1 }], conc: 12, certs: { 2810: 5, 127688: 'x' } } } });
    await sleep(20);
    const f = app.win.__formula.get();
    expect(f.items).toEqual([{ pid: 2810, g: null, dil: 100, filt: false }]);
    expect(f.conc).toBe(8);
    expect(f.certs).toEqual({});
  });
  it('warns when the formula cannot be saved', async () => {
    await formTab({ runtime: 'none' });
    await sleep(20);
    expect(txt('#form-banner')).toContain('บันทึกสูตรไม่ได้');
    app.click('[data-fadd="2810"]');
    expect(app.$('#form-badge').textContent).toBe('1');
  });
});

describe('tabs', () => {
  it('has three tabs that keep the catalog and shopping list working', async () => {
    app = loadApp();
    await sleep(30);
    expect(app.$$('[role="tab"]').length).toBe(3);
    app.click('#tab-form');
    expect(app.$('#view-form').hidden).toBe(false);
    expect(app.$('#view-cat').hidden).toBe(true);
    app.click('#tab-cart');
    expect(app.$('#view-cart').hidden).toBe(false);
    expect(app.$('#view-form').hidden).toBe(true);
    const tl = app.$('[role="tablist"]');
    tl.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(app.$('#view-cat').hidden).toBe(false);
  });
});
