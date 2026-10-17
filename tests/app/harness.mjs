// Loads app/index.html in jsdom with a fake claude.ai runtime (db + user).
// The fake store keeps documents in memory and answers onSnapshot like the platform:
// every write fires a fresh, non-cached snapshot of the whole collection.
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

export const APP_PATH = new URL('../../app/index.html', import.meta.url);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Options for the platform's harder cases (round 38): firstDelay = ms before the server's first view ·
// cached = docs of a cached first view sent at once (fromCache) · writeDelay = ms before a write lands and
// is acknowledged · echoDelay = ms after the acknowledgement before the new view arrives (default: view first) ·
// fail(id, v) = true makes that write reject (code 'unavailable') · hold = writes wait until the test calls
// land() (oldest first: store it, acknowledge it) and echo() (send the current view), so the order is exact.
export function loadApp({ runtime = 'db', docs = {}, uid = 'u1', storage = {}, firstDelay = 0, cached = null, writeDelay = 0, echoDelay = -1, fail = null, hold = false } = {}) {
  const src = fs.readFileSync(process.env.APP_FILE || APP_PATH, 'utf8');   // APP_FILE: run the same tests on another build (mutation checks)
  const writes = [];
  const store = new Map(Object.entries(docs));
  let snapCb = null;
  let closed = false;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const send = (m, fromCache) => {
    if (!snapCb || closed) return;
    snapCb({
      docs: [...m].map(([id, v]) => ({ id, exists: true, data: () => clone(v) })),
      metadata: { fromCache },
    });
  };
  let started = false;
  const held = [];
  const fire = () => { if (started) send(store, false); };
  const write = (rec, apply) => {
    writes.push(rec);
    if (fail && fail(rec.id, rec.v)) return new Promise((res, rej) => setTimeout(() => rej({ code: 'unavailable' }), writeDelay));
    if (hold) return new Promise((res) => held.push(() => { apply(); res(); }));
    if (!writeDelay && echoDelay < 0) { apply(); setTimeout(fire, 0); return Promise.resolve(); }   // default: stored and acknowledged at once, view right after (as before round 38)
    return new Promise((res) => setTimeout(() => { apply(); if (echoDelay < 0) { fire(); res(); } else { res(); setTimeout(fire, echoDelay); } }, writeDelay));
  };
  const col = {
    doc: (id) => ({
      set: (v) => write({ op: 'set', id, v: clone(v) }, () => store.set(id, clone(v))),
      delete: () => write({ op: 'delete', id }, () => store.delete(id)),
    }),
    onSnapshot: (cb) => {
      snapCb = cb;
      if (cached) setTimeout(() => send(new Map(Object.entries(cached)), true), 0);
      setTimeout(() => { started = true; fire(); }, firstDelay);
      return () => {};
    },
  };
  const db = { collection: () => col };
  const user = { id: () => Promise.resolve(uid) };

  const dom = new JSDOM(src, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://artifact.test/',
    beforeParse(win) {
      if (runtime === 'db') win.claude = { use: (name) => Promise.resolve(name === 'db' ? db : name === 'user' ? user : null) };
      win.scrollTo = () => {};
      win.HTMLElement.prototype.scrollIntoView = function () {};
      for (const [k, v] of Object.entries(storage)) win.localStorage.setItem(k, v);
    },
  });
  const win = dom.window;
  const doc = win.document;
  const $ = (sel) => doc.querySelector(sel);
  const $$ = (sel) => [...doc.querySelectorAll(sel)];
  const click = (el) => { if (typeof el === 'string') el = $(el); el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); return el; };
  const type = (el, value) => {
    if (typeof el === 'string') el = $(el);
    el.focus();
    el.value = value;
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    return el;
  };
  const change = (el) => { if (typeof el === 'string') el = $(el); el.dispatchEvent(new win.Event('change', { bubbles: true })); return el; };
  const remote = (id, v) => { if (v === null) store.delete(id); else store.set(id, clone(v)); started = true; fire(); };
  const data = JSON.parse(doc.getElementById('catalog-data').textContent);
  return { dom, win, doc, $, $$, click, type, change, writes, store, remote, data, land: () => held.shift()(), echo: () => fire(), held, close: () => { closed = true; } };   // the app's own timers may still run: keep the window alive
}
