// Round 40: fixes for the third independent review (file 8 section 11). Every test here fails on the build that
// review checked (commit ac983f4), except those marked "guard", which close gaps its mutation run found.
// Round 41 removed the "nothing new" skip (it lost edits), and its test with it.
import { describe, it, expect, afterEach } from 'vitest';
import { loadApp, sleep } from './harness.mjs';

let app;
afterEach(() => { if (app) app.close(); app = null; });

const line = (pid, g, dil = 100) => ({ pid, g, dil, filt: false });
const doc = (items, conc = 8, certs = {}) => ({ v: 1, conc, certs, at: 1, items });
const txt = (sel) => app.$(sel).textContent.replace(/\s+/g, ' ').trim();
const sumTxt = () => app.$$('#f-sum > div').map((d) => [...d.children].map((c) => c.textContent.trim()).join(' ')).join(' | ');
const fd = () => app.writes.filter((w) => w.id === 'fdraft');
const hide = () => {
  Object.defineProperty(app.doc, 'visibilityState', { value: 'hidden', configurable: true });
  app.doc.dispatchEvent(new app.win.Event('visibilitychange'));
};
async function calc(fdraft, opts = {}) {
  app = loadApp({ docs: { fdraft }, ...opts });
  await sleep(30);
  app.click('#tab-form');
  app.click('[data-fview="calc"]');
  return app;
}
async function formTab(opts) { app = loadApp(opts); await sleep(30); app.click('#tab-form'); return app; }

describe('saving', () => {
  it('sends the newest edit on page hide even while an earlier save is unanswered', async () => {
    await formTab({ hold: true });
    app.click('[data-fadd="2810"]');
    await sleep(700);   // save 1 is out, no answer yet
    app.click('[data-fadd="2845"]');
    hide();
    await sleep(0);
    expect(fd().length).toBe(2);
    expect(fd()[1].v.items.map((i) => i.pid)).toEqual([2810, 2845]);
  });
  it('treats a repeat of the formula it replaced as a late view, not a change elsewhere', async () => {
    const old = doc([line(2665, 5)]);
    await formTab({ docs: { fdraft: old }, hold: true });
    app.click('[data-fadd="2810"]');
    await sleep(700);   // save is out
    app.view({ fdraft: old }); await sleep(0);   // e.g. a shopping-list change re-sends the old formula
    app.land(); await sleep(0);
    expect(app.$('#form-badge').textContent).toBe('2');
    expect(txt('#toast')).not.toContain('หน้าอื่นหรือเครื่องอื่น');
    app.view({ fdraft: old }); await sleep(0);   // and once more after the answer
    expect(app.$('#form-badge').textContent).toBe('2');
    app.click('[data-fadd="2845"]');
    await sleep(700);
    app.land(); await sleep(0);
    expect(app.store.get('fdraft').items.map((i) => i.pid)).toEqual([2665, 2810, 2845]);
  });
  it('does not empty the formula on a late view without one, after this page saved', async () => {
    await formTab({ hold: true });   // the account has no formula yet
    app.click('[data-fadd="2810"]');
    await sleep(700);
    app.land(); await sleep(0);
    app.view({}); await sleep(0);   // a late view from before the save
    expect(app.$('#form-badge').textContent).toBe('1');
  });
  it('keeps saving after a save throws', async () => {
    await formTab();
    const col = (await app.win.claude.use('db')).collection('x');   // the fake store hands out one collection object
    const docFn = col.doc;
    let boom = true;
    col.doc = (id) => (id === 'fdraft' && boom ? (boom = false, { set: () => { throw new Error('sync'); } }) : docFn(id));
    app.click('[data-fadd="2810"]');
    await sleep(800);   // this save throws inside the platform call
    app.click('[data-fadd="2845"]');
    await sleep(800);
    expect(app.store.get('fdraft').items.map((i) => i.pid)).toEqual([2810, 2845]);
  });
  it('ignores a cached view once the server has answered · guard', async () => {
    await formTab({ docs: { fdraft: doc([line(2845, 20)]) } });
    await sleep(10);
    app.view({ fdraft: doc([line(2665, 1), line(2810, 1)]) }, true);
    await sleep(0);
    expect(app.$('#form-badge').textContent).toBe('1');
  });
  it('says retries ran out only after the last one failed', async () => {
    await formTab({ fail: (id) => id === 'fdraft' });
    app.click('[data-fadd="2810"]');
    await sleep(14500);   // the save, retry 1 (3 s) and retry 2 (6 s) failed, each with its quick retry; retry 3 waits 9 s
    expect(txt('#form-banner')).toContain('แอปจะลองใหม่เอง');
    expect(txt('#form-banner')).not.toContain('ลองใหม่ครบ');
  }, 20000);
  it('an edit after failed saves starts the retries over · guard', async () => {
    await formTab({ fail: (id) => id === 'fdraft' });
    app.click('[data-fadd="2810"]');
    await sleep(2400);   // failed once (retry 1 waits 3 s)
    app.click('[data-fadd="2845"]');   // the edit resets the count …
    await sleep(2400);   // … its save fails, so the next retry waits 3 s again (not 6 s)
    const n = fd().length;
    await sleep(3400);
    expect(fd().length).toBeGreaterThan(n);
  }, 15000);
});

describe('names and notes', () => {
  it('tells two products with the same short name apart everywhere', async () => {
    await calc(doc([line(9236, 0.3), line(2763, 0.3), line(2665, 99.4)]));
    const v = txt('#f-verdict');
    expect(v).toContain('Damascenone 9236 + Damascenone 2763 ใช้เพดานเดียวกัน');
    expect(txt('#fr-9236')).toContain('รวมกับ Damascenone 2763');
  });
  it('says the max concentration ignores EU limits whenever a line has one', async () => {
    await calc(doc([line(2627, 0.02), line(2665, 99.98)]));   // MOC within EU at 8%
    expect(txt('#f-verdict')).not.toContain('EU');
    expect(sumTxt()).toContain('ไม่นับกฎ EU');
  });
});
