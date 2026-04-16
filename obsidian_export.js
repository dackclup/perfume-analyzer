// ===== Obsidian Export (simplified) =====
// Each material note carries the material name + which filter
// categories it belongs to — nothing else. The 9 filter axes come
// straight from the filter drawer in index.html:
//   Use · Function · Type · Source · Regulatory · Note ·
//   Primary Family · Sub-families · Facet
//
// buildMaterialVaultZip ships a flat ZIP — no folders, no index
// pages, no README. formulationToMarkdown renders a single .md with
// one H2 block per material listing the same 9 filter memberships.
//
// Depends on:
//   - JSZip (window.JSZip, loaded via CDN) for the ZIP path only.
//   - DB global from perfumery_data.js (read only by the safeFileName
//     collision fallback when a record lacks a CAS).

(function () {
  'use strict';

  // ---- Filename helper ---------------------------------------------------

  // Replace filesystem-unsafe chars with '-'. Trailing dots/spaces stripped
  // (Windows hostility). Falls back to 'Untitled' for empty input.
  function safeFileName(name) {
    if (name == null) return 'Untitled';
    let s = String(name).trim();
    if (!s) return 'Untitled';
    s = s.replace(/[\/\\:*?"<>|]/g, '-')
         .replace(/\s+/g, ' ')
         .replace(/[.\s]+$/g, '');
    return s || 'Untitled';
  }

  // ---- YAML emitters -----------------------------------------------------

  // Conservative YAML quoting: numbers and clean alphanumerics pass
  // through; anything with reserved chars (:, #, [, ], etc.) is double-
  // quoted with internal `"` escaped.
  function yamlScalar(v) {
    if (v == null) return '';
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    const s = String(v);
    if (!s) return '""';
    if (/^[A-Za-z0-9_\- ]+$/.test(s) && !/^(true|false|null|yes|no)$/i.test(s)) return s;
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function yamlArray(arr) {
    if (!Array.isArray(arr) || !arr.length) return '[]';
    return '[' + arr.map(yamlScalar).join(', ') + ']';
  }

  // ---- Display helpers ---------------------------------------------------

  // Turn a slug like "fine_fragrance" or "aroma-chemical" into
  // "Fine Fragrance" for the display table. Plain strings without
  // separators pass through unchanged so `"aromatic"` stays lowercase
  // (that axis uses lowercase by convention).
  function titleCaseSlug(s) {
    if (s == null) return '';
    const str = String(s);
    if (!/[_-]/.test(str)) return str;
    return str.split(/[_-]+/)
              .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : '')
              .join(' ');
  }

  // Render a list of slugs for the table cell. Empty → em dash so the
  // cell never collapses. Values keep their original casing except the
  // well-known slug pattern (which gets title cased).
  function displayList(arr, { titleCase = false } = {}) {
    if (!Array.isArray(arr) || !arr.length) return '—';
    return arr
      .map(v => String(v))
      .filter(v => v.length)
      .map(v => titleCase ? titleCaseSlug(v) : v)
      .join(', ');
  }

  // Parse the note tier(s) from a free-form string like "Middle / Base"
  // into the array ["middle", "base"]. Accepts any of top/middle/heart/
  // base (heart collapses to middle, matching tag conventions).
  function parseNoteTiers(note) {
    if (!note) return [];
    const out = [];
    for (const piece of String(note).split(/\s*\/\s*|\s*,\s*/)) {
      const t = piece.trim().toLowerCase();
      if (t === 'top' || t === 'middle' || t === 'base') {
        if (!out.includes(t)) out.push(t);
      } else if (t === 'heart') {
        if (!out.includes('middle')) out.push('middle');
      }
    }
    return out;
  }

  // Normalise any value into a safe Obsidian tag slug — lowercase,
  // spaces/underscores collapsed to `-`, non-alphanumerics stripped
  // (keeps `-` and `/` for nested tags).
  function tagSlug(v) {
    return String(v == null ? '' : v)
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, '-')
      .replace(/[^a-z0-9/-]/g, '');
  }

  // Build the nested tag list for a material. Every filter axis gets
  // its own prefix so "woody" as a sub-family (`subfamily/woody`) never
  // collides with "woody" as a facet (`facet/woody`). Obsidian renders
  // each as a clickable chip in the Properties panel and groups them
  // in the tag pane.
  function buildTags(a) {
    const tags = [];
    const push = (prefix, values) => {
      for (const v of values) {
        const s = tagSlug(v);
        if (s) tags.push(prefix + '/' + s);
      }
    };
    push('use', a.uses);
    push('function', a.functions);
    if (a.materialType) push('type', [a.materialType]);
    if (a.source) push('source', [a.source]);
    // Empty regulatory still emits a sentinel so the Properties panel
    // shows an explicit "no regulatory" chip instead of collapsing to
    // "No value" — makes it obvious the axis was considered.
    if (a.regulatory.length) push('regulatory', a.regulatory);
    else tags.push('regulatory/no-regulatory');
    push('note', a.notes);
    push('family', a.primaryFamilies);
    push('subfamily', a.secondaryFamilies);
    push('facet', a.facets);
    return tags;
  }

  // Normalise the 9 filter axes out of whatever shape the caller hands
  // us. `record.classification.*` (index.html mat.record path) and the
  // flattened `m.data.*` shape (formulation.html payload) both flow
  // through this so both pipelines render identical bullets.
  function extractAxes(src) {
    const cls = src && src.classification ? src.classification : src || {};
    const perf = src && src.perfumery ? src.perfumery : {};
    return {
      uses:              Array.isArray(cls.uses)              ? cls.uses              : (Array.isArray(src && src.uses)              ? src.uses              : []),
      functions:         Array.isArray(cls.functions)         ? cls.functions         : (Array.isArray(src && src.functions)         ? src.functions         : []),
      materialType:      cls.material_type || cls.materialType || src?.materialType || null,
      source:            cls.source || src?.source || null,
      regulatory:        Array.isArray(cls.regulatory)        ? cls.regulatory        : (Array.isArray(src && src.regulatory)        ? src.regulatory        : []),
      notes:             parseNoteTiers(perf.note || src?.note || null),
      primaryFamilies:   Array.isArray(cls.primaryFamilies)   ? cls.primaryFamilies   : (Array.isArray(src && src.primaryFamilies)   ? src.primaryFamilies   : []),
      secondaryFamilies: Array.isArray(cls.secondaryFamilies) ? cls.secondaryFamilies : (Array.isArray(src && src.secondaryFamilies) ? src.secondaryFamilies : []),
      facets:            Array.isArray(cls.facets)            ? cls.facets            : (Array.isArray(src && src.facets)            ? src.facets            : []),
    };
  }

  // ---- Material renderer -------------------------------------------------

  function materialToMarkdown(record) {
    const name = (record && record.names && record.names.canonical) || 'Untitled';
    const a = extractAxes(record);

    // Frontmatter carries every filter axis — Obsidian's Properties
    // panel renders it as a nice key/value block in Reading & Live
    // Preview, and Dataview / Bases can query these fields directly.
    // The body only needs the H1 title; any rendered table below would
    // just repeat what Properties already shows.
    //
    // `tags` mirrors the axes as nested tags (`use/...`, `family/...`)
    // so users can click through to the tag pane. Empty `regulatory`
    // emits a `no regulatory` sentinel so the Properties panel shows
    // a real chip instead of a greyed-out "No value" placeholder.
    const tags = buildTags(a);
    const lines = [
      '---',
      'name: ' + yamlScalar(name),
      'use: ' + yamlArray(a.uses.map(titleCaseSlug)),
      'function: ' + yamlArray(a.functions),
      'type: ' + (a.materialType ? yamlScalar(titleCaseSlug(a.materialType)) : '""'),
      'source: ' + (a.source ? yamlScalar(a.source) : '""'),
      'regulatory: ' + (a.regulatory.length ? yamlArray(a.regulatory) : yamlArray(['no regulatory'])),
      'note: ' + yamlArray(a.notes),
      'primary_family: ' + yamlArray(a.primaryFamilies),
      'sub_families: ' + yamlArray(a.secondaryFamilies),
      'facet: ' + yamlArray(a.facets),
      // Tag slugs are pre-normalised (lowercase, a-z0-9/-) so we skip
      // yamlScalar and emit the flow array directly — keeps the line
      // clean without quotes around every entry.
      'tags: ' + (tags.length ? '[' + tags.join(', ') + ']' : '[]'),
      '---',
      '',
      '# ' + name,
      '',
    ];

    return lines.join('\n');
  }

  // ---- Formulation renderer ---------------------------------------------

  // Render a formulation as a single .md — no ZIP, no JSZip. The caller
  // hands us a plain object so this module stays decoupled from the
  // formulation engine.
  //
  // Shape:
  //   {
  //     name: string,
  //     date: ISO date string (defaults to today),
  //     materials: [{
  //       name, note, uses, functions, materialType, source,
  //       regulatory, primaryFamilies, secondaryFamilies, facets
  //     }],
  //   }
  function formulationToMarkdown(input) {
    const f = input || {};
    const name = (f.name || 'Untitled Formulation').trim() || 'Untitled Formulation';
    const date = f.date || new Date().toISOString().slice(0, 10);
    const materials = Array.isArray(f.materials) ? f.materials : [];

    const lines = [
      '---',
      'name: ' + yamlScalar(name),
      'date: ' + yamlScalar(date),
      'materials: ' + yamlScalar(materials.length),
      '---',
      '',
      '# ' + name,
      '',
    ];

    if (!materials.length) {
      lines.push('_No materials in formulation._', '');
    }

    for (const m of materials) {
      const mName = m && m.name ? m.name : 'Untitled';
      const a = extractAxes(m);
      lines.push(
        `## [[${mName}]]`,
        '',
        `- Use: ${displayList(a.uses, { titleCase: true })}`,
        `- Function: ${displayList(a.functions)}`,
        `- Type: ${a.materialType ? titleCaseSlug(a.materialType) : '—'}`,
        `- Source: ${a.source || '—'}`,
        `- Regulatory: ${displayList(a.regulatory)}`,
        `- Note: ${displayList(a.notes)}`,
        `- Primary Family: ${displayList(a.primaryFamilies)}`,
        `- Sub-families: ${displayList(a.secondaryFamilies)}`,
        `- Facet: ${displayList(a.facets)}`,
        '',
      );
    }

    return lines.join('\n');
  }

  // ---- ZIP builder (flat layout) ----------------------------------------

  // records: array of { record: ... } (mat.record shape from index.html).
  // Returns a Blob (application/zip). Caller triggers the download.
  async function buildMaterialVaultZip(records, opts) {
    opts = opts || {};
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    if (typeof window === 'undefined' || !window.JSZip) {
      throw new Error('JSZip not loaded. Add the CDN <script> tag before obsidian_export.js.');
    }
    const zip = new window.JSZip();
    const root = zip.folder('PerfumeMaterials');

    // De-dupe by basename — Obsidian links by basename so collisions
    // break wikilinks regardless of folder (not that we have folders
    // anymore). Subsequent dupes get a " (CAS)" suffix.
    const usedNames = new Set();
    const total = records.length;
    let done = 0;

    for (const item of records) {
      const rec = item && item.record ? item.record : item;
      if (!rec) { done++; continue; }
      let base = safeFileName(rec.names && rec.names.canonical);
      if (usedNames.has(base.toLowerCase())) {
        const cas = rec.identifiers && rec.identifiers.cas;
        base = cas ? `${base} (${cas})` : `${base} (${done + 1})`;
      }
      usedNames.add(base.toLowerCase());
      root.file(base + '.md', materialToMarkdown(rec));
      done++;
      if (onProgress && (done % 25 === 0 || done === total)) {
        onProgress(Math.round((done / total) * 100));
      }
    }

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  // ---- Public API -------------------------------------------------------

  window.ObsidianExport = {
    safeFileName,
    materialToMarkdown,
    buildMaterialVaultZip,
    formulationToMarkdown,
  };
})();
