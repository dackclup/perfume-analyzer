// Round 41: fixes for the fourth independent review (file 8 section 11). Every test here fails on the build that
// review checked (commit 816fd42) unless marked "guard".
import { describe, it, expect, afterEach } from 'vitest';
import { loadApp, sleep } from './harness.mjs';

let app;
afterEach(() => { if (app) app.close(); app = null; });

const line = (pid, g, dil = 100) => ({ pid, g, dil, filt: false });
const txt = (sel) => app.$(sel).textContent.replace(/\s+/g, ' ').trim();
const fd = () => app.writes.filter((w) => w.id === 'fdraft');
const pids = (v) => v.items.map((i) => i.pid);
const setHidden = (h) => {
  Object.defineProperty(app.doc, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
  app.doc.dispatchEvent(new app.win.Event('visibilitychange'));
};
async function formTab(opts) { app = loadApp(opts); await sleep(30); app.click('#tab-form'); return app; }

describe('saving', () => {
  it('saves an edit back to this page\'s last saved content after another device\'s formula was shown', async () => {
    await formTab({ hold: true });
    app.click('[data-fadd="2810"]');
    await sleep(700); app.land(); await sleep(0);   // [A] saved
    app.view({ fdraft: { v: 1, conc: 8, certs: {}, at: 1, sid: 'other', n: 1, items: [{ pid: 2810, g: null, dil: 100, filt: true }, line(2845, null)] } });   // A exactly as this page saved it
    await sleep(0);
    expect(app.$('#form-badge').textContent).toBe('2');   // the other device's [A, B] is shown
    app.click('[data-fdel="2845"]');
    await sleep(700);
    expect(fd().length).toBe(2);
    app.land(); await sleep(0);
    expect(pids(app.store.get('fdraft'))).toEqual([2810]);
  });
  it('saves a removal made while a page-hide save is still unanswered', async () => {
    await formTab({ hold: true });
    app.click('[data-fadd="2810"]');
    await sleep(700); app.land(); await sleep(0);   // [A] saved
    app.click('[data-fadd="2845"]');
    setHidden(true); await sleep(0);   // [A, B] goes out at once
    setHidden(false);
    app.click('[data-fdel="2845"]');
    await sleep(700);
    while (app.held.length) { app.land(); await sleep(0); }
    expect(pids(app.store.get('fdraft'))).toEqual([2810]);
    expect(pids(fd().at(-1).v)).toEqual([2810]);
  });
  it('a quick retry sends the newest content, not the body of the failed attempt', async () => {
    let first = true;
    await formTab({ fail: (id) => { if (id === 'fdraft' && first) { first = false; return true; } return false; } });
    app.click('[data-fadd="2810"]');
    await sleep(680);   // the first attempt has just failed; the quick retry waits 400–1200 ms
    app.click('[data-fadd="2845"]');
    await sleep(1400);
    expect(pids(fd()[1].v)).toEqual([2810, 2845]);
  });
  it('ends with the newest content on the server when the older save lands last (page hide)', async () => {
    await formTab({ hold: true });
    app.click('[data-fadd="2810"]');
    await sleep(700);   // save 1 [A] out
    app.click('[data-fadd="2845"]');
    setHidden(true); await sleep(0);   // [A, B] sent at once, plus one more in turn
    setHidden(false);
    app.land(1); app.echo(); await sleep(0);   // the hide save lands first …
    app.land(0); app.echo(); await sleep(0);   // … the older save 1 lands last: the server holds [A]
    while (app.held.length) { app.land(); app.echo(); await sleep(0); }
    expect(pids(app.store.get('fdraft'))).toEqual([2810, 2845]);
    expect(app.$('#form-badge').textContent).toBe('2');
  });
  it('does not warn "not saved" when an older save fails after a newer one got through', async () => {
    await formTab({ hold: true });
    app.click('[data-fadd="2810"]');
    await sleep(700);   // save 1 out
    app.click('[data-fadd="2845"]');
    setHidden(true); await sleep(0);
    setHidden(false);
    app.land(1); await sleep(0);   // the newer hide save is answered
    app.refuse(0, 'internal'); await sleep(0);   // the older save 1 fails
    expect(txt('#form-banner')).not.toContain('บันทึกสูตรไม่สำเร็จ');
  });
  it('counts a save with no answer as failed', async () => {
    await formTab({ hold: true, setup: (w) => { w.__fSaveTimeout = 300; } });
    app.click('[data-fadd="2810"]');
    await sleep(1100);   // 650 ms pause + 300 ms with no answer
    expect(txt('#form-banner')).toContain('บันทึกสูตรไม่สำเร็จ');
    expect(txt('#form-banner')).toContain('แอปจะลองใหม่เอง');
  });
  it('does not say retries ran out while the first retry is still out', async () => {
    await formTab({ fail: (id) => id === 'fdraft', writeDelay: 1500 });
    app.click('[data-fadd="2810"]');
    await sleep(8500);   // save + quick retry failed (≈ 4 s), retry 1 sent at ≈ 7 s and still out
    app.click('#tab-cat'); app.click('#tab-form');   // any re-render
    expect(txt('#form-banner')).not.toContain('ลองใหม่ครบ');
  }, 15000);
});

describe('late views', () => {
  it('skips a late view of a formula this page replaced two saves ago', async () => {
    const x = { v: 1, conc: 8, certs: {}, at: 3, sid: 'dev0', n: 1, items: [line(2665, null)] };
    await formTab({ docs: { fdraft: x }, hold: true });
    app.click('[data-fadd="2810"]');
    await sleep(700); app.land(); app.echo(); await sleep(0);   // save 1 and its view
    app.click('[data-fadd="2845"]');
    await sleep(700);   // save 2 out
    app.view({ fdraft: x }); await sleep(0);   // the formula save 1 replaced turns up late
    app.land(); await sleep(0);
    expect(app.$('#form-badge').textContent).toBe('3');
    expect(txt('#toast')).not.toContain('หน้าอื่นหรือเครื่องอื่น');
    app.view({ fdraft: x }); await sleep(0);   // and again while idle
    expect(app.$('#form-badge').textContent).toBe('3');
  });
  it('does not warn "not saved" when only a copy of already-saved content failed', async () => {
    await formTab({ hold: true });
    app.click('[data-fadd="2810"]');
    await sleep(700);   // save 1 out
    app.click('[data-fadd="2845"]');
    setHidden(true); await sleep(0);   // the hide save goes out at once (index 1)
    setHidden(false);
    app.land(1); await sleep(0);   // and is answered: the newest content is saved
    app.refuse(0, 'unavailable'); await sleep(1300);   // save 1 fails; its quick retry sends the newest content again …
    const i = app.held.findIndex(() => true);
    app.refuse(i, 'internal'); await sleep(0);   // … and that copy fails too
    expect(txt('#form-banner')).not.toContain('บันทึกสูตรไม่สำเร็จ');
  });
});

describe('names', () => {
  it('tells two products with the same short name apart in the chips and toasts too', async () => {
    await formTab();
    app.click('#f-all');   // the whole catalog, so both are listed
    app.win.__formulaUI.add(9236);
    app.win.__formulaUI.add(2763);
    expect(txt('#f-chips')).toContain('Damascenone 9236');
    expect(txt('#f-chips')).toContain('Damascenone 2763');
    app.click('[data-fdel="2763"]');
    expect(txt('#toast')).toContain('เอา Damascenone 2763 ออกจากสูตรแล้ว');
  });
});
