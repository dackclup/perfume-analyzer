// lib/dom-utils.mjs — shared DOM helpers between index.html and formulation.html.
//
// Audit-coherence Tier 2 R3 fix. Both pages historically defined their
// own variants of these helpers — esc() vs escHtml(), separate setTimeout
// debouncers, ad-hoc try/catch init wrappers. The drift was real (esc
// did not escape apostrophes; escHtml dropped 0/false/empty values),
// and only one of them was security-correct.
//
// This module is the single source of truth. Loaded from both pages
// via <script type="module">; also assigned to window.appUtils so the
// inline classic-script init blocks can read it after the bootstrap
// activates them.

// ── escHtml ────────────────────────────────────────────────────────────
// Defensive HTML/attribute escape. Returns '' for null/undefined only —
// numbers and false are coerced to strings (so escHtml(0) === '0', not '').
// Escapes the apostrophe so attribute values that use single quotes are
// also safe (the analyzer used double quotes only, but defence-in-depth).
export function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── debounce ───────────────────────────────────────────────────────────
// Standard trailing-edge debounce. Exposes `.cancel()` and `.flush()`
// because the formulator's _scheduleCommit relies on those.
export function debounce(fn, delay) {
  let timer = null;
  let lastArgs = null;
  let lastThis = null;
  const debounced = function (...args) {
    lastArgs = args;
    lastThis = this;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(lastThis, lastArgs);
    }, delay);
  };
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn.apply(lastThis, lastArgs);
    }
  };
  return debounced;
}

// ── safeInit ───────────────────────────────────────────────────────────
// Wraps an init call so a throw in one block can't poison the rest of
// the inline script (TDZ class of bug — see CONTRIBUTING.md, the
// v184/v187/v188/v189/v192 fix series). Logs to console.error with a
// named tag so the bug is debuggable.
export function safeInit(name, fn) {
  try {
    return fn();
  } catch (e) {
    console.error('[init] ' + name + ' threw:', e);
    return undefined;
  }
}

// ── normaliseMaterialKey ───────────────────────────────────────────────
// Audit-coherence C2.3 fix — collapses Greek-letter prefixes and Unicode
// punctuation so 'γ-Decalactone' / 'gamma-Decalactone' / 'Gamma-Decalactone'
// all resolve to the same key. Used by blends_with resolvers and the
// formulator's add-modal search.
// JS \b is ASCII-only, so it doesn't fire next to a Greek letter — drop
// it and use a lookbehind on start-of-string / non-letter so 'α-Pinene'
// and 'foo (α-pinene)' both match while 'falpha' (no Greek) doesn't.
const GREEK_TO_LATIN = [
  [/(^|[^\p{L}])[αΑ]\s*-?\s*/gu, '$1alpha-'],
  [/(^|[^\p{L}])[βΒ]\s*-?\s*/gu, '$1beta-'],
  [/(^|[^\p{L}])[γΓ]\s*-?\s*/gu, '$1gamma-'],
  [/(^|[^\p{L}])[δΔ]\s*-?\s*/gu, '$1delta-'],
  [/(^|[^\p{L}])[εΕ]\s*-?\s*/gu, '$1epsilon-'],
  [/(^|[^\p{L}])[ωΩ]\s*-?\s*/gu, '$1omega-'],
];
export function normaliseMaterialKey(s) {
  if (s == null) return '';
  let out = String(s).toLowerCase().trim();
  for (const [re, repl] of GREEK_TO_LATIN) out = out.replace(re, repl);
  // Smart quotes / em-dash → ASCII equivalents so 'd-Limonene' matches.
  out = out
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .normalize('NFKD');
  // Collapse repeated whitespace to single space
  out = out.replace(/\s+/g, ' ');
  return out;
}

// Expose to inline classic scripts via window.appUtils (the inline init
// blocks in index.html / formulation.html aren't modules, so they read
// from this global).
if (typeof window !== 'undefined') {
  window.appUtils = window.appUtils || {};
  window.appUtils.escHtml = escHtml;
  window.appUtils.debounce = debounce;
  window.appUtils.safeInit = safeInit;
  window.appUtils.normaliseMaterialKey = normaliseMaterialKey;
}
