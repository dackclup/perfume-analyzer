// ===== Obsidian Vault Export =====
// Phase 1: minimal ZIP export of search results as flat .md files.
// One markdown file per material under Materials/ at the ZIP root.
// Frontmatter + Obsidian wikilinks for blends_with.
//
// Depends on:
//   - JSZip (window.JSZip, loaded via CDN before this script)
//   - DB / NAME_TO_CAS globals from perfumery_data.js (always present in
//     both index.html and formulation.html)
//
// Phases 2-4 will extend this module with hierarchical folders, index
// pages, "export all" mode, and formulation export.

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

  // ---- ZIP builder (Phase 1: flat layout) --------------------------------

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

    // De-dupe by canonical name (since Obsidian links by basename, two
    // notes with the same filename collide). Subsequent dupes get a
    // " (CAS)" suffix to keep them addressable.
    const usedNames = new Set();
    const total = records.length;
    let done = 0;

    for (const item of records) {
      const rec = item && item.record ? item.record : item;
      if (!rec) { done++; continue; }
      let base = safeFileName(rec.names && rec.names.canonical);
      if (usedNames.has(base.toLowerCase())) {
        const cas = rec.identifiers && rec.identifiers.cas;
        base = cas ? `${base} (${cas})` : `${base} (${++done})`;
      }
      usedNames.add(base.toLowerCase());
      matFolder.file(base + '.md', materialToMarkdown(rec));
      done++;
      if (onProgress && (done % 25 === 0 || done === total)) {
        onProgress(Math.round((done / total) * 100));
      }
    }

    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  // ---- Public API ---------------------------------------------------------

  window.ObsidianExport = {
    safeFileName,
    materialToMarkdown,
    buildMaterialVaultZip,
    // Phase 2-4 will extend here:
    //   primaryFamilyFolder, buildIndexPages, formulationToMarkdown
  };
})();
