// ===== Obsidian Knowledge Base Export =====
// Build a well-classified Obsidian vault from the perfumery materials
// app. Each material becomes a rich reference sheet (identity, odor
// profile, classification, regulatory status, blends_with cross-
// links). Per-axis MOC (Map of Content) pages organise the vault so
// browsing by family / facet / note / type / source / use / function
// / regulatory is a single click away.
//
// Vault layout (Phase 1 placeholders; Phase 2 fills MOC content):
//   PerfumeMaterials/
//   ├── 00 Index.md               ← root home
//   ├── {Material}.md             ← rich material notes (flat root)
//   └── _MOC/
//       ├── 01 Families/          Index.md + {Value}.md per family
//       ├── 02 Sub-families/
//       ├── 03 Facets/
//       ├── 04 Notes/             Top / Middle / Base
//       ├── 05 Types/
//       ├── 06 Sources/
//       ├── 07 Uses/
//       ├── 08 Functions/
//       └── 09 Regulatory/
//
// Wikilinks from materials always use full paths
// ([[_MOC/01 Families/Floral|Floral]]) because basenames collide
// across axes (Floral exists as both Family and Facet). Material
// synonyms go into the `aliases` frontmatter so `[[linalol]]`
// resolves to `Linalool.md`.
//
// Depends on:
//   - JSZip (window.JSZip, loaded via CDN) for the ZIP path only.

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

  // ---- MOC (Map of Content) helpers ------------------------------------

  // One subfolder per filter axis. Numeric prefixes give a predictable
  // order in Obsidian's file explorer (Families first, Regulatory last).
  const MOC_FOLDERS = {
    family:     '01 Families',
    subfamily:  '02 Sub-families',
    facet:      '03 Facets',
    note:       '04 Notes',
    type:       '05 Types',
    source:     '06 Sources',
    use:        '07 Uses',
    function:   '08 Functions',
    regulatory: '09 Regulatory',
  };

  // Display label for a filter value. Always title-cased so MOC page
  // titles read as proper headings in Obsidian — slugs like
  // "fine_fragrance" become "Fine Fragrance"; plain lowercase words
  // like "floral" or "top" become "Floral" / "Top".
  function mocDisplay(value) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return '';
    if (/[_-]/.test(s)) return titleCaseSlug(s);
    if (/\s/.test(s)) {
      return s.split(/\s+/).map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : '').join(' ');
    }
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Filename for a MOC page (no extension, no folder). Spaces are
  // preserved — Obsidian handles them in wikilinks just fine.
  function mocFileName(value) {
    return safeFileName(mocDisplay(value));
  }

  // Vault-relative path to a MOC page (with .md). Used as the wikilink
  // target. Full path because basenames collide across axes
  // (e.g. "Floral" exists as both Family and Facet).
  function mocPath(axis, value) {
    return `_MOC/${MOC_FOLDERS[axis]}/${mocFileName(value)}`;
  }

  // Wikilink to a MOC page with an aliased display label.
  function mocLink(axis, value) {
    return `[[${mocPath(axis, value)}|${mocDisplay(value)}]]`;
  }

  // Render multiple MOC links for one axis as a `·`-separated line.
  // Empty array returns the em-dash placeholder.
  function mocLinkList(axis, values) {
    if (!Array.isArray(values) || !values.length) return '—';
    return values.map(v => mocLink(axis, v)).join(' · ');
  }

  // Walk the 9 axes and call visit(axis, value) once per (axis, value)
  // pair found on the material. Used by buildMaterialVaultZip to
  // collect the unique set of MOC pages to emit.
  function forEachAxisValue(a, visit) {
    a.uses.forEach(v => visit('use', v));
    a.functions.forEach(v => visit('function', v));
    if (a.materialType) visit('type', a.materialType);
    if (a.source) visit('source', a.source);
    if (a.regulatory.length) a.regulatory.forEach(v => visit('regulatory', v));
    else visit('regulatory', 'no regulatory');
    a.notes.forEach(v => visit('note', v));
    a.primaryFamilies.forEach(v => visit('family', v));
    a.secondaryFamilies.forEach(v => visit('subfamily', v));
    a.facets.forEach(v => visit('facet', v));
  }

  // Phase 1 placeholder for a MOC page — bare frontmatter + title +
  // a one-line note. Phase 2 will fill these out with descriptions
  // and Dataview queries; for now they exist so wikilinks resolve.
  function mocPlaceholder(axis, value) {
    const title = mocDisplay(value);
    const tag   = axis + '/' + tagSlug(value);
    return [
      '---',
      'type: moc',
      'axis: ' + yamlScalar(axis),
      'value: ' + yamlScalar(title),
      'tags: [moc/' + axis + ', ' + tag + ']',
      '---',
      '',
      `# ${title}`,
      '',
      `_${axis} MOC_ — รายการวัตถุดิบใน ${axis} นี้ดูได้จาก Backlinks panel ทางขวา (Phase 2: Dataview query)`,
      '',
    ].join('\n');
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

  // Render a material as a rich reference sheet — identity block,
  // odor profile, full classification with wikilinks to the MOC
  // pages, regulatory summary, and blends_with cross-links. Sections
  // are emitted only when the underlying data is present so sparse
  // records stay readable.
  function materialToMarkdown(record) {
    const r = record || {};
    const name        = (r.names && r.names.canonical) || 'Untitled';
    const ids         = r.identifiers || {};
    const synonyms    = (r.names && Array.isArray(r.names.synonyms)) ? r.names.synonyms : [];
    const perf        = r.perfumery || {};
    const safety      = r.safety || {};
    const blendsWith  = Array.isArray(perf.blends_with) ? perf.blends_with : [];
    const a           = extractAxes(r);
    const tags        = buildTags(a);

    // ---- Frontmatter -----------------------------------------------------
    // Carries every filter axis + identity + odor + performance fields so
    // Dataview / Bases can query any dimension without parsing the body.
    // `aliases` uses Obsidian's built-in frontmatter key — typing
    // `[[linalol]]` in any note resolves to `Linalool.md`.
    const fm = ['---',
      'name: ' + yamlScalar(name),
    ];
    if (synonyms.length)       fm.push('aliases: ' + yamlArray(synonyms));
    if (ids.cas)               fm.push('cas: ' + yamlScalar(ids.cas));
    if (ids.fema)              fm.push('fema: ' + yamlScalar(ids.fema));
    fm.push(
      'type: '          + (a.materialType ? yamlScalar(titleCaseSlug(a.materialType)) : '""'),
      'source: '        + (a.source ? yamlScalar(a.source) : '""'),
      'use: '           + yamlArray(a.uses.map(titleCaseSlug)),
      'function: '      + yamlArray(a.functions),
      'note: '          + yamlArray(a.notes),
      'primary_family: '+ yamlArray(a.primaryFamilies),
      'sub_families: '  + yamlArray(a.secondaryFamilies),
      'facet: '         + yamlArray(a.facets),
      'regulatory: '    + (a.regulatory.length ? yamlArray(a.regulatory) : yamlArray(['no regulatory'])),
    );
    if (perf.odor_type)      fm.push('odor_type: '     + yamlScalar(perf.odor_type));
    if (perf.odor_strength)  fm.push('odor_strength: ' + yamlScalar(perf.odor_strength));
    if (perf.tenacity)       fm.push('tenacity: '      + yamlScalar(perf.tenacity));
    if (perf.tenacity_hours) fm.push('duration: '      + yamlScalar(perf.tenacity_hours));
    // Tag slugs are pre-normalised so emit the flow array directly.
    fm.push('tags: ' + (tags.length ? '[' + tags.join(', ') + ']' : '[]'), '---', '');

    // ---- Body ------------------------------------------------------------
    const body = ['# ' + name, ''];

    // Blockquote: the headline odor description (one-line summary).
    if (perf.odor_description) {
      body.push('> ' + perf.odor_description, '');
    }

    // Identity — only emit if we have at least one identifier beyond name.
    if (ids.cas || ids.fema || synonyms.length) {
      body.push('## 🔬 Identity');
      if (ids.cas)         body.push('- **CAS:** ' + ids.cas);
      if (ids.fema)        body.push('- **FEMA:** ' + ids.fema);
      if (synonyms.length) body.push('- **Aliases:** ' + synonyms.join(' · '));
      body.push('');
    }

    // Odor profile — type/strength/tenacity/duration as a compact block.
    if (perf.odor_type || perf.odor_strength || perf.tenacity) {
      body.push('## 🌸 Odor Profile');
      const line1 = [];
      if (perf.odor_type)     line1.push('**Type:** ' + perf.odor_type);
      if (perf.odor_strength) line1.push('**Strength:** ' + perf.odor_strength);
      if (line1.length) body.push('- ' + line1.join(' · '));
      if (perf.tenacity) {
        const tn = perf.tenacity + (perf.tenacity_hours ? ` (${perf.tenacity_hours})` : '');
        body.push('- **Tenacity:** ' + tn);
      }
      body.push('');
    }

    // Classification — one bullet per axis, wikilinks to MOC pages.
    body.push('## 🎨 Classification',
      '- **Family:** '       + mocLinkList('family',     a.primaryFamilies),
      '- **Sub-families:** ' + mocLinkList('subfamily',  a.secondaryFamilies),
      '- **Facets:** '       + mocLinkList('facet',      a.facets),
      '- **Note:** '         + mocLinkList('note',       a.notes),
      '- **Type:** '         + (a.materialType ? mocLink('type', a.materialType) : '—'),
      '- **Source:** '       + (a.source ? mocLink('source', a.source) : '—'),
      '- **Use:** '          + mocLinkList('use',        a.uses),
      '- **Function:** '     + mocLinkList('function',   a.functions),
      '',
    );

    // Regulatory — MOC links + raw IFRA text where available.
    body.push('## ⚠️ Regulatory');
    if (a.regulatory.length) {
      body.push(mocLinkList('regulatory', a.regulatory), '');
    } else {
      body.push(mocLink('regulatory', 'no regulatory'), '');
    }
    if (safety.ifra_guideline) body.push('**IFRA:** ' + safety.ifra_guideline, '');
    if (safety.usage_levels)   body.push('**Usage:** ' + safety.usage_levels, '');

    // Blends well with — wikilinks to other material notes (resolve by
    // basename). Broken links are fine — they still appear as graph
    // nodes so the connection is visible even if the target doesn't exist.
    if (blendsWith.length) {
      body.push('## 🎯 Blends Well With',
        blendsWith.map(b => `[[${safeFileName(b)}]]`).join(' · '),
        '');
    }

    return fm.join('\n') + body.join('\n');
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

  // ---- ZIP builder ------------------------------------------------------

  // Vault layout:
  //   PerfumeMaterials/
  //   ├── 00 Index.md              (Phase 1: placeholder, Phase 2: real home)
  //   ├── {Material}.md            (rich material notes, flat at root)
  //   └── _MOC/
  //       └── {NN Folder}/
  //           ├── Index.md         (axis index, placeholder in Phase 1)
  //           └── {Value}.md       (per-value MOC, placeholder in Phase 1)
  //
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
    const moc  = root.folder('_MOC');

    // De-dupe material basenames — Obsidian links by basename so a
    // collision would break wikilinks. Subsequent dupes get a " (CAS)"
    // suffix.
    const usedNames = new Set();

    // Collect unique (axis, value) pairs across all materials while we
    // iterate. Keyed by the MOC file path so the same page is never
    // emitted twice.
    const mocsToEmit = new Map();

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

      // Register every MOC page this material will link to. Shared
      // enumeration with the renderer guarantees every wikilink the
      // material body emits resolves to a page written below.
      const axes = extractAxes(rec);
      forEachAxisValue(axes, (axis, value) => {
        const key = mocPath(axis, value);
        if (!mocsToEmit.has(key)) {
          mocsToEmit.set(key, { axis, value });
        }
      });

      done++;
      if (onProgress && (done % 25 === 0 || done === total)) {
        onProgress(Math.round((done / total) * 100));
      }
    }

    // Emit per-value MOC pages under their axis folder.
    // Also track which axes are present so we can write axis Index
    // placeholders only for axes that actually have MOC pages.
    const axesPresent = new Set();
    for (const [, { axis, value }] of mocsToEmit) {
      axesPresent.add(axis);
      const folder = MOC_FOLDERS[axis];
      moc.folder(folder).file(mocFileName(value) + '.md', mocPlaceholder(axis, value));
    }

    // Axis Index placeholders — Phase 2 fills these with Dataview queries.
    for (const axis of axesPresent) {
      const folder = MOC_FOLDERS[axis];
      moc.folder(folder).file('Index.md', mocAxisIndexPlaceholder(axis));
    }

    // Root vault home — Phase 2 fills with stats + browse links.
    root.file('00 Index.md', mocRootIndexPlaceholder());

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  // Phase 1 placeholders for axis-index + vault-root pages. Phase 2
  // will replace these with Dataview-powered navigation.
  function mocAxisIndexPlaceholder(axis) {
    return [
      '---',
      'type: moc',
      'axis: ' + yamlScalar(axis),
      'tags: [moc/' + axis + ']',
      '---',
      '',
      `# ${titleCaseSlug(axis)} — Index`,
      '',
      `_Axis index_ — Phase 2 \u0e08\u0e30\u0e43\u0e2a\u0e48 Dataview query \u0e43\u0e19\u0e43\u0e19\u0e19\u0e35\u0e49 \u0e15\u0e2d\u0e19\u0e19\u0e35\u0e49 browse \u0e44\u0e14\u0e49\u0e08\u0e32\u0e01 file explorer`,
      '',
    ].join('\n');
  }

  function mocRootIndexPlaceholder() {
    return [
      '---',
      'type: moc',
      'axis: root',
      'tags: [moc/root]',
      '---',
      '',
      '# \ud83c\udf38 Perfume Materials Database',
      '',
      '\u0e10\u0e32\u0e19\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e27\u0e31\u0e15\u0e16\u0e38\u0e14\u0e34\u0e1a\u0e40\u0e04\u0e23\u0e37\u0e48\u0e2d\u0e07\u0e2b\u0e2d\u0e21 \u2014 Phase 2 \u0e08\u0e30\u0e43\u0e2a\u0e48 stats + browse menu \u0e04\u0e23\u0e1a',
      '',
      '## Browse',
      '',
      '- [[_MOC/01 Families/Index|Primary Families]]',
      '- [[_MOC/02 Sub-families/Index|Sub-families]]',
      '- [[_MOC/03 Facets/Index|Facets]]',
      '- [[_MOC/04 Notes/Index|Notes]]',
      '- [[_MOC/05 Types/Index|Types]]',
      '- [[_MOC/06 Sources/Index|Sources]]',
      '- [[_MOC/07 Uses/Index|Uses]]',
      '- [[_MOC/08 Functions/Index|Functions]]',
      '- [[_MOC/09 Regulatory/Index|Regulatory]]',
      '',
    ].join('\n');
  }

  // ---- Public API -------------------------------------------------------

  window.ObsidianExport = {
    safeFileName,
    materialToMarkdown,
    buildMaterialVaultZip,
    formulationToMarkdown,
  };
})();
