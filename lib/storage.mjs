// lib/storage.mjs — versioned localStorage helpers.
//
// Audit-coherence Tier 2 R3 fix. Every page had its own try/catch +
// JSON.parse wrapper around localStorage reads; the variants drifted
// (some swallowed parse errors silently, some warned, some returned
// `[]` vs `null`), and a corrupted payload could trigger a deep crash
// because each reader hand-rolled its own shape check.
//
// Single source of truth so:
//   1. Quota / private-mode / SecurityError exceptions never escape.
//   2. JSON.parse failures fall back to a documented default value
//      instead of returning a half-parsed object.
//   3. Optional validator lets callers reject payloads whose shape
//      doesn't match the current expectation (defends against shape
//      evolution without forcing a one-time data wipe on every user).

// ── lsRead ────────────────────────────────────────────────────────────
// JSON-decode a key. Returns `defaultValue` when:
//   • localStorage access throws (private mode, disabled storage)
//   • the key is missing
//   • JSON.parse throws (corrupted payload)
//   • validate(parsed) returns false (shape mismatch)
//
// validate is OPTIONAL — pass it for keys whose shape may evolve.
export function lsRead(key, defaultValue = null, validate = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return defaultValue;
    const parsed = JSON.parse(raw);
    if (validate && !validate(parsed)) return defaultValue;
    return parsed;
  } catch (_) {
    return defaultValue;
  }
}

// ── lsWrite ───────────────────────────────────────────────────────────
// JSON-encode and store. Returns true on success, false on any failure
// (quota exceeded, private-mode SecurityError, serialisation cycle).
// Logs the failure with a tagged prefix so a silent storage failure is
// at least debuggable in DevTools.
export function lsWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[storage] write failed for ' + key + ':', e);
    return false;
  }
}

// ── lsRemove ──────────────────────────────────────────────────────────
// Safe key removal. Never throws; returns true on success.
export function lsRemove(key) {
  try { localStorage.removeItem(key); return true; }
  catch (_) { return false; }
}

// ── lsGetString / lsSetString ─────────────────────────────────────────
// Plain string accessors — used for `perfume_lang`, `perfume_theme`
// etc. that store a raw scalar (no JSON encoding). Skip these wrappers
// when interop with code that calls localStorage directly is needed.
export function lsGetString(key, defaultValue = null) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? defaultValue : v;
  } catch (_) { return defaultValue; }
}
export function lsSetString(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch (_) { return false; }
}

// Expose to inline classic scripts via window.appUtils.
if (typeof window !== 'undefined') {
  window.appUtils = window.appUtils || {};
  window.appUtils.lsRead      = lsRead;
  window.appUtils.lsWrite     = lsWrite;
  window.appUtils.lsRemove    = lsRemove;
  window.appUtils.lsGetString = lsGetString;
  window.appUtils.lsSetString = lsSetString;
}
