// Loads app/index.html in jsdom with a fake claude.ai runtime (db + user).
// The fake store keeps documents in memory and answers onSnapshot like the platform:
// every write fires a fresh, non-cached snapshot of the whole collection.
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

export const APP_PATH = new URL('../../app/index.html', import.meta.url);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function loadApp({ runtime = 'db', docs = {}, uid = 'u1', storage = {} } = {}) {
  const src = fs.readFileSync(process.env.APP_FILE || APP_PATH, 'utf8');   // APP_FILE: run the same tests on another build (mutation checks)
  const writes = [];
  const store = new Map(Object.entries(docs));
  let snapCb = null;
  let closed = false;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const fire = () => {
    if (!snapCb || closed) return;
    snapCb({
      docs: [...store].map(([id, v]) => ({ id, exists: true, data: () => clone(v) })),
      metadata: { fromCache: false },
    });
  };
  const col = {
    doc: (id) => ({
      set: (v) => { writes.push({ op: 'set', id, v: clone(v) }); store.set(id, clone(v)); setTimeout(fire, 0); return Promise.resolve(); },
      delete: () => { writes.push({ op: 'delete', id }); store.delete(id); setTimeout(fire, 0); return Promise.resolve(); },
    }),
    onSnapshot: (cb) => { snapCb = cb; setTimeout(fire, 0); return () => {}; },
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
  const remote = (id, v) => { if (v === null) store.delete(id); else store.set(id, clone(v)); fire(); };
  const data = JSON.parse(doc.getElementById('catalog-data').textContent);
  return { dom, win, doc, $, $$, click, type, change, writes, store, remote, data, close: () => { closed = true; } };   // the app's own timers may still run: keep the window alive
}
