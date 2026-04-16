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

  // Human-readable metadata for each axis — feeds axis Index titles,
  // per-value MOC subtitles, and the root navigation menu.
  // `title` is the plural label (used in Index pages and the browse
  // menu); `singular` is the per-value subtitle ("Floral (Primary
  // Family)").
  const AXIS_META = {
    family:     { title: 'Primary Families',   singular: 'Primary Family',   emoji: '👃', desc: 'Primary olfactory family — the dominant scent family a material belongs to.' },
    subfamily:  { title: 'Sub-families',       singular: 'Sub-family',       emoji: '🌿', desc: 'Secondary olfactory families — supporting scent families a material exhibits alongside its primary.' },
    facet:      { title: 'Facets',             singular: 'Facet',            emoji: '🎨', desc: 'Fine-grained odor descriptors — the specific notes and nuances reviewers pick out.' },
    note:       { title: 'Note tiers',         singular: 'Note',             emoji: '🎵', desc: 'Evaporation tier on the fragrance pyramid (Top / Middle / Base).' },
    type:       { title: 'Material types',     singular: 'Material Type',    emoji: '🧪', desc: 'Chemical or botanical classification (aroma chemical, essential oil, absolute, etc.).' },
    source:     { title: 'Sources',            singular: 'Source',           emoji: '🌱', desc: 'How the material is produced — natural, synthetic, semi-synthetic, biotech.' },
    use:        { title: 'Use cases',          singular: 'Use case',         emoji: '💼', desc: 'Intended downstream use (fine fragrance, personal care, home care, flavor).' },
    function:   { title: 'Functions',          singular: 'Function',         emoji: '⚙️', desc: 'Functional role in a composition (aromatic, fixative, solvent, enhancer, etc.).' },
    regulatory: { title: 'Regulatory status',  singular: 'Regulatory flag',  emoji: '⚠️', desc: 'Regulatory flags — allergen, sensitizer, restricted, banned, phototoxic.' },
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

  // Render a per-value MOC page — title, one-line description, a
  // Dataview TABLE that auto-lists every material tagged with
  // `{axis}/{value}`, and a "See also" block linking back to the
  // axis index and vault home. If the user doesn't have the Dataview
  // plugin installed, Obsidian's built-in Backlinks panel still
  // lists the inbound links from every material — so the page is
  // useful either way.
  function mocPage(axis, value) {
    const meta  = AXIS_META[axis] || { title: axis, singular: axis, emoji: '', desc: '' };
    const title = mocDisplay(value);
    const tag   = axis + '/' + tagSlug(value);
    const folder = MOC_FOLDERS[axis];
    return [
      '---',
      'type: moc',
      'axis: ' + yamlScalar(axis),
      'value: ' + yamlScalar(title),
      'tags: [moc/' + axis + ', ' + tag + ']',
      '---',
      '',
      `# ${title} (${meta.singular})`,
      '',
      meta.desc,
      '',
      '## 🧪 Materials in this filter',
      '',
      '```dataview',
      'TABLE WITHOUT ID',
      '  file.link AS Material,',
      '  odor_type AS "Odor",',
      '  note AS Note,',
      '  tenacity AS Tenacity,',
      '  source AS Source',
      `FROM #${tag}`,
      'WHERE type != "moc" AND type != "formulation"',
      'SORT file.name ASC',
      '```',
      '',
      '> ถ้า Dataview plugin ยังไม่ได้ติดตั้ง — เปิด **Backlinks panel** ทางขวาจะเห็นรายการวัตถุดิบที่ลิงก์มาหน้านี้ครบเหมือนกัน',
      '',
      '## See also',
      `- [[00 Index|🏠 Vault home]]`,
      `- [[_MOC/${folder}/Index|${meta.emoji} All ${meta.title.toLowerCase()}]]`,
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
    // Filter self-referential synonyms (DB often lists the lowercase
    // canonical name in synonyms too — Obsidian link resolution is
    // case-insensitive so that entry is noise).
    const rawSyns     = (r.names && Array.isArray(r.names.synonyms)) ? r.names.synonyms : [];
    const nameLower   = name.toLowerCase();
    const synonyms    = rawSyns.filter(s => s && s.toLowerCase() !== nameLower);
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

    // Emit per-value MOC pages under their axis folder. Track the set
    // of values per axis so the axis Index page can render the full
    // list as a fallback (for users without Dataview).
    const valuesByAxis = {};
    for (const [, { axis, value }] of mocsToEmit) {
      (valuesByAxis[axis] = valuesByAxis[axis] || []).push(value);
      const folder = MOC_FOLDERS[axis];
      moc.folder(folder).file(mocFileName(value) + '.md', mocPage(axis, value));
    }

    // Axis Index pages — one per axis that has any values.
    for (const axis of Object.keys(valuesByAxis)) {
      const folder = MOC_FOLDERS[axis];
      moc.folder(folder).file('Index.md', mocAxisIndex(axis, valuesByAxis[axis]));
    }

    // Root vault home — stats + browse menu + quick Dataview queries.
    root.file('00 Index.md', mocRootIndex({
      materialCount: usedNames.size,
      generatedAt:   new Date().toISOString().slice(0, 10),
      axesPresent:   Object.keys(valuesByAxis),
    }));

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  // Render the axis-level index page — the "table of contents" for a
  // single axis folder. Dataview LIST auto-populates as MOC pages are
  // added/removed. The manual `### Known values` block is a fallback
  // that shows when Dataview isn't installed (Obsidian renders the
  // wikilinks directly).
  function mocAxisIndex(axis, values) {
    const meta = AXIS_META[axis] || { title: axis, emoji: '', desc: '' };
    const folder = MOC_FOLDERS[axis];
    const sortedValues = [...values].sort((a, b) =>
      mocDisplay(a).localeCompare(mocDisplay(b), undefined, { sensitivity: 'base' }));
    return [
      '---',
      'type: moc',
      'axis: ' + yamlScalar(axis),
      'tags: [moc/' + axis + ', moc/axis-index]',
      '---',
      '',
      `# ${meta.emoji} ${meta.title}`,
      '',
      meta.desc,
      '',
      `## ค่า ${axis} ที่มีใน vault (${values.length})`,
      '',
      '```dataview',
      'LIST',
      `FROM #moc/${axis}`,
      'WHERE !contains(tags, "moc/axis-index")',
      'SORT file.name ASC',
      '```',
      '',
      '### Known values (fallback when Dataview is off)',
      '',
      ...sortedValues.map(v => `- [[_MOC/${folder}/${mocFileName(v)}|${mocDisplay(v)}]]`),
      '',
      '## See also',
      '- [[00 Index|🏠 Vault home]]',
      '',
    ].join('\n');
  }

  // Render the vault root home page — shows total material count,
  // the full axis browse menu, and a handful of Dataview quick
  // queries that showcase what the KB can do.
  //
  // Stats come from the build step so the count is baked in even
  // when Dataview isn't installed.
  function mocRootIndex(stats) {
    const total = (stats && typeof stats.materialCount === 'number') ? stats.materialCount : 0;
    const generatedAt = (stats && stats.generatedAt) || new Date().toISOString().slice(0, 10);
    // Only list axes that actually have a MOC Index page in this build
    // — otherwise the link would resolve to nothing. For full DB
    // exports every axis is populated; smoke tests / partial builds
    // may have fewer.
    const present = (stats && Array.isArray(stats.axesPresent)) ? stats.axesPresent : Object.keys(AXIS_META);
    const browseLines = Object.keys(AXIS_META)
      .filter(axis => present.includes(axis))
      .map(axis => {
        const meta = AXIS_META[axis];
        return `- [[_MOC/${MOC_FOLDERS[axis]}/Index|${meta.emoji} ${meta.title}]] — ${meta.desc}`;
      });
    return [
      '---',
      'type: moc',
      'axis: root',
      'tags: [moc/root]',
      '---',
      '',
      '# 🌸 Perfume Materials Database',
      '',
      `ฐานข้อมูลวัตถุดิบเครื่องหอม — **${total} วัตถุดิบ** จำแนกตาม ${Object.keys(AXIS_META).length} มิติ`,
      '',
      `_Generated ${generatedAt} · powered by [Obsidian](https://obsidian.md) + [Dataview](https://blacksmithgu.github.io/obsidian-dataview/) (optional but recommended)_`,
      '',
      '## 📚 Browse by category',
      '',
      ...browseLines,
      '',
      '## 🔎 Quick queries',
      '',
      '### Top notes (all)',
      '```dataview',
      'LIST',
      'FROM #note/top AND !#moc/axis-index',
      'WHERE type != "moc" AND type != "formulation"',
      'SORT file.name ASC',
      '```',
      '',
      '### EU-26 allergens',
      '```dataview',
      'TABLE WITHOUT ID file.link AS Material, primary_family AS Family',
      'FROM #regulatory/allergen',
      'WHERE type != "moc"',
      'SORT file.name ASC',
      '```',
      '',
      '### Essential oils & absolutes',
      '```dataview',
      'LIST',
      'FROM #type/essential-oil OR #type/absolute',
      'WHERE type != "moc"',
      'SORT file.name ASC',
      '```',
      '',
      '## 📊 Stats',
      '',
      '```dataview',
      'TABLE WITHOUT ID',
      '  length(rows) AS "Materials"',
      'FROM "" WHERE type != "moc" AND type != "formulation"',
      'GROUP BY true',
      '```',
      '',
      '---',
      '',
      '> 💡 **Tip**: เปิด Graph View (⚙️ → Core plugins) เพื่อดูความเชื่อมโยงระหว่างวัตถุดิบผ่าน MOC hubs — แต่ละ family / facet / note จะกลายเป็น cluster กลางของ graph',
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
