// Formula tab: compatibility filter, IFRA maths, saving.
// Known answers come from the project docs (file 5 example 2, file 6 formula B) and from an
// independent Python build of the same-accord rule (round 43, 18 Oct 2026).
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
  // Round 43: only accords that someone published (files 5–6) count; the Perfume Analyzer lists and Claude's drafts are gone.
  // Known answers: scratchpad same_accord.py, an independent Python build (union-find over the groups) of 18 Oct 2026.
  it('accord data names only products in the catalog, published accords only', () => {
    app = loadApp();
    const acc = JSON.parse(app.doc.getElementById('accord-data').textContent);
    const codes = new Set(app.data.items.map((x) => x.i));
    for (const a of acc) for (const g of a.g) for (const c of g) expect(codes.has(c), a.l + ' ' + c).toBe(true);
    expect(acc.length).toBe(5);
    for (const a of acc) { expect(a.k).toBe('pub'); expect(a.l).not.toMatch(/ร่าง|ไม่ระบุที่มา/); }
  });
  it('matches the independent Python build', () => {
    app = loadApp();
    const C = app.win.__compat;
    const shape = (F) => C.same(F).map((s) => s.l.split(' (')[0] + ':' + s.rows.length).join(' | ');
    expect(C.size()).toBe(34);
    expect(C.mats()).toBe(23);
    expect(shape([])).toBe('Accord 1.1 อำพัน–ไม้:2 | Accord 1.2 Fougère สด:4 | Grojsman accord:3 | Accord 1.4 ทะเล:3 | Fougère สมัยใหม่:11');
    expect(shape([2845])).toBe('Accord 1.1 อำพัน–ไม้:1 | Grojsman accord:3 | Accord 1.4 ทะเล:3 | Fougère สมัยใหม่:14');
    expect(shape([2845, 2665])).toBe('Grojsman accord:2 | Accord 1.4 ทะเล:3 | Fougère สมัยใหม่:14');
    expect(shape([2845, 2810])).toBe('Accord 1.1 อำพัน–ไม้:0');
    expect(shape([2810, 2845, 2665])).toBe('');
    expect(shape([2493, 2845, 2810])).toBe('');
    expect(shape([2821, 3293])).toBe('');
    expect(shape([3222])).toBe('Accord 1.2 Fougère สด:3 | Fougère สมัยใหม่:14');   // an alternate code counts as its material
  });
  it('lists every material that shares an accord with all filters, once, and nothing else', () => {
    app = loadApp();
    const C = app.win.__compat;
    const acc = JSON.parse(app.doc.getElementById('accord-data').textContent);
    const m = new Map();   // this test's own material map: code -> lowest code met in the same group
    for (const a of acc) for (const g of a.g) { const r = m.get(g[0]) ?? g[0]; for (const c of g) if (!m.has(c)) m.set(c, r); }
    const mats = [...new Set(m.values())];
    const accM = acc.map((a) => new Set(a.g.map((g) => m.get(g[0]))));
    const sets = [[]].concat(mats.map((a) => [a]), mats.flatMap((a, i) => mats.slice(i + 1).map((b) => [a, b])));
    for (const F of sets) {
      const rows = C.same(F).flatMap((s) => s.rows);
      const want = new Set(accM.filter((s) => F.every((f) => s.has(f))).flatMap((s) => [...s]).filter((x) => !F.includes(x)));
      expect(rows.length, F.join('+')).toBe(new Set(rows).size);
      expect(new Set(rows), F.join('+')).toEqual(want);
    }
  });
  it('folds the alternate codes of one material into one', () => {
    app = loadApp();
    const C = app.win.__compat;
    expect(C.mat(6901)).toBe(3223);
    expect(C.mat(2666)).toBe(2665);
    expect(C.alts(3222)).toEqual([3223, 6901, 3222, 33088]);
    expect(C.mat(706)).toBe(706);
    expect(C.alts(706)).toEqual([]);
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
  const heads = () => app.$$('#f-list .fsec h3').map((h) => h.firstElementChild.textContent.split(' (')[0]);
  it('groups by the accords holding every filter, smallest first, and folds long ones', async () => {
    await formTab();
    expect(txt('#f-count')).toBe('สูตรที่เผยแพร่ 5 ชุด · วัตถุดิบ 23 ตัว (34 รหัสจาก 1,106) · ตัวอื่นใช้ "ทั้งคลัง"');
    app.click('[data-fadd="2845"]');
    expect(txt('#f-count')).toBe('อยู่ในสูตรเดียวกับ Iso E Super · 4 สูตร · 21 ตัว');
    expect(heads()).toEqual(['Accord 1.1 อำพัน–ไม้', 'Grojsman accord', 'Accord 1.4 ทะเล', 'Fougère สมัยใหม่']);
    const fold = app.$('#f-list [data-fsec]');
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(fold.textContent).toContain('14 ตัว · แตะเพื่อดู');
    app.click('[data-fadd="2665"]');
    expect(txt('#f-count')).toBe('อยู่ในสูตรเดียวกับทั้ง 2 ตัวที่กรอง · 3 สูตร · 19 ตัว');
    expect(app.$$('#f-list .row').length).toBe(5);
    app.click('#f-list [data-fsec]');
    expect(app.$$('#f-list .row').length).toBe(19);
    expect(app.doc.activeElement.getAttribute('aria-expanded')).toBe('true');   // focus stays on the header
    expect(app.$('#f-list .ev')).toBeNull();
    expect(txt('#f-list')).not.toMatch(/PA|ร่าง|หลักฐาน/);
    app.click('[data-ftoggle="2665"]');
    expect(txt('#f-count')).toBe('อยู่ในสูตรเดียวกับ Iso E Super · 4 สูตร · 20 ตัว');   // Hedione stays in the formula, so it is not offered
    expect(app.$('#f-list [data-fsec]').getAttribute('aria-expanded')).toBe('false');   // a new filter folds again
    expect(app.$('#f-drafts')).toBeNull();
  });
  it('shows a material once, with its other codes on the row', async () => {
    await formTab();
    app.click('#f-list [data-fsec]');
    expect(app.$$('#f-list .row').length).toBe(23);
    const lav = app.$('#f-list .row-main[data-open="3223"]').closest('.row');
    expect([...lav.querySelectorAll('.falt [data-open]')].map((b) => b.textContent)).toEqual(['6901', '3222', '33088']);
    app.click(lav.querySelector('.falt [data-open="3222"]'));
    expect(txt('#sheet-body')).toContain('วัตถุดิบเดียวกัน รหัสอื่น: 3223, 6901, 33088');
    app.click('#sheet-body [data-fadd="3222"]');
    app.click('#sheet-close');
    expect(txt('#f-count')).toMatch(/^อยู่ในสูตรเดียวกับ .+ · 2 สูตร · 17 ตัว$/);
    expect(app.$('#f-list [data-open="3223"]')).toBeNull();   // the same material in another code is not offered again
  });
  it('says "no published accord" (not "incompatible") at zero and offers the whole catalog', async () => {
    await formTab();
    app.click('[data-fadd="2810"]');
    expect(txt('#f-count')).toBe('อยู่ในสูตรเดียวกับ Ambroxan · 1 สูตร · 1 ตัว');
    app.click('[data-fadd="2845"]');
    expect(txt('#f-empty')).toContain('ใส่วัตถุดิบจากสูตรที่ใช้ร่วมกันครบแล้ว');
    app.click('[data-fall]');
    expect(txt('#f-count')).toBe('ค้นทั้งคลัง · 1,104 ตัว');
    app.type('#fq', 'lavandin');
    await sleep(200);
    expect(txt('#f-list')).toContain('ไม่มีข้อมูลความเข้ากัน');
    app.click('[data-fadd="3293"]');
    app.type('#fq', '');
    await sleep(200);
    app.click('#f-all');
    expect(txt('#f-empty')).toContain('ยังไม่มีสูตรที่เผยแพร่ที่ใช้ทั้ง 3 ตัวนี้ร่วมกัน');
    expect(txt('#f-empty')).toContain('ไม่ได้แปลว่าไม่เข้ากัน');
    expect(app.$('#f-empty [data-ftoggle="3293"]')).toBeTruthy();
    app.click('[data-fall]');
    app.type('#fq', 'ethyl alcohol');
    await sleep(200);
    expect(app.$('#f-list .row .nm').textContent).toContain('Ethyl Alcohol');
  });
  it('tags rows in the whole catalog by the filters', async () => {
    await formTab();
    app.click('[data-fadd="2845"]');
    app.click('#f-all');
    const tag = (pid) => app.$('#f-list .row-main[data-open="' + pid + '"] .ev')?.textContent;
    expect(tag(2884)).toBe('อยู่ในสูตรเดียวกับตัวที่กรอง');
    expect(app.$('#f-list .row').querySelector('.ev').textContent).toBe('อยู่ในสูตรเดียวกับตัวที่กรอง');   // shared accords first
    app.type('#fq', 'hedione');
    await sleep(200);
    expect(tag(2666)).toBe('อยู่ในสูตรเดียวกับตัวที่กรอง');
    app.click('[data-fadd="2665"]');   // adding clears the search
    app.type('#fq', 'hedione');
    await sleep(200);
    expect(tag(2666)).toBe('รหัสอื่นของวัตถุดิบที่อยู่ในสูตรแล้ว');
  });
  it('shows the shared accords of a pair on the detail sheet', async () => {
    await formTab();
    app.click('[data-fadd="2845"]');
    app.click('[data-fadd="2665"]');
    app.click('#f-list [data-open="2884"]');
    const sec = app.$$('#sheet-body .fsrc-h, #sheet-body .fsrc').map((p) => p.textContent.split(' (')[0]);
    expect(sec).toEqual(['ใช้ร่วมกับ Iso E Super ใน', 'Grojsman accord', 'Fougère สมัยใหม่', 'ใช้ร่วมกับ Hedione ใน', 'Grojsman accord', 'Fougère สมัยใหม่']);
    const body = txt('#sheet-body');
    expect(body.slice(body.indexOf('สำหรับสูตร'), body.indexOf('ไม่ใช่ผลดมจริง'))).not.toMatch(/Perfume Analyzer|PA|ร่าง/);
    app.click('#sheet-body [data-fadd="2884"]');
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
