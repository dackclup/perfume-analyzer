// Round 42: fixes for the fifth independent review (file 8 section 12). Every test here fails on the build that
// review checked (commit 474b0c3) unless marked "guard" (needed only once one save waits at a time: found by fuzzing
// the fix with the reviewer's simulator).
import { describe, it, expect, afterEach } from 'vitest';
import { loadApp, sleep } from './harness.mjs';

let app;
afterEach(() => { if (app) app.close(); app = null; });

const line = (pid, g, dil = 100) => ({ pid, g, dil, filt: false });
const fd = () => app.writes.filter((w) => w.id === 'fdraft');
const pids = (v) => v.items.map((i) => i.pid);
async function formTab(opts) { app = loadApp(opts); await sleep(30); app.click('#tab-form'); app.click('#f-all'); return app; }

describe('saving', () => {
  it('sends the newest again when a timed-out save lands after a newer one', async () => {
    await formTab({ hold: true, setup: (w) => { w.__fSaveTimeout = 300; } });
    app.click('[data-fadd="2810"]');
    await sleep(1000);   // save 1 [A] out, no answer within 300 ms: counted as failed
    app.click('[data-fadd="2845"]');
    await sleep(700);   // save 2 [A, B] out
    app.land(1); await sleep(0);   // save 2 lands and is answered
    app.land(0); await sleep(0);   // the timed-out save 1 lands last: the server holds [A]
    expect(app.held.length).toBe(1);   // the newest is sent again
    app.land(); await sleep(0);
    expect(pids(app.store.get('fdraft'))).toEqual([2810, 2845]);
  });
  it('keeps one save waiting behind an unanswered one, not one per edit', async () => {
    await formTab({ hold: true, setup: (w) => { w.__fSaveTimeout = 60000; } });
    for (const pid of [2810, 2845, 2665, 2821, 2884]) { app.click('[data-fadd="' + pid + '"]'); await sleep(700); }
    expect(app.held.length).toBe(1);   // save 1 still out
    while (app.held.length) { app.land(); await sleep(0); }
    expect(fd().length).toBe(2);   // save 1 + one save with all five
    expect(pids(app.store.get('fdraft'))).toEqual([2810, 2845, 2665, 2821, 2884]);
  });
});

describe('views', () => {
  it('prefers a later view of its own save over an earlier one from another device · guard', async () => {
    await formTab({ hold: true });
    const setHidden = (h) => { Object.defineProperty(app.doc, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true }); app.doc.dispatchEvent(new app.win.Event('visibilitychange')); };
    app.click('[data-fadd="2810"]');
    await sleep(700);   // save 1 [A] out
    app.click('[data-fadd="2845"]');
    setHidden(true); await sleep(0); setHidden(false);   // the hide save [A, B] out at once, one more queued
    app.land(1); await sleep(0);   // the hide save lands and is answered
    app.land(0); await sleep(0);   // save 1 lands; the queued save goes out
    app.view({ fdraft: { v: 1, conc: 8, certs: {}, at: 1, sid: 'other', n: 1, items: [line(2665, null)] } }); await sleep(0);   // another device's formula …
    app.view({ fdraft: fd()[1].v }); await sleep(0);   // … then a view of this page's hide save: newer on the server
    while (app.held.length) { app.land(); await sleep(0); }   // every save answered (no further view arrives)
    expect(pids(app.win.__formula.get())).toEqual([2810, 2845]);
    expect(pids(app.store.get('fdraft'))).toEqual([2810, 2845]);
  });
  it('shows a view of an older save of this page when it has the newest saved content', async () => {
    await formTab({ hold: true });
    app.click('[data-fadd="2810"]');
    await sleep(700); app.land(); await sleep(0);   // save 1 [A]
    app.click('[data-ftoggle="2810"]'); app.click('[data-ftoggle="2810"]');   // back to the same content
    await sleep(700); app.land(); await sleep(0);   // save 2, same content
    app.view({ fdraft: { v: 1, conc: 8, certs: {}, at: 1, sid: 'other', n: 1, items: [line(2665, null)] } }); await sleep(0);
    expect(app.$('#form-badge').textContent).toBe('1');
    expect(app.win.__formula.get().items[0].pid).toBe(2665);   // another device's formula is shown
    app.view({ fdraft: fd()[0].v }); await sleep(0);   // then the server shows this page's save 1 again (it landed last)
    expect(app.win.__formula.get().items[0].pid).toBe(2810);
  });
});
