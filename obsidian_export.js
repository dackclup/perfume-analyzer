// ===== Obsidian Vault Export =====
// Phase 1: minimal ZIP export of search results as flat .md files.
// Phase 2: hierarchical folders by primary family + _Index pages + README.
//   - Materials/{Family}/{name}.md (Title Case folder, _Unclassified fallback)
//   - _Index/All Materials.md, By Family.md, By Note.md, IFRA Restricted.md, Banned.md
//   - README.md (TH+EN extract/install instructions)
// Phase 4: formulationToMarkdown — single-file .md export for the
//   Formulation Lab (no ZIP, no JSZip dependency).
//
// Depends on:
//   - JSZip (window.JSZip, loaded via CDN before this script) for the
//     buildMaterialVaultZip path only. formulationToMarkdown is pure.
//   - DB / NAME_TO_CAS globals from perfumery_data.js (always present in
//     both index.html and formulation.html)

(function () {
  'use strict';

  // ---- Filename / link helpers --------------------------------------------

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

  // Resolve a blends_with name to the canonical DB name when possible so
  // wikilinks land on the same target Obsidian creates for the material
  // file. Falls back to the original (title-cased) string for unresolved
  // entries — Obsidian shows them as "unresolved" links, which is fine.
  function resolveBlendName(name) {
    if (typeof window === 'undefined') return name;
    const DB = window.DB; const NAME_TO_CAS = window.NAME_TO_CAS;
    if (!DB || !NAME_TO_CAS) return name;
    const cas = NAME_TO_CAS[String(name).toLowerCase()];
    if (cas && DB[cas] && DB[cas].name) return DB[cas].name;
    return name;
  }

  // ---- YAML emitter -------------------------------------------------------

  // Conservative YAML quoting: numbers and clean alphanumerics pass
  // through; anything with reserved chars (:, #, [, ], etc.) is double-
  // quoted with internal `"` escaped. Empty / null returns empty so the
  // caller can omit the field entirely.
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

  // ---- Markdown section helpers ------------------------------------------

  // Emit "- **Label**: value" only when value is truthy. Returns '' so the
  // caller can join freely without filtering.
  function bullet(label, value) {
    if (value == null || value === '') return '';
    return `- **${label}**: ${value}\n`;
  }

  // ---- Main material renderer --------------------------------------------

  function materialToMarkdown(record) {
    if (!record) return '';
    const ids   = record.identifiers || {};
    const names = record.names || {};
    const props = record.properties || {};
    const perf  = record.perfumery || {};
    const safe  = record.safety || {};
    const cls   = record.classification || {};
    const meta  = record.metadata || {};

    const canonical = names.canonical || ids.cas || 'Untitled';
    const synonyms  = Array.isArray(names.synonyms) ? names.synonyms.filter(Boolean) : [];

    // ----- Frontmatter -----
    const fm = ['---'];
    if (synonyms.length) fm.push('aliases: ' + yamlArray(synonyms));
    if (ids.cas)  fm.push('cas: ' + yamlScalar(ids.cas));
    if (ids.fema) fm.push('fema: ' + yamlScalar(ids.fema));
    if (ids.pubchem_cid != null) fm.push('pubchem_cid: ' + yamlScalar(ids.pubchem_cid));
    if (ids.molecular_formula) fm.push('molecular_formula: ' + yamlScalar(ids.molecular_formula));
    if (props.molecular_weight != null) fm.push('molecular_weight: ' + yamlScalar(props.molecular_weight));
    if (perf.note)         fm.push('note: ' + yamlScalar(perf.note));
    if (perf.odor_type)    fm.push('odor_type: ' + yamlScalar(perf.odor_type));
    if (perf.odor_strength) fm.push('odor_strength: ' + yamlScalar(perf.odor_strength));
    if (perf.tenacity)     fm.push('tenacity: ' + yamlScalar(perf.tenacity));
    if (perf.tenacity_hours) fm.push('tenacity_hours: ' + yamlScalar(perf.tenacity_hours));

    const primaries   = Array.isArray(cls.primaryFamilies)   ? cls.primaryFamilies   : [];
    const secondaries = Array.isArray(cls.secondaryFamilies) ? cls.secondaryFamilies : [];
    const facets      = Array.isArray(cls.facets)            ? cls.facets            : [];
    const odorFams    = Array.isArray(cls.odor_families)     ? cls.odor_families     : [];
    const functions   = Array.isArray(cls.functions)         ? cls.functions         : [];
    const uses        = Array.isArray(cls.uses)              ? cls.uses              : (Array.isArray(cls.industry_tags) ? cls.industry_tags : []);
    const regulatory  = Array.isArray(cls.regulatory)        ? cls.regulatory        : [];

    if (primaries.length)   fm.push('primary_families: ' + yamlArray(primaries));
    if (secondaries.length) fm.push('secondary_families: ' + yamlArray(secondaries));
    if (facets.length)      fm.push('facets: ' + yamlArray(facets));
    if (odorFams.length)    fm.push('odor_families: ' + yamlArray(odorFams));
    if (functions.length)   fm.push('functions: ' + yamlArray(functions));
    if (uses.length)        fm.push('uses: ' + yamlArray(uses));
    if (cls.material_type)  fm.push('material_type: ' + yamlScalar(cls.material_type));
    if (regulatory.length)  fm.push('regulatory: ' + yamlArray(regulatory));

    // Ban status — mirror the CSV-export logic at index.html:4226-4227 so
    // both exports report the same buckets (banned/restricted/none).
    const banStatus = regulatory.some(r => /banned/i.test(r))
      ? 'banned'
      : regulatory.some(r => /restricted/i.test(r))
        ? 'restricted'
        : 'norestriction';
    fm.push('ban_status: ' + banStatus);

    if (meta.source) fm.push('source: ' + yamlScalar(meta.source));

    // Tags — nested syntax so Obsidian's tag pane shows the family tree.
    const tags = ['fragrance/material'];
    for (const f of primaries)   tags.push('fragrance/family/' + slugTag(f));
    for (const f of secondaries) tags.push('fragrance/family/' + slugTag(f));
    // perf.note may be "Top", "Middle / Base", etc. — split on '/'.
    if (perf.note) {
      for (const tier of String(perf.note).split('/')) {
        const t = tier.trim().toLowerCase();
        if (t === 'top' || t === 'middle' || t === 'base' || t === 'heart')
          tags.push('fragrance/note/' + (t === 'heart' ? 'middle' : t));
      }
    }
    fm.push('tags:');
    for (const t of dedupe(tags)) fm.push('  - ' + t);

    fm.push('---', '');

    // ----- Body -----
    const body = [];
    body.push('# ' + canonical, '');

    if (perf.odor_description) {
      body.push('> *' + perf.odor_description.replace(/\n/g, ' ') + '*', '');
    }

    // Identifiers section
    const idLines = [];
    idLines.push(bullet('CAS', ids.cas));
    idLines.push(bullet('FEMA', ids.fema));
    if (ids.pubchem_cid != null) {
      idLines.push(`- **PubChem CID**: [${ids.pubchem_cid}](https://pubchem.ncbi.nlm.nih.gov/compound/${ids.pubchem_cid})\n`);
    }
    idLines.push(bullet('IUPAC', ids.iupac));
    idLines.push(bullet('Molecular formula', ids.molecular_formula));
    if (ids.canonical_smiles) idLines.push(`- **SMILES**: \`${ids.canonical_smiles}\`\n`);
    if (ids.inchi)            idLines.push(`- **InChI**: \`${ids.inchi}\`\n`);
    if (synonyms.length)      idLines.push(`- **Synonyms**: ${synonyms.join(', ')}\n`);
    const idBlock = idLines.join('');
    if (idBlock) body.push('## Identifiers', '', idBlock);

    // Physical properties — only when at least one PubChem field is set.
    const propRows = [];
    if (props.molecular_weight != null) propRows.push(['Molecular weight', props.molecular_weight + ' g/mol']);
    if (props.exact_mass != null)       propRows.push(['Exact mass', props.exact_mass]);
    if (props.xlogp != null)            propRows.push(['XLogP', props.xlogp]);
    if (props.tpsa != null)             propRows.push(['TPSA', props.tpsa + ' Å²']);
    if (props.hbond_donor != null)      propRows.push(['H-bond donors', props.hbond_donor]);
    if (props.hbond_acceptor != null)   propRows.push(['H-bond acceptors', props.hbond_acceptor]);
    if (props.rotatable_bonds != null)  propRows.push(['Rotatable bonds', props.rotatable_bonds]);
    if (props.heavy_atoms != null)      propRows.push(['Heavy atoms', props.heavy_atoms]);
    if (propRows.length) {
      body.push('## Physical properties', '');
      body.push('| Property | Value |');
      body.push('|---|---|');
      for (const [k, v] of propRows) body.push(`| ${k} | ${v} |`);
      body.push('');
    }

    // Perfumery
    const perfLines = [];
    perfLines.push(bullet('Odor type', perf.odor_type));
    perfLines.push(bullet('Odor strength', perf.odor_strength));
    perfLines.push(bullet('Note', perf.note));
    if (perf.tenacity || perf.tenacity_hours) {
      const tenStr = [perf.tenacity, perf.tenacity_hours ? `(${perf.tenacity_hours})` : '']
        .filter(Boolean).join(' ');
      perfLines.push(bullet('Tenacity', tenStr));
    }
    perfLines.push(bullet('Usage levels', safe.usage_levels));

    const blends = Array.isArray(perf.blends_with) ? perf.blends_with.filter(Boolean) : [];
    if (blends.length) {
      const links = blends.map(n => `[[${resolveBlendName(n)}]]`).join(', ');
      perfLines.push(`- **Blends well with**: ${links}\n`);
    }
    const perfBlock = perfLines.join('');
    if (perfBlock) body.push('## Perfumery', '', perfBlock);

    // Safety & regulation
    const safeLines = [];
    safeLines.push(bullet('IFRA guideline', safe.ifra_guideline));
    if (Array.isArray(safe.ghs_codes) && safe.ghs_codes.length) {
      safeLines.push(`- **GHS codes**: ${safe.ghs_codes.join(', ')}\n`);
    }
    safeLines.push(bullet('Ban status',
      banStatus === 'norestriction' ? 'No restriction' :
      banStatus === 'restricted'    ? 'Restricted'     :
      banStatus === 'banned'        ? 'Banned'         : null));
    const safeBlock = safeLines.join('');
    if (safeBlock) body.push('## Safety & regulation', '', safeBlock);

    // Classification
    const clsLines = [];
    if (primaries.length || secondaries.length) {
      const tagLine = [...primaries, ...secondaries]
        .map(f => '#fragrance/family/' + slugTag(f)).join(' ');
      clsLines.push(`- **Family**: ${tagLine}\n`);
    }
    if (facets.length)    clsLines.push(`- **Facets**: ${facets.join(', ')}\n`);
    if (functions.length) clsLines.push(`- **Function**: ${functions.join(', ')}\n`);
    if (uses.length)      clsLines.push(`- **Uses**: ${uses.join(', ')}\n`);
    clsLines.push(bullet('Material type', cls.material_type));
    const clsBlock = clsLines.join('');
    if (clsBlock) body.push('## Classification', '', clsBlock);

    body.push('---');
    body.push(`*Source: \`perfumery_data.js\`${meta.source ? ` (${meta.source})` : ''}*`);

    return fm.join('\n') + body.join('\n') + '\n';
  }

  // Lowercase + replace non-alphanumerics with '-' so tag fragments are
  // valid Obsidian tags (no spaces, slashes only as nesting separator).
  function slugTag(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function dedupe(arr) {
    const seen = new Set(); const out = [];
    for (const x of arr) { if (!seen.has(x)) { seen.add(x); out.push(x); } }
    return out;
  }

  // ---- Folder placement (Phase 2) ----------------------------------------

  // Compute the "Materials/{Family}/" folder for a record. primaryFamilies
  // values are lowercase canonical slugs (e.g. "floral") — we Title Case
  // them so the folder name reads naturally in Obsidian's file tree.
  // Records lacking primary families (~5% of the local DB — vehicles,
  // additives) drop into "_Unclassified" so they remain reachable.
  function primaryFamilyFolder(record) {
    const cls = (record && record.classification) || {};
    const fams = Array.isArray(cls.primaryFamilies) ? cls.primaryFamilies : [];
    const head = fams.length ? String(fams[0]).trim() : '';
    if (!head) return '_Unclassified';
    return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
  }

  // ---- Index page generators (Phase 2) -----------------------------------

  // Each index lives at PerfumeMaterials/_Index/*.md and references the
  // material notes by basename. Obsidian resolves [[Name]] across folders
  // by basename, so links keep working when materials are nested under
  // Materials/{Family}/.
  function _byCanonicalName(a, b) {
    return (a.canonical || '').localeCompare(b.canonical || '', undefined, { sensitivity: 'base' });
  }

  // Pre-compute a flat list of {canonical, cas, family, note, banStatus}
  // shared by every index generator so we walk the records once.
  function _summarize(records) {
    const out = [];
    for (const item of records) {
      const rec = item && item.record ? item.record : item;
      if (!rec) continue;
      const cls = rec.classification || {};
      const reg = Array.isArray(cls.regulatory) ? cls.regulatory : [];
      const banStatus = reg.some(r => /banned/i.test(r))
        ? 'banned'
        : reg.some(r => /restricted/i.test(r))
          ? 'restricted'
          : 'norestriction';
      out.push({
        canonical: (rec.names && rec.names.canonical) || (rec.identifiers && rec.identifiers.cas) || 'Untitled',
        cas: rec.identifiers && rec.identifiers.cas,
        family: primaryFamilyFolder(rec),
        note: (rec.perfumery && rec.perfumery.note) || null,
        banStatus,
      });
    }
    return out;
  }

  function indexAllMaterials(summary) {
    const sorted = [...summary].sort(_byCanonicalName);
    const lines = ['# All Materials', '', `*${sorted.length} entries, sorted A–Z*`, ''];
    for (const s of sorted) lines.push(`- [[${s.canonical}]]${s.cas ? ` — \`${s.cas}\`` : ''}`);
    return lines.join('\n') + '\n';
  }

  function indexByFamily(summary) {
    const groups = new Map();
    for (const s of summary) {
      if (!groups.has(s.family)) groups.set(s.family, []);
      groups.get(s.family).push(s);
    }
    const families = [...groups.keys()].sort((a, b) => {
      // _Unclassified always last
      if (a === '_Unclassified') return 1;
      if (b === '_Unclassified') return -1;
      return a.localeCompare(b);
    });
    const lines = ['# By Family', '', `*${summary.length} materials across ${families.length} families*`, ''];
    for (const fam of families) {
      const items = groups.get(fam).sort(_byCanonicalName);
      lines.push(`## ${fam} (${items.length})`, '');
      for (const s of items) lines.push(`- [[${s.canonical}]]`);
      lines.push('');
    }
    return lines.join('\n');
  }

  function indexByNote(summary) {
    const buckets = { Top: [], Middle: [], Base: [], Other: [] };
    for (const s of summary) {
      const n = (s.note || '').toLowerCase();
      // A material can sit in more than one tier (e.g. "Middle / Base").
      let placed = false;
      if (n.includes('top'))    { buckets.Top.push(s);    placed = true; }
      if (n.includes('middle') || n.includes('heart')) { buckets.Middle.push(s); placed = true; }
      if (n.includes('base'))   { buckets.Base.push(s);   placed = true; }
      if (!placed) buckets.Other.push(s);
    }
    const lines = ['# By Note', '', '*Materials grouped by their tier in the fragrance pyramid. Some materials appear in multiple tiers.*', ''];
    for (const tier of ['Top', 'Middle', 'Base', 'Other']) {
      const items = buckets[tier].sort(_byCanonicalName);
      if (!items.length) continue;
      lines.push(`## ${tier} (${items.length})`, '');
      for (const s of items) lines.push(`- [[${s.canonical}]]`);
      lines.push('');
    }
    return lines.join('\n');
  }

  function indexFiltered(summary, predicate, title, subtitle) {
    const items = summary.filter(predicate).sort(_byCanonicalName);
    const lines = [`# ${title}`, '', subtitle ? `*${subtitle}*` : '', `*${items.length} entries*`, ''];
    if (!items.length) lines.push('_None in current export._', '');
    for (const s of items) lines.push(`- [[${s.canonical}]]${s.cas ? ` — \`${s.cas}\`` : ''}`);
    return lines.join('\n') + '\n';
  }

  function readmeMarkdown(records) {
    const today = new Date().toISOString().slice(0, 10);
    return `# Perfume Materials — Obsidian Vault

*Generated ${today} — ${records.length} materials*

## วิธีใช้ (TH)

1. แตกไฟล์ ZIP นี้ลงในตำแหน่งที่ต้องการ — เช่น \`Documents/PerfumeMaterials/\` บน Android (ใช้ ZArchiver, RAR, หรือ Files แตกได้)
2. เปิด **Obsidian** → กด **Open folder as vault** → เลือกโฟลเดอร์ \`PerfumeMaterials\` ที่เพิ่งแตกออกมา
3. Obsidian จะ index ไฟล์ทั้งหมด — ใช้เวลาไม่กี่วินาที
4. เปิด \`_Index/All Materials.md\` หรือ \`_Index/By Family.md\` เพื่อ browse

## How to use (EN)

1. Extract this ZIP to a location of your choice — e.g. \`Documents/PerfumeMaterials/\` on Android (any unzip app works).
2. Open **Obsidian** → tap **Open folder as vault** → select the freshly-extracted \`PerfumeMaterials\` folder.
3. Obsidian will index everything in seconds.
4. Start at \`_Index/All Materials.md\` or \`_Index/By Family.md\` to browse.

## Vault layout

\`\`\`
PerfumeMaterials/
├── README.md                    ← this file
├── _Index/                      ← navigation pages (Dataview-style lists)
│   ├── All Materials.md
│   ├── By Family.md
│   ├── By Note.md
│   ├── IFRA Restricted.md
│   └── Banned.md
└── Materials/                   ← one .md per material, grouped by primary family
    ├── Floral/
    ├── Woody/
    ├── Citrus/
    ├── Amber/
    ├── Fresh/
    └── _Unclassified/           ← vehicles, additives, etc.
\`\`\`

## Tags & wikilinks

- **Tags** use nested syntax — open Obsidian's tag pane to browse \`#fragrance/family/floral\`, \`#fragrance/note/middle\`, etc.
- **Wikilinks** in \`Blends well with\` (e.g. \`[[Hedione]]\`) connect material notes for Graph view.

## Source

Generated by **Perfume Analyzer** — see \`perfumery_data.js\` for the underlying database. Re-export to refresh.
`;
  }

  // ---- ZIP builder (Phase 2: hierarchical + index + README) --------------

  // records: array of { record: ... } (the same shape that downloadJSON
  // operates on — `mat.record` holds the canonical data).
  // Returns a Blob (application/zip). Caller triggers the download.
  async function buildMaterialVaultZip(records, opts) {
    opts = opts || {};
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    if (typeof window === 'undefined' || !window.JSZip) {
      throw new Error('JSZip not loaded. Add the CDN <script> tag before obsidian_export.js.');
    }
    const zip = new window.JSZip();
    const root = zip.folder('PerfumeMaterials');
    const matFolder = root.folder('Materials');

    // De-dupe by canonical name across the entire vault (Obsidian links
    // by basename, so duplicates collide regardless of folder). Dupes get
    // a " (CAS)" suffix to stay addressable.
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
      const family = primaryFamilyFolder(rec);
      matFolder.folder(family).file(base + '.md', materialToMarkdown(rec));
      done++;
      if (onProgress && (done % 25 === 0 || done === total)) {
        onProgress(Math.round((done / total) * 100));
      }
    }

    // Index pages + README share a single summary pass over records.
    const summary = _summarize(records);
    const indexFolder = root.folder('_Index');
    indexFolder.file('All Materials.md', indexAllMaterials(summary));
    indexFolder.file('By Family.md', indexByFamily(summary));
    indexFolder.file('By Note.md', indexByNote(summary));
    indexFolder.file('IFRA Restricted.md', indexFiltered(
      summary, s => s.banStatus === 'restricted',
      'IFRA Restricted',
      'Materials with IFRA Standard 51 usage limits or other regulatory restrictions.'
    ));
    indexFolder.file('Banned.md', indexFiltered(
      summary, s => s.banStatus === 'banned',
      'Banned',
      'Materials banned by IFRA or restricted markets — kept for reference only.'
    ));
    root.file('README.md', readmeMarkdown(records));

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  // ---- Formulation single-file renderer (Phase 4) ------------------------

  // Render a formulation as a single .md document — no ZIP, no JSZip.
  // The caller (formulation.html) hands us a plain object so this module
  // stays decoupled from the formulation engine. All analysis fields are
  // optional; missing sections are omitted, not rendered as "n/a".
  //
  // Shape:
  //   {
  //     name:            string,
  //     date:            ISO date string (defaults to today),
  //     fragrancePct:    number,           // % concentrate in finished product
  //     batchSize:       number,
  //     batchUnit:       'g' | 'ml',
  //     productCategory: string,           // human-readable IFRA category name
  //     temperatureC:    number,           // for evaporation analysis context
  //     totalPct:        number,           // composition total (target 100)
  //     materials: [{ cas, name, pct, dilution, dilutionSolvent, note?, odorType? }],
  //     carriers:  [{ cas?, name, pct }],
  //     analysis: {                         // every key optional
  //       compliance: { passed: boolean, failures: [{ name, max, current }] },
  //       noteBalance: { top: number, middle: number, base: number },
  //       longevity:   string,             // human summary
  //     },
  //   }
  function formulationToMarkdown(input) {
    const f = input || {};
    const name = (f.name || 'Untitled Formulation').trim() || 'Untitled Formulation';
    const date = f.date || new Date().toISOString().slice(0, 10);
    const materials = Array.isArray(f.materials) ? f.materials : [];
    const carriers  = Array.isArray(f.carriers)  ? f.carriers  : [];

    const totalPct = (typeof f.totalPct === 'number')
      ? f.totalPct
      : materials.reduce((s, m) => s + (Number(m.pct) || 0), 0);

    // ----- Frontmatter -----
    const fm = ['---', 'type: formulation', 'name: ' + yamlScalar(name), 'date: ' + yamlScalar(date)];
    if (typeof f.fragrancePct === 'number') fm.push('fragrance_pct: ' + yamlScalar(f.fragrancePct));
    if (typeof f.batchSize === 'number')    fm.push('batch_size: ' + yamlScalar(f.batchSize) + (f.batchUnit ? '  # ' + f.batchUnit : ''));
    if (f.batchUnit)                        fm.push('batch_unit: ' + yamlScalar(f.batchUnit));
    if (f.productCategory)                  fm.push('target_category: ' + yamlScalar(f.productCategory));
    if (typeof f.temperatureC === 'number') fm.push('temperature_c: ' + yamlScalar(f.temperatureC));
    fm.push('ingredient_count: ' + yamlScalar(materials.length));
    fm.push('total_pct: ' + yamlScalar(Number(totalPct.toFixed(2))));
    fm.push('tags:', '  - fragrance/formulation');
    if (f.productCategory) {
      fm.push('  - fragrance/category/' + slugTag(f.productCategory));
    }
    fm.push('---', '');

    // ----- Body -----
    const body = [];
    body.push('# ' + name, '');
    body.push(`*Exported ${date} from Perfume Analyzer Formulation Lab.*`, '');

    // Composition table — one row per material, total row at the bottom.
    body.push('## Composition', '');
    if (materials.length) {
      body.push('| % | Material | CAS | Dilution | Solvent |');
      body.push('|---:|---|---|---:|---|');
      for (const m of materials) {
        const link = m.name ? `[[${resolveBlendName(m.name)}]]` : '—';
        const pct  = (typeof m.pct === 'number' ? m.pct : Number(m.pct) || 0).toFixed(2);
        const dil  = (m.dilution != null && m.dilution !== '' && Number(m.dilution) < 100)
                      ? Number(m.dilution).toFixed(0) + '%' : '100%';
        let solv = '—';
        if (m.dilutionSolvent) {
          // dilutionSolvent may be a CAS or a name — try to resolve back to a name.
          const DB = (typeof window !== 'undefined') ? window.DB : null;
          const lookup = DB && DB[m.dilutionSolvent];
          solv = lookup && lookup.name ? `[[${lookup.name}]]` : String(m.dilutionSolvent);
        }
        body.push(`| ${pct} | ${link} | ${m.cas || '—'} | ${dil} | ${solv} |`);
      }
      body.push(`| | **Total** | | | **${totalPct.toFixed(2)}%** |`);
      body.push('');
    } else {
      body.push('_No materials in formulation._', '');
    }

    // Carriers — listed separately since they belong to the finished
    // product, not the concentrate.
    if (carriers.length) {
      body.push('### Carriers (in finished product)', '');
      for (const c of carriers) {
        const pct = (typeof c.pct === 'number' ? c.pct : Number(c.pct) || 0).toFixed(2);
        const link = c.name ? `[[${resolveBlendName(c.name)}]]` : (c.cas || '—');
        body.push(`- **${pct}%** — ${link}`);
      }
      body.push('');
    }

    // Meta block — context the analyzer needed to produce the numbers.
    // Skip the entire heading when nothing is available so we never emit
    // a stray empty "## Parameters" section.
    const paramLines = [];
    if (typeof f.fragrancePct === 'number') paramLines.push(`- **Fragrance concentration**: ${f.fragrancePct}% in finished product`);
    if (f.productCategory)                  paramLines.push(`- **Target product**: ${f.productCategory}`);
    if (typeof f.batchSize === 'number')    paramLines.push(`- **Batch size**: ${f.batchSize} ${f.batchUnit || ''}`.trim());
    if (typeof f.temperatureC === 'number') paramLines.push(`- **Reference temperature**: ${f.temperatureC} °C`);
    if (paramLines.length) {
      body.push('## Parameters', '', ...paramLines, '');
    }

    // Analysis — all sub-sections optional.
    const a = f.analysis || {};
    const analysisLines = [];

    if (a.compliance) {
      analysisLines.push('### IFRA compliance', '');
      if (a.compliance.passed) {
        analysisLines.push(`- ✓ Compliant${f.productCategory ? ' for ' + f.productCategory : ''}`);
      } else {
        const fails = Array.isArray(a.compliance.failures) ? a.compliance.failures : [];
        analysisLines.push(`- ✗ ${fails.length || 'Some'} material(s) exceed limits:`);
        for (const fl of fails) {
          analysisLines.push(`  - ${fl.name || fl.cas || '?'} — ${fl.current != null ? Number(fl.current).toFixed(2) + '%' : '?'} vs IFRA max ${fl.max != null ? Number(fl.max).toFixed(2) + '%' : '?'}`);
        }
      }
      analysisLines.push('');
    }

    if (a.noteBalance) {
      analysisLines.push('### Note balance', '');
      const nb = a.noteBalance;
      if (nb.top != null)    analysisLines.push(`- Top: ${Number(nb.top).toFixed(1)}%`);
      if (nb.middle != null) analysisLines.push(`- Middle: ${Number(nb.middle).toFixed(1)}%`);
      if (nb.base != null)   analysisLines.push(`- Base: ${Number(nb.base).toFixed(1)}%`);
      analysisLines.push('');
    }

    if (a.longevity) {
      analysisLines.push('### Estimated longevity', '');
      analysisLines.push(`- ${a.longevity}`, '');
    }

    if (analysisLines.length) {
      body.push('## Analysis', '');
      body.push(...analysisLines);
    }

    // Free-form notes section so users can journal iterations in Obsidian.
    body.push('## Notes', '');
    body.push('*(Add tasting / iteration notes here.)*', '');

    body.push('---');
    body.push(`*Source: Perfume Analyzer Formulation Lab · ${date}*`);

    return fm.join('\n') + body.join('\n') + '\n';
  }

  // ---- Public API ---------------------------------------------------------

  window.ObsidianExport = {
    safeFileName,
    primaryFamilyFolder,
    materialToMarkdown,
    buildMaterialVaultZip,
    formulationToMarkdown,
  };
})();
