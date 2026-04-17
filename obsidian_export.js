// ===== Obsidian Knowledge Base Export =====
// Build a PARA + Johnny.Decimal + Zettelkasten Obsidian vault:
//
//   PerfumeVault/
//   ├── 1_Projects/10-19 Active Formulations/{10..13}/   ← formulations
//   ├── 2_Areas/20-29 Safety & Compliance/               ← Dataview dashboards
//   ├── 3_Resources/
//   │   ├── 40-49 Materials/{40..43}/{sub}/              ← routed by source+type
//   │   └── 60-69 MOC/{60..69}/                          ← Map-of-Content per axis
//   └── 4_Archives/                                      ← archived work
//
// Every material carries a CAS-based Zettelkasten `id`
// (e.g. `78-70-6-linalool`) in frontmatter and a JD filename
// `{CAS} {Name}.md`. Body wikilinks stay basename-only (`[[Linalool]]`)
// and resolve through the `aliases` frontmatter key, so moving files
// between sub-folders never breaks existing links.
//
// Depends on JSZip (window.JSZip, loaded via CDN).

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

  // ---- PARA + Johnny.Decimal structure ---------------------------------

  const VAULT_ROOT = 'PerfumeVault';

  const PARA = {
    projects:  '1_Projects',
    areas:     '2_Areas',
    resources: '3_Resources',
    archives:  '4_Archives',
  };

  // Johnny.Decimal routing for materials — keyed by classification.source,
  // then by material_type for the sub-bucket.
  const JD_MATERIALS_ROOT = '40-49 Materials';
  const JD_MATERIALS = {
    natural: {
      folder: '40 Naturals',
      fallback: '40.00 Uncategorized Naturals',
      sub: {
        essential_oil:   '40.01 Essential Oils',
        absolute:        '40.02 Absolutes',
        resinoid:        '40.03 Resinoids',
        co2_extract:     '40.04 CO2 Extracts',
        tincture:        '40.05 Tinctures',
        oleoresin:       '40.06 Oleoresins',
        natural_extract: '40.07 Other Extracts',
      },
    },
    synthetic: {
      folder: '41 Synthetics',
      fallback: '41.00 Uncategorized Synthetics',
      sub: {
        aroma_chemical:  '41.01 Aroma Chemicals',
        captive:         '41.02 Captives',
        isolate:         '41.03 Isolates',
        single_molecule: '41.01 Aroma Chemicals',
      },
    },
    semi_synthetic: { folder: '42 Semi-synthetics', fallback: '42.00 Semi-synthetics', sub: {} },
    biotech:        { folder: '43 Biotech',         fallback: '43.00 Biotech',         sub: {} },
    uncategorized:  { folder: '49 Uncategorized',   fallback: '49.00 Uncategorized',   sub: {} },
  };

  // Areas monitoring dashboards — Dataview queries over regulatory tags.
  const AREAS_FOLDER = '20-29 Safety & Compliance';
  const AREAS_PAGES = [
    { file: '20 IFRA Compliance.md',      tag: 'regulatory/restricted',  title: 'IFRA Compliance',       desc: 'Materials with IFRA usage-level restrictions. Review before raising concentrations.' },
    { file: '21 Allergen Monitoring.md',  tag: 'regulatory/allergen',    title: 'Allergen Monitoring',   desc: 'EU 26 declared allergens plus other flagged sensitisers. Track cumulative exposure.' },
    { file: '22 Restricted Materials.md', tag: 'regulatory/restricted',  title: 'Restricted Materials',  desc: 'Materials carrying an explicit restriction flag (IFRA, EU, regional).' },
    { file: '23 Banned Materials.md',     tag: 'regulatory/banned',      title: 'Banned Materials',      desc: 'Materials banned for fragrance use — remove from active formulations.' },
    { file: '24 Phototoxic Materials.md', tag: 'regulatory/phototoxic',  title: 'Phototoxic Materials',  desc: 'Bergapten / furocoumarin-bearing materials requiring photo-safety review.' },
  ];

  // ---- Note Group (Edwards Fragrance Wheel, top tier) ------------------

  // Seven high-level Note Groups aggregate the DB's ~24 primary family
  // values into the Edwards wheel core plus three transition zones.
  // They sit above 01 Families in the MOC hierarchy and receive
  // wikilinks from every material, so graph-view node size tiers
  // out: Note Group > Family > Sub-family > Facet > Material.
  const FAMILY_GROUPS = {
    floral: ['floral'],
    amber:  ['amber', 'floral_amber', 'gourmand', 'balsamic', 'powdery',
             'resinous', 'sweet', 'lactonic', 'spicy', 'animalic', 'musk'],
    woody:  ['woody', 'leather', 'smoky'],
    fresh:  ['citrus', 'green', 'herbal', 'aldehydic', 'aquatic', 'ozonic',
             'fresh', 'camphoraceous', 'fruity'],
  };

  const NOTE_GROUPS = ['Floral', 'Amber', 'Woody', 'Fresh',
                       'Floral Fresh', 'Woody Amber', 'Fresh Woody'];

  const NOTE_GROUP_META = {
    'Floral':       { emoji: '🌸', desc: 'Core Floral — flowers, petals, bouquet, heady blooms.' },
    'Amber':        { emoji: '🔥', desc: 'Core Amber (Oriental) — resins, balsams, gourmands, spices, musks, animalic warmth.' },
    'Woody':        { emoji: '🌲', desc: 'Core Woody — cedars, sandalwoods, smoky woods, leather.' },
    'Fresh':        { emoji: '💧', desc: 'Core Fresh — citrus, aromatic herbs, green, aquatic, aldehydic, fruity.' },
    'Floral Fresh': { emoji: '🌸💧', desc: 'Transition between Floral and Fresh — soft florals, hesperidic florals.' },
    'Woody Amber':  { emoji: '🌲🔥', desc: 'Transition between Woody and Amber — oriental woods, ambery sandalwoods.' },
    'Fresh Woody':  { emoji: '💧🌲', desc: 'Transition between Fresh and Woody — chypre, mossy & aromatic woods.' },
  };

  // Membership check against the three core-family sets; transition
  // groups require presence in two sides.
  function _inGroup(families, groupKey) {
    const set = FAMILY_GROUPS[groupKey];
    return families.some(f => set.includes(f));
  }

  // Given the material's primaryFamilies + secondaryFamilies slugs,
  // return the array of Note Group labels it belongs to. Transition
  // groups fire only when the family list spans both sides.
  function detectNoteGroups(primaryFamilies, secondaryFamilies) {
    const all = []
      .concat(Array.isArray(primaryFamilies) ? primaryFamilies : [])
      .concat(Array.isArray(secondaryFamilies) ? secondaryFamilies : [])
      .map(v => String(v).toLowerCase());
    if (!all.length) return [];
    const inFloral = _inGroup(all, 'floral');
    const inAmber  = _inGroup(all, 'amber');
    const inWoody  = _inGroup(all, 'woody');
    const inFresh  = _inGroup(all, 'fresh');
    const out = [];
    if (inFloral) out.push('Floral');
    if (inAmber)  out.push('Amber');
    if (inWoody)  out.push('Woody');
    if (inFresh)  out.push('Fresh');
    // Transition zones — require membership in both sides.
    if (inFloral && inFresh) out.push('Floral Fresh');
    if (inWoody  && inAmber) out.push('Woody Amber');
    if (inFresh  && inWoody) out.push('Fresh Woody');
    return out;
  }

  function noteGroupPath(group) {
    return `${PARA.resources}/60-69 MOC/60 Note Groups/${safeFileName(group)}`;
  }

  function noteGroupLink(group) {
    return `[[${noteGroupPath(group)}|${group}]]`;
  }

  function noteGroupLinkList(groups) {
    if (!Array.isArray(groups) || !groups.length) return '—';
    return groups.map(noteGroupLink).join(' · ');
  }

  // Render a Note Group MOC page — frontmatter + description +
  // Dataview table. `notegroup/<slug>` tag is what materials use so
  // the Dataview `FROM` line works.
  function noteGroupPage(group) {
    const meta = NOTE_GROUP_META[group] || { emoji: '', desc: '' };
    const tag  = 'notegroup/' + tagSlug(group);
    return [
      '---',
      'type: moc',
      'axis: notegroup',
      'value: ' + yamlScalar(group),
      'tags: [moc/notegroup, ' + tag + ']',
      '---',
      '',
      `# ${meta.emoji} ${group} (Note Group)`,
      '',
      meta.desc,
      '',
      '## 🧪 Materials in this Note Group',
      '',
      '```dataview',
      'TABLE WITHOUT ID',
      '  file.link AS Material,',
      '  primary_family AS Family,',
      '  note AS Note,',
      '  source AS Source',
      `FROM #${tag}`,
      'WHERE type != "moc" AND type != "formulation" AND type != "hub"',
      'SORT file.name ASC',
      '```',
      '',
      '> ถ้า Dataview plugin ยังไม่ได้ติดตั้ง — เปิด **Backlinks panel** ทางขวาจะเห็นรายการวัตถุดิบที่ลิงก์มาหน้านี้ครบเหมือนกัน',
      '',
    ].join('\n');
  }

  // ---- MOC (Map of Content) helpers ------------------------------------

  // MOC axis folders under `3_Resources/60-69 MOC/`. The numeric
  // prefixes follow the Johnny.Decimal convention: the first digit
  // ties them to the 60-69 block, the second digit orders them within
  // the block (Note Groups first, Regulatory last).
  const MOC_ROOT = '60-69 MOC';
  const JD_MOC = {
    notegroup:  '60 Note Groups',
    family:     '61 Families',
    subfamily:  '62 Sub-families',
    facet:      '63 Facets',
    note:       '64 Notes',
    type:       '65 Types',
    source:     '66 Sources',
    use:        '67 Uses',
    function:   '68 Functions',
    regulatory: '69 Regulatory',
  };

  // All nine axes get physical MOC pages. Per user feedback the
  // earlier narrow allowlist (family / sub-family / facet only) was
  // too restrictive — even note / type / source / use / function /
  // regulatory deserve their own browse pages. With this set every
  // axis value a material references resolves to a real MOC file.
  const MOC_AXES = new Set([
    'family', 'subfamily', 'facet',
    'note', 'type', 'source', 'use', 'function', 'regulatory',
  ]);

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

  // Vault-relative path to a MOC page (without .md, Obsidian-wikilink
  // friendly). Full path because basenames collide across axes
  // (e.g. "Floral" exists as both Family and Facet).
  function mocPath(axis, value) {
    return `${PARA.resources}/${MOC_ROOT}/${JD_MOC[axis]}/${mocFileName(value)}`;
  }

  // Wikilink to a MOC page with an aliased display label. If the axis
  // isn't in the MOC_AXES allowlist the link gracefully degrades to
  // plain text — the value still renders but doesn't point to a file
  // that wasn't emitted.
  function mocLink(axis, value) {
    const display = mocDisplay(value);
    if (!MOC_AXES.has(axis)) return display;
    return `[[${mocPath(axis, value)}|${display}]]`;
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
      'WHERE type != "moc" AND type != "formulation" AND type != "hub"',
      'SORT file.name ASC',
      '```',
      '',
      '> ถ้า Dataview plugin ยังไม่ได้ติดตั้ง — เปิด **Backlinks panel** ทางขวาจะเห็นรายการวัตถุดิบที่ลิงก์มาหน้านี้ครบเหมือนกัน',
      '',
    ].join('\n');
  }

  // ---- Hub / Index pages ------------------------------------------------
  // Hub pages give each PARA/JD folder a "home" note with a Dataview
  // overview. They use the same basename as the containing folder so
  // Obsidian's "folder as note" convention surfaces them automatically.

  // Per-axis hub listing every MOC value under the axis, with material
  // counts via backlinks.
  function axisHubPage(axis) {
    const meta = AXIS_META[axis] || { title: axis, emoji: '', desc: '' };
    const folder = JD_MOC[axis];
    return [
      '---',
      'type: hub',
      'para: resources',
      'jd: ' + yamlScalar(PARA.resources + '/' + MOC_ROOT + '/' + folder),
      'title: ' + yamlScalar(folder),
      'axis: ' + yamlScalar(axis),
      'tags: [hub/moc, hub/' + axis + ']',
      '---',
      '',
      `# ${meta.emoji} ${folder}`,
      '',
      meta.desc,
      '',
      '## 📇 All values',
      '',
      '```dataview',
      'TABLE WITHOUT ID',
      '  file.link AS Value,',
      '  length(file.inlinks) AS "Materials"',
      'FROM #moc/' + axis,
      'WHERE type = "moc"',
      'SORT file.name ASC',
      '```',
      '',
    ].join('\n');
  }

  // Note Group hub — shares the axisHubPage shape but keys off the
  // `moc/notegroup` tag rather than the axis slug.
  function noteGroupHubPage() {
    const folder = JD_MOC.notegroup;
    return [
      '---',
      'type: hub',
      'para: resources',
      'jd: ' + yamlScalar(PARA.resources + '/' + MOC_ROOT + '/' + folder),
      'title: ' + yamlScalar(folder),
      'tags: [hub/moc, hub/notegroup]',
      '---',
      '',
      `# 🎯 ${folder}`,
      '',
      'Edwards Fragrance Wheel — four core groups plus three transition zones.',
      '',
      '## 📇 Groups',
      '',
      '```dataview',
      'TABLE WITHOUT ID',
      '  file.link AS "Note Group",',
      '  length(file.inlinks) AS "Materials"',
      'FROM #moc/notegroup',
      'WHERE type = "moc"',
      'SORT file.name ASC',
      '```',
      '',
    ].join('\n');
  }

  // MOC root hub — lists every axis with its material count.
  function mocRootHubPage() {
    const rows = Object.keys(JD_MOC).map(axis => {
      const folder = JD_MOC[axis];
      const meta = AXIS_META[axis];
      const label = meta ? meta.title : 'Note Groups';
      return `| [[${folder}]] | ${label} |`;
    });
    return [
      '---',
      'type: hub',
      'para: resources',
      'jd: ' + yamlScalar(PARA.resources + '/' + MOC_ROOT),
      'title: ' + yamlScalar(MOC_ROOT),
      'tags: [hub/moc]',
      '---',
      '',
      '# 🗺️ ' + MOC_ROOT,
      '',
      'Map-of-Content hubs — ten classification axes plus the top-tier Note Groups.',
      '',
      '| Folder | Axis |',
      '|---|---|',
      ...rows,
      '',
    ].join('\n');
  }

  // Materials hub — source / material-type breakdown with counts.
  function materialsHubPage() {
    return [
      '---',
      'type: hub',
      'para: resources',
      'jd: ' + yamlScalar(PARA.resources + '/' + JD_MATERIALS_ROOT),
      'title: ' + yamlScalar(JD_MATERIALS_ROOT),
      'tags: [hub/materials]',
      '---',
      '',
      '# 🧪 ' + JD_MATERIALS_ROOT,
      '',
      'Full material library — routed by `source` then `material_type`.',
      '',
      '## By source',
      '',
      '```dataview',
      'TABLE WITHOUT ID source AS Source, length(rows) AS Count',
      'FROM "' + PARA.resources + '/' + JD_MATERIALS_ROOT + '"',
      'WHERE type != "hub"',
      'GROUP BY source',
      'SORT source ASC',
      '```',
      '',
      '## By material type',
      '',
      '```dataview',
      'TABLE WITHOUT ID type AS "Type", length(rows) AS Count',
      'FROM "' + PARA.resources + '/' + JD_MATERIALS_ROOT + '"',
      'WHERE type != "hub"',
      'GROUP BY type',
      'SORT type ASC',
      '```',
      '',
    ].join('\n');
  }

  // Areas hub — one-line index of every monitoring dashboard.
  function areasHubPage() {
    const lines = AREAS_PAGES.map(p => {
      const base = p.file.replace(/\.md$/, '');
      return `- [[${base}]] — ${p.desc}`;
    });
    return [
      '---',
      'type: hub',
      'para: areas',
      'jd: ' + yamlScalar(PARA.areas + '/' + AREAS_FOLDER),
      'title: ' + yamlScalar(AREAS_FOLDER),
      'tags: [hub/area]',
      '---',
      '',
      '# ⚠️ ' + AREAS_FOLDER,
      '',
      'Ongoing safety dashboards — auto-populated from material tags.',
      '',
      ...lines,
      '',
    ].join('\n');
  }

  // ---- Zettelkasten ID + PARA/JD path builders -------------------------

  // CAS-based atomic-note id — stable across exports so incremental
  // imports never create duplicates.
  function zettelId(record) {
    const r = record || {};
    const cas = r.identifiers && r.identifiers.cas ? String(r.identifiers.cas).trim() : '';
    const name = (r.names && r.names.canonical) ? String(r.names.canonical).trim() : '';
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (cas && slug) return cas + '-' + slug;
    return cas || slug || 'untitled';
  }

  // Johnny.Decimal filename "{CAS} {Name}" — CAS prefix doubles as
  // alphabetical sort key. Caller appends ".md".
  function materialFileName(record) {
    const r = record || {};
    const name = safeFileName((r.names && r.names.canonical) || 'Untitled');
    const cas = r.identifiers && r.identifiers.cas ? String(r.identifiers.cas).trim() : '';
    return cas ? `${safeFileName(cas)} ${name}` : name;
  }

  // Vault-relative folder for a material, routed by source + material_type.
  function materialFolder(record) {
    const cls = (record && record.classification) ? record.classification : {};
    const sourceKey = String(cls.source || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const typeKey   = String(cls.material_type || cls.materialType || '').toLowerCase();
    const bucket = JD_MATERIALS[sourceKey] || JD_MATERIALS.uncategorized;
    const subFolder = (typeKey && bucket.sub[typeKey]) ? bucket.sub[typeKey] : bucket.fallback;
    return `${PARA.resources}/${JD_MATERIALS_ROOT}/${bucket.folder}/${subFolder}`;
  }

  // Dataview-backed Area monitoring page for one regulatory tag.
  // Cross-links back to the matching MOC regulatory page so the graph
  // view shows Area → MOC → Material as a three-hop trail.
  function areaMonitoringPage(page) {
    const regValue = page.tag.split('/')[1] || '';
    const mocRegPath = mocPath('regulatory', regValue);
    // Callout severity matches the regulatory level.
    const calloutType = /banned/i.test(regValue)     ? 'danger'
                      : /phototoxic/i.test(regValue) ? 'bug'
                      : /allergen|sensit/i.test(regValue) ? 'warning'
                      :                                     'warning';
    return [
      '---',
      'type: area',
      'para: areas',
      'jd: ' + yamlScalar(PARA.areas + '/' + AREAS_FOLDER),
      'title: ' + yamlScalar(page.title),
      'monitors_tag: ' + yamlScalar('#' + page.tag),
      'see_also: ' + yamlScalar(mocRegPath),
      'tags: [area/safety, area/compliance]',
      '---',
      '',
      '# ' + page.title,
      '',
      `> [!${calloutType}] ${page.title}`,
      '> ' + page.desc,
      '> ',
      `> **MOC:** [[${mocRegPath}|${mocDisplay(regValue)}]]`,
      '',
      '## 🧪 Materials currently flagged',
      '',
      '```dataview',
      'TABLE WITHOUT ID',
      '  file.link AS Material,',
      '  primary_family AS Family,',
      '  note AS Note,',
      '  odor_strength AS Strength,',
      '  tenacity AS Tenacity',
      'FROM #' + page.tag,
      'WHERE type != "moc" AND type != "formulation" AND type != "area" AND type != "hub"',
      'SORT file.name ASC',
      '```',
      '',
      '> Dataview plugin ไม่พร้อม → ดู **Backlinks panel** ทางขวาแทน',
      '',
      '## 📇 All regulatory flags',
      '',
      // Embed the 69 Regulatory axis hub so the user can hop to any
      // other flag without leaving this page. Basename match resolves
      // against `3_Resources/60-69 MOC/69 Regulatory/69 Regulatory.md`.
      `![[${JD_MOC.regulatory}#📇 All values]]`,
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

  function materialToMarkdown(record) {
    const r = record || {};
    const name        = (r.names && r.names.canonical) || 'Untitled';
    const ids         = r.identifiers || {};
    // Drop self-referential synonyms — Obsidian link resolution is
    // case-insensitive so they'd be noise.
    const rawSyns     = (r.names && Array.isArray(r.names.synonyms)) ? r.names.synonyms : [];
    const nameLower   = name.toLowerCase();
    const synonyms    = rawSyns.filter(s => s && s.toLowerCase() !== nameLower);
    const perf        = r.perfumery || {};
    const safety      = r.safety || {};
    const blendsWith  = Array.isArray(perf.blends_with) ? perf.blends_with : [];
    const industryTags = (r.classification && Array.isArray(r.classification.industry_tags))
      ? r.classification.industry_tags : [];
    const a           = extractAxes(r);
    const noteGroups  = detectNoteGroups(a.primaryFamilies, a.secondaryFamilies);
    const tags        = buildTags(a).concat(noteGroups.map(g => 'notegroup/' + tagSlug(g)));

    // Aliases include the canonical name so `[[Linalool]]` still
    // resolves after the JD-prefixed filename moves between folders.
    const folder = materialFolder(r);
    const fm = ['---',
      'id: ' + yamlScalar(zettelId(r)),
      'name: ' + yamlScalar(name),
    ];
    const aliasList = [name].concat(synonyms).filter((v, i, arr) => v && arr.indexOf(v) === i);
    fm.push('aliases: ' + yamlArray(aliasList));
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
      'note_groups: '   + yamlArray(noteGroups),
      'para: resources',
      'jd: ' + yamlScalar(folder),
    );
    if (industryTags.length) fm.push('industry_tags: ' + yamlArray(industryTags));
    if (blendsWith.length) {
      fm.push('related: ' + yamlArray(blendsWith));
      fm.push('blends_count: ' + yamlScalar(blendsWith.length));
    }
    // Short odor description for quick scanning in Dataview tables —
    // trimmed to the first sentence to keep table cells compact.
    if (perf.odor_description) {
      const short = String(perf.odor_description).split(/[.!?]/)[0].trim().slice(0, 160);
      if (short) fm.push('odor_description: ' + yamlScalar(short));
    }
    if (perf.odor_type)      fm.push('odor_type: '     + yamlScalar(perf.odor_type));
    if (perf.odor_strength)  fm.push('odor_strength: ' + yamlScalar(perf.odor_strength));
    if (perf.tenacity)       fm.push('tenacity: '      + yamlScalar(perf.tenacity));
    if (perf.tenacity_hours) fm.push('duration: '      + yamlScalar(perf.tenacity_hours));
    fm.push('tags: ' + (tags.length ? '[' + tags.join(', ') + ']' : '[]'), '---', '');

    const body = ['# ' + name, ''];

    // One-glance summary callout — family · note tier · strength · duration.
    // Obsidian renders `[!abstract]` as a tinted card so the material's
    // identity is immediately scannable without reading full sections.
    const snap = [];
    if (a.primaryFamilies.length) snap.push(a.primaryFamilies.map(mocDisplay).join(' / '));
    if (a.notes.length)           snap.push(a.notes.map(mocDisplay).join(' / ') + ' note');
    if (perf.odor_strength)       snap.push(perf.odor_strength + ' strength');
    if (perf.tenacity_hours)      snap.push(perf.tenacity_hours);
    if (snap.length) {
      body.push('> [!abstract] Snapshot', '> ' + snap.join(' · '), '');
    }

    if (perf.odor_description) {
      body.push('> ' + perf.odor_description, '');
    }

    if (ids.cas || ids.fema || synonyms.length) {
      body.push('## 🔬 Identity');
      if (ids.cas)         body.push('- **CAS:** ' + ids.cas);
      if (ids.fema)        body.push('- **FEMA:** ' + ids.fema);
      if (synonyms.length) body.push('- **Aliases:** ' + synonyms.join(' · '));
      body.push('');
    }

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

    body.push('## 🎨 Classification',
      '- **Note Group:** '   + noteGroupLinkList(noteGroups),
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

    body.push('## ⚠️ Regulatory');
    if (a.regulatory.length) {
      for (const r of a.regulatory) body.push('- ' + mocLink('regulatory', r));
    } else {
      body.push('- ' + mocLink('regulatory', 'no regulatory'));
    }
    body.push('');

    // Severity-based callouts so the risk level is visually obvious
    // without reading the IFRA prose. Banned > phototoxic > allergen.
    const regLower = new Set(a.regulatory.map(r => String(r).toLowerCase()));
    if (regLower.has('banned')) {
      body.push('> [!danger] Banned',
                '> Banned for fragrance use — remove from active formulations.', '');
    }
    if (regLower.has('phototoxic')) {
      body.push('> [!bug] Phototoxic',
                '> May cause photo-reactions under UV exposure. Check photo-safety limits for the product category.', '');
    }
    if (regLower.has('allergen') || regLower.has('sensitizer')) {
      body.push('> [!warning] Sensitiser / Allergen',
                '> Declared fragrance allergen — include on product labelling if used above the disclosure threshold.', '');
    }

    // Long regulatory prose goes into foldable callouts so the note
    // stays scannable but the detail is one click away.
    if (safety.ifra_guideline) {
      const ifra = String(safety.ifra_guideline).replace(/\n/g, '\n> ');
      body.push('> [!warning]- IFRA Guideline', '> ' + ifra, '');
    }
    if (safety.usage_levels) {
      const usage = String(safety.usage_levels).replace(/\n/g, '\n> ');
      body.push('> [!info]- Usage Levels', '> ' + usage, '');
    }

    if (blendsWith.length) {
      body.push('## 🔗 Related Notes', '');
      for (const b of blendsWith) body.push(`- [[${safeFileName(b)}]]`);
      body.push('');
    }

    return fm.join('\n') + body.join('\n');
  }

  // ---- Formulation renderer ---------------------------------------------

  // Render a formulation as a single markdown file — a recipe sheet
  // with composition table, optional carrier list, parameters block,
  // analysis (IFRA compliance / note balance / longevity), and a
  // per-material detail section whose wikilinks point back into the
  // materials vault.
  //
  // Expected input shape (from formulation.html#exportObsidianMD):
  //   {
  //     name, date,
  //     category, categoryId, fragrancePct,
  //     batchSize, batchUnit, temperatureC,
  //     totalPct,
  //     materials: [{ cas, name, pct, dilution, dilutionSolvent,
  //                   note, uses, functions, materialType, source,
  //                   regulatory, primaryFamilies, secondaryFamilies,
  //                   facets }],
  //     carriers: [{ cas, name, pct }],
  //     analysis: {
  //       compliance?:  { passed, failures: [{name, max, current}], warnings: [...] },
  //       noteBalance?: { top, middle, base, unclassifiedPct, missing },
  //       longevity?:   { total, top: {end}, heart: {end}, base: {end} },
  //     },
  //   }
  // Pick the Johnny.Decimal sub-folder for a formulation based on its
  // product category. Unknown categories fall into 13 Experiments.
  function formulationJdFolder(category) {
    const c = String(category || '').toLowerCase();
    if (/fine|parfum|edp|edt|eau de|cologne/i.test(c)) return '10 Fine Fragrance';
    if (/lotion|shampoo|conditioner|body|hand|face|baby|deodorant|antiperspir|personal|skin|hair|rinse|wash|soap|bath|lip|mouth|tooth|shave|sun|anogenital/i.test(c)) return '11 Personal Care';
    if (/candle|home|room|detergent|softener|cleaner|surface|laundry|air freshener|reed/i.test(c)) return '12 Home Care';
    return '13 Experiments';
  }

  // Date-prefixed filename (no extension) so chronological sort is
  // automatic inside each JD category folder.
  function formulationFileName(name, date) {
    const d = date || new Date().toISOString().slice(0, 10);
    const safe = safeFileName((name || 'Untitled Formulation').trim() || 'Untitled Formulation');
    return `${d} ${safe}`;
  }

  function formulationToMarkdown(input) {
    const f = input || {};
    const name = (f.name || 'Untitled Formulation').trim() || 'Untitled Formulation';
    const date = f.date || new Date().toISOString().slice(0, 10);
    const materials = Array.isArray(f.materials) ? f.materials : [];
    const carriers  = Array.isArray(f.carriers)  ? f.carriers  : [];
    const analysis  = f.analysis || {};
    const totalPct  = typeof f.totalPct === 'number' ? f.totalPct : null;
    const jdFolder  = `${PARA.projects}/10-19 Active Formulations/${formulationJdFolder(f.category)}`;
    const zid = `formulation-${date}-${(name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled')}`;

    // ---- Frontmatter ----------------------------------------------------
    const fm = ['---',
      'type: formulation',
      'id: ' + yamlScalar(zid),
      'name: ' + yamlScalar(name),
      'date: ' + yamlScalar(date),
      'status: active',
      'para: projects',
      'jd: ' + yamlScalar(jdFolder),
    ];
    if (f.category)            fm.push('category: '      + yamlScalar(f.category));
    if (f.categoryId)          fm.push('category_id: '   + yamlScalar(f.categoryId));
    if (f.fragrancePct != null)fm.push('fragrance_pct: ' + yamlScalar(f.fragrancePct));
    if (f.batchSize != null)   fm.push('batch_size: '    + yamlScalar(f.batchSize));
    if (f.batchUnit)           fm.push('batch_unit: '    + yamlScalar(f.batchUnit));
    if (f.temperatureC != null)fm.push('temperature_c: ' + yamlScalar(f.temperatureC));
    fm.push(
      'materials: ' + yamlScalar(materials.length),
    );
    if (totalPct != null)      fm.push('total_pct: '     + yamlScalar(totalPct));
    fm.push('tags: [formulation, status/active]', '---', '');

    // ---- Body -----------------------------------------------------------
    const body = ['# ' + name, ''];
    if (!materials.length) {
      body.push('_No materials in formulation._', '');
      return fm.join('\n') + body.join('\n');
    }

    // Composition table — %, note, family, dilution, solvent. Each
    // material links back to its note in the materials vault.
    body.push('## 🎨 Composition', '');
    body.push('| Material | % | Note | Family | Dilution | Solvent |');
    body.push('|---|---:|---|---|---:|---|');
    for (const m of materials) {
      const mName    = m && m.name ? m.name : 'Untitled';
      const pct      = (typeof m.pct === 'number') ? m.pct.toString() : '—';
      const noteCell = m.note ? mocDisplay(m.note) : '—';
      const fam      = Array.isArray(m.primaryFamilies) && m.primaryFamilies.length ? mocDisplay(m.primaryFamilies[0]) : '—';
      const dil      = (typeof m.dilution === 'number') ? m.dilution + '%' : '—';
      const sol      = m.dilutionSolvent || '—';
      body.push(`| [[${safeFileName(mName)}]] | ${pct} | ${noteCell} | ${fam} | ${dil} | ${sol} |`);
    }
    if (totalPct != null) body.push('', `**Total:** ${totalPct}%`);
    body.push('');

    // Carriers (solvents / base) — only emit if present.
    if (carriers.length) {
      body.push('## 🧴 Carriers', '');
      body.push('| Carrier | % |');
      body.push('|---|---:|');
      for (const c of carriers) {
        const cName = c && c.name ? c.name : 'Untitled';
        const cPct  = (typeof c.pct === 'number') ? c.pct.toString() : '—';
        body.push(`| ${cName} | ${cPct} |`);
      }
      body.push('');
    }

    // Parameters — reproducibility block.
    if (f.category || f.fragrancePct != null || f.batchSize != null || f.temperatureC != null) {
      const parts = [];
      if (f.category)             parts.push(`Category: **${f.category}**`);
      if (f.fragrancePct != null) parts.push(`Fragrance: **${f.fragrancePct}%**`);
      if (f.batchSize != null)    parts.push(`Batch: **${f.batchSize}${f.batchUnit ? ' ' + f.batchUnit : ''}**`);
      if (f.temperatureC != null) parts.push(`Temperature: **${f.temperatureC}°C**`);
      body.push('## 📋 Parameters', '', '- ' + parts.join(' · '), '');
    }

    // Analysis — three independent sub-sections, each guarded by
    // presence of the corresponding analyser output.
    const hasAny = analysis.compliance || analysis.noteBalance || analysis.longevity;
    if (hasAny) {
      body.push('## 📊 Analysis', '');

      if (analysis.noteBalance) {
        const nb = analysis.noteBalance;
        body.push('### Note Balance');
        const pct = v => (typeof v === 'number') ? Math.round(v * 10) / 10 + '%' : '—';
        body.push(`- **Top:** ${pct(nb.top)} · **Middle:** ${pct(nb.middle)} · **Base:** ${pct(nb.base)}`);
        if (nb.unclassifiedPct > 0) {
          body.push(`- _Unclassified: ${pct(nb.unclassifiedPct)}_`);
        }
        if (Array.isArray(nb.missing) && nb.missing.length) {
          body.push(`- ⚠️ Missing tiers: ${nb.missing.join(', ')}`);
        }
        body.push('');
      }

      if (analysis.compliance) {
        const c = analysis.compliance;
        const catLabel = f.category ? ` (${f.category}${f.fragrancePct != null ? ' @ ' + f.fragrancePct + '%' : ''})` : '';
        body.push('### IFRA Compliance' + catLabel);
        if (c.passed) {
          body.push('✅ All materials within limits');
        } else {
          body.push('❌ Non-compliant materials:');
          for (const fail of c.failures) {
            body.push(`  - **${fail.name}** — current ${fail.current}%, max ${fail.max}%`);
          }
        }
        if (Array.isArray(c.warnings) && c.warnings.length) {
          body.push('', '⚠️ Warnings (soft usage-range overage):');
          for (const w of c.warnings) {
            body.push(`  - ${w.name} — current ${w.current}%, max ${w.max}%`);
          }
        }
        body.push('');
      }

      if (analysis.longevity) {
        const lo = analysis.longevity;
        const t = (lo.top   && typeof lo.top.end === 'number')   ? lo.top.end   : '?';
        const h = (lo.heart && typeof lo.heart.end === 'number') ? lo.heart.end : '?';
        const b = (lo.base  && typeof lo.base.end === 'number')  ? lo.base.end  : '?';
        body.push('### Estimated Longevity');
        body.push(`- **Total:** ~${lo.total} h`);
        body.push(`- Top → ${t} h · Heart → ${h} h · Base → ${b} h`);
        body.push('');
      }
    }

    // Per-material details — compact summary block for each material
    // with a wikilink to the full note in the materials vault.
    body.push('## 🧪 Materials detail', '');
    for (const m of materials) {
      const mName = m && m.name ? m.name : 'Untitled';
      const a = extractAxes(m);
      body.push(`### [[${safeFileName(mName)}]]`);
      const facts = [];
      if (a.primaryFamilies.length) facts.push('Family: ' + displayList(a.primaryFamilies.map(mocDisplay)));
      if (a.facets.length)          facts.push('Facet: '  + displayList(a.facets.map(mocDisplay)));
      if (facts.length) body.push('- ' + facts.join(' · '));
      const meta2 = [];
      if (a.notes.length)           meta2.push('Note: ' + displayList(a.notes.map(mocDisplay)));
      if (a.materialType)           meta2.push('Type: ' + mocDisplay(a.materialType));
      if (a.source)                 meta2.push('Source: ' + mocDisplay(a.source));
      if (meta2.length) body.push('- ' + meta2.join(' · '));
      if (a.regulatory.length)      body.push('- Regulatory: ' + displayList(a.regulatory.map(mocDisplay)));
      body.push('');
    }

    return fm.join('\n') + body.join('\n');
  }

  // ---- ZIP builder ------------------------------------------------------

  // Emit a PARA + Johnny.Decimal + Zettelkasten vault as a ZIP.
  //
  // records: array of { record: ... } (mat.record shape from index.html).
  // Returns a Blob (application/zip). Caller triggers the download.
  //
  // opts.parts — Set or array of vault parts to include (default: all).
  // Recognised parts: 'materials', 'notegroups', 'areas', and the nine
  // axis names ('family', 'subfamily', 'facet', 'note', 'type',
  // 'source', 'use', 'function', 'regulatory'). Material `id` fields
  // are CAS-based so incremental imports never duplicate notes.
  async function buildMaterialVaultZip(records, opts) {
    opts = opts || {};
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const parts = (opts.parts instanceof Set)
      ? opts.parts
      : (Array.isArray(opts.parts) ? new Set(opts.parts) : null);
    const wants = (name) => parts == null ? true : parts.has(name);
    if (typeof window === 'undefined' || !window.JSZip) {
      throw new Error('JSZip not loaded. Add the CDN <script> tag before obsidian_export.js.');
    }
    const zip  = new window.JSZip();
    const root = zip.folder(VAULT_ROOT);

    // Collision tracking — Obsidian resolves wikilinks by alias first,
    // then by basename, so colliding file names within one folder would
    // break unaliased links.
    const usedPaths = new Set();
    const mocsToEmit = new Map();
    const noteGroupsToEmit = new Set();

    const total = records.length;
    let done = 0;

    for (const item of records) {
      const rec = item && item.record ? item.record : item;
      if (!rec) { done++; continue; }

      const folderPath = materialFolder(rec);
      let fileBase = materialFileName(rec);
      let collisionKey = `${folderPath}/${fileBase}`.toLowerCase();
      if (usedPaths.has(collisionKey)) {
        fileBase = `${fileBase} (${done + 1})`;
        collisionKey = `${folderPath}/${fileBase}`.toLowerCase();
      }
      usedPaths.add(collisionKey);

      if (wants('materials')) {
        root.folder(folderPath).file(fileBase + '.md', materialToMarkdown(rec));
      }

      const axes = extractAxes(rec);
      forEachAxisValue(axes, (axis, value) => {
        if (!MOC_AXES.has(axis)) return;
        const key = mocPath(axis, value);
        if (!mocsToEmit.has(key)) mocsToEmit.set(key, { axis, value });
      });
      for (const g of detectNoteGroups(axes.primaryFamilies, axes.secondaryFamilies)) {
        noteGroupsToEmit.add(g);
      }

      done++;
      if (onProgress && (done % 25 === 0 || done === total)) {
        onProgress(Math.round((done / total) * 100));
      }
    }

    // Materials hub — overview of source/type breakdown at the folder root.
    if (wants('materials')) {
      root.folder(PARA.resources).folder(JD_MATERIALS_ROOT)
        .file(JD_MATERIALS_ROOT + '.md', materialsHubPage());
    }

    const mocRoot = root.folder(PARA.resources).folder(MOC_ROOT);
    // Track which axis folders ended up with content so we only emit
    // hubs for axes the user actually requested.
    const axesEmitted = new Set();
    for (const [, { axis, value }] of mocsToEmit) {
      if (!wants(axis)) continue;
      mocRoot.folder(JD_MOC[axis]).file(mocFileName(value) + '.md', mocPage(axis, value));
      axesEmitted.add(axis);
    }
    if (noteGroupsToEmit.size && wants('notegroups')) {
      const ngFolder = mocRoot.folder(JD_MOC.notegroup);
      for (const group of NOTE_GROUPS) {
        if (!noteGroupsToEmit.has(group)) continue;
        ngFolder.file(safeFileName(group) + '.md', noteGroupPage(group));
      }
      axesEmitted.add('notegroup');
    }
    // Per-axis hub pages — emit one for each axis that got at least
    // one MOC value. Name matches the folder so Obsidian's
    // "folder-as-note" convention picks it up.
    for (const axis of axesEmitted) {
      const folder = JD_MOC[axis];
      const content = axis === 'notegroup' ? noteGroupHubPage() : axisHubPage(axis);
      mocRoot.folder(folder).file(folder + '.md', content);
    }
    // MOC root hub — emit when any axis was requested.
    if (axesEmitted.size) {
      mocRoot.file(MOC_ROOT + '.md', mocRootHubPage());
    }

    if (wants('areas')) {
      const areasFolder = root.folder(PARA.areas).folder(AREAS_FOLDER);
      areasFolder.file(AREAS_FOLDER + '.md', areasHubPage());
      for (const page of AREAS_PAGES) {
        areasFolder.file(page.file, areaMonitoringPage(page));
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
    formulationFileName,
  };
})();
