#!/usr/bin/env node
/**
 * MySkinRecipes perfumery catalog scraper (personal shopping list, not part of the app build).
 *
 * Stage 1 — read the shop's public sitemaps and list every product (id, name, category, url),
 *           then keep the perfumery-relevant ones.
 * Stage 2 — (opt-in) open those product pages in headless Chromium (the shop renders prices
 *           with JavaScript) and record price / stock / CAS text. As of 2026-10-13 the shop answers
 *           automated browsers with HTTP 403, so this stage stops at the first refusal and is off by
 *           default. Do not try to get around that refusal.
 *
 * Polite by design: a small number of workers, a delay between page loads, images/fonts/media
 * blocked, only /shop/en/ product paths (allowed by the shop's robots.txt), and a stop after
 * repeated failures.
 *
 * Env:
 *   MSR_STAGE      "sitemap" (list only) | "all" (list + prices)   default "sitemap"
 *   MSR_MAX_PAGES  max product pages to open                        default 4000
 *   MSR_WORKERS    parallel pages                                   default 2
 *   MSR_DELAY_MS   pause after each page per worker                 default 1500
 *   MSR_OUT_DIR    output folder                                    default "data/msr"
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://www.myskinrecipes.com';
const SITEMAP_INDEX = `${BASE}/shop/sitemap.xml`;

// ---------------------------------------------------------------- classification

/** Category slugs that hold perfumery raw materials or compare-to fragrance oils. */
export const PERFUMERY_CATEGORY_PATTERNS = [
  /aroma-chemicals/, // musk-, wood-, vanilla-, jasmine-, rose-, citrus-, fruit-, green-, aldehyde-, spice- …
  /fragranc/, // rose-fragrances, other-floral-fragrancess, fragrance-ingredients, fragrance-fixative …
  /^benchmark-/, // "compare to <brand>" fragrance oils: benchmark-dior, benchmark-chanel …
  /essential-oil/,
  /^bergamot-orange-lemon$/,
  /^herbs-lavender/,
  /^sweets-ylang/,
  /^woods-cedar/,
  /^spices-clove/,
  /^rose-geranium/,
  /^coniferan-balsam/,
  /^absolute-solvent-extract$/,
  /^floral-and-scent-extracts$/,
  /^lily-of-the-valley/,
  /^mimi-sar$/,
  /^solvents-polyols$/,
];

/** Perfume bottles, pipettes, beakers and scales. */
export const TOOL_CATEGORY_PATTERNS = [
  /perfume-bottle/,
  /^\d+ml-bottle$/,
  /^glass-?bottle$/,
  /^glassamber$/,
  /^pipette$/,
  /^beaker$/,
  /weight-scale/,
  /^scale$/,
];

/** Lab-reagent / analytical-standard / synthesis categories: not perfumery grade. */
export const REAGENT_CATEGORY_PATTERNS = [
  /reagent/,
  /standards?$/,
  /^analytical-/,
  /^certified-reference/,
  /^ungroupable$/,
  /derivatives?$/,
  /intermediates?$/,
  /building-blocks?$/,
  /linkers?$/,
  /dyes?$/,
  /labeled/,
];

/** Perfumery items the shop files under unrelated categories. */
export const EXTRA_IDS = new Set([
  2846, // Sandalore (hair-growth-ingredients)
  128313, // Triethyl citrate (acids)
  8357, // Sclareolide (whitening)
  3731, // Sclareol (anti-wrinkle)
  8397, // Isopropyl palmitate
  1480, // Benzophenone-4
  2753, // Benzyl cinnamate (stale slug)
  3229, // Mandarin oil (stale slug)
  293, // Glass beaker 100 ml
]);

const NAME_KEYWORDS = /compare to|essential oil|fragrance oil|perfume|น้ำหอม/i;

export function isReagentCategory(category) {
  return REAGENT_CATEGORY_PATTERNS.some(re => re.test(category));
}

export function isPerfumeryProduct({ id, category, name }) {
  if (EXTRA_IDS.has(id)) return true;
  if (isReagentCategory(category)) return false;
  if (PERFUMERY_CATEGORY_PATTERNS.some(re => re.test(category))) return true;
  return NAME_KEYWORDS.test(name || '');
}

export function isToolProduct({ category }) {
  return TOOL_CATEGORY_PATTERNS.some(re => re.test(category));
}

/** Lower number = listed / scraped earlier. */
export function categoryPriority(category) {
  if (/aroma-chemicals/.test(category)) return 0;
  if (
    /essential-oil|bergamot|herbs-|sweets-|woods-|spices-|rose-geranium|coniferan|absolute|floral-and/.test(
      category
    )
  )
    return 1;
  if (/solvents|fixative/.test(category)) return 2;
  if (/^benchmark-|fragranc/.test(category)) return 3;
  return 4;
}

// ---------------------------------------------------------------- parsing helpers

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#039;': "'",
  '&apos;': "'",
};

export function decodeEntities(s) {
  let out = s;
  // Sitemap captions are sometimes double-encoded ("&amp;#039;"), so decode twice.
  for (let i = 0; i < 2; i += 1) {
    out = out.replace(/&(amp|lt|gt|quot|apos|#039);/g, m => ENTITIES[m] ?? m);
  }
  return out;
}

/** Child sitemap URLs from a sitemap index. */
export function parseSitemapIndex(xml) {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/g)].map(
    m => m[1]
  );
}

/** { loc, title } for every <url> entry; title = first <image:title>. */
export function parseSitemapUrls(xml) {
  const out = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const block = m[1];
    const loc = block.match(/<loc>\s*(?:<!\[CDATA\[)?\s*([\s\S]*?)\s*(?:\]\]>)?\s*<\/loc>/);
    if (!loc) continue;
    const title = block.match(
      /<image:title>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/image:title>/
    );
    out.push({ loc: loc[1].trim(), title: title ? decodeEntities(title[1].trim()) : '' });
  }
  return out;
}

/** { lang, category, id, slug } for a product URL, else null. */
export function parseProductUrl(loc) {
  let url;
  try {
    url = new URL(loc);
  } catch {
    return null;
  }
  const m = url.pathname.match(/^\/shop\/(en|th)\/([^/]+)\/(\d+)-([^/]*)\.html$/);
  if (!m) return null;
  const safeDecode = s => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  return { lang: m[1], category: safeDecode(m[2]), id: Number(m[3]), slug: safeDecode(m[4]) };
}

/** First THB amount in a text, e.g. "฿44.45" / "1,850.00 บาท" → number. */
export function parsePriceTHB(text) {
  if (!text) return null;
  const t = String(text).replace(/,/g, '');
  const m = t.match(/(?:฿|THB)\s*([0-9]+(?:\.[0-9]+)?)|([0-9]+(?:\.[0-9]+)?)\s*(?:฿|บาท|THB)/i);
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) ? n : null;
}

/** Price + availability from JSON-LD Product blocks, if any. */
export function priceFromJsonLd(blocks) {
  for (const raw of blocks || []) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const items = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
    for (const item of items) {
      if (!item || !/Product/i.test(String(item['@type']))) continue;
      const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
      if (!offers) continue;
      const price = Number(offers.price ?? offers.lowPrice);
      return {
        price: Number.isFinite(price) ? price : null,
        currency: offers.priceCurrency || '',
        availability: String(offers.availability || '').replace(/^https?:\/\/schema\.org\//, ''),
      };
    }
  }
  return null;
}

export function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map(c => csvCell(r[c])).join(','));
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- stage 1: sitemaps

async function fetchText(url) {
  const res = await fetch(url, { headers: { accept: 'application/xml,text/xml,*/*' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

async function readCatalogFromSitemaps(log) {
  const index = await fetchText(SITEMAP_INDEX);
  const children = parseSitemapIndex(index).filter(u => /_en_\d+_sitemap\.xml$/.test(u));
  log(`sitemap index: ${children.length} English sitemaps`);
  const byId = new Map();
  for (const child of children) {
    const xml = await fetchText(child);
    let n = 0;
    for (const { loc, title } of parseSitemapUrls(xml)) {
      const p = parseProductUrl(loc);
      if (!p || p.lang !== 'en') continue;
      n += 1;
      if (!byId.has(p.id)) {
        byId.set(p.id, {
          id: p.id,
          category: p.category,
          name: title || p.slug.replace(/-/g, ' '),
          url: loc,
        });
      }
    }
    log(`  ${path.basename(child)}: ${n} product URLs`);
    await new Promise(r => setTimeout(r, 500));
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------- stage 2: product pages

async function scrapeProductPages(products, opts, log) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: 'en-US' });
  await context.route('**/*', route => {
    const type = route.request().resourceType();
    return ['image', 'font', 'media'].includes(type) ? route.abort() : route.continue();
  });

  const queue = [...products];
  const results = [];
  const jsonEndpoints = new Set();
  let consecutiveFailures = 0;
  let stopped = false;

  async function worker(w) {
    const page = await context.newPage();
    page.on('response', res => {
      const ct = res.headers()['content-type'] || '';
      if (
        jsonEndpoints.size < 40 &&
        ct.includes('json') &&
        res.url().includes('myskinrecipes.com')
      ) {
        jsonEndpoints.add(res.url().split('?')[0]);
      }
    });
    while (queue.length && !stopped) {
      const p = queue.shift();
      const row = {
        ...p,
        page_title: '',
        price_thb: '',
        price_text: '',
        stock: '',
        cas: '',
        notes: '',
        status: '',
      };
      try {
        const resp = await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const code = resp ? resp.status() : 0;
        if (code === 403 || code === 429) throw new Error(`HTTP ${code} (blocked or rate-limited)`);
        await page.waitForSelector('h1', { timeout: 20000 }).catch(() => {});
        await page
          .waitForFunction(() => /฿|THB|บาท/.test(document.body?.innerText || ''), null, {
            timeout: 15000,
          })
          .catch(() => {});
        const d = await page.evaluate(() => {
          const clean = s => (s || '').replace(/\s+/g, ' ').trim();
          const txt = el => (el ? clean(el.textContent) : '');
          const itemprop = document.querySelector('[itemprop="price"]');
          const lines = (document.body?.innerText || '').split('\n').map(clean).filter(Boolean);
          return {
            h1: txt(document.querySelector('h1')),
            metaPrice:
              document.querySelector('meta[property="product:price:amount"]')?.content || '',
            itempropPrice: itemprop ? itemprop.getAttribute('content') || txt(itemprop) : '',
            ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(
              s => s.textContent
            ),
            priceEls: [...document.querySelectorAll('[class*="price" i]')]
              .map(txt)
              .filter(s => /฿|THB|บาท|[0-9]/.test(s))
              .slice(0, 6),
            bahtLines: lines.filter(l => /฿|บาท|THB/.test(l)).slice(0, 8),
            stockLines: lines
              .filter(l =>
                /in stock|out of stock|pre-?order|no longer|สต็อก|สต๊อก|หมด|พร้อมส่ง/i.test(l)
              )
              .slice(0, 4),
            casLine: lines.find(l => /\bCAS\b/i.test(l)) || '',
            minLines: lines.filter(l => /minimum|\bmin\b|ขั้นต่ำ/i.test(l)).slice(0, 3),
          };
        });
        const ld = priceFromJsonLd(d.ld);
        const candidates = [
          ld && ld.price !== null ? `฿${ld.price}` : '',
          d.metaPrice ? `฿${d.metaPrice}` : '',
          d.itempropPrice && /[0-9]/.test(d.itempropPrice)
            ? `฿${d.itempropPrice.replace(/[^0-9.,]/g, '')}`
            : '',
          ...d.priceEls,
          ...d.bahtLines,
        ].filter(Boolean);
        const priceText = candidates.find(c => parsePriceTHB(c) !== null) || '';
        row.page_title = d.h1;
        row.price_text = priceText.slice(0, 120);
        row.price_thb = parsePriceTHB(priceText) ?? '';
        row.stock = (ld?.availability || d.stockLines.join(' | ')).slice(0, 160);
        row.cas = (d.casLine.match(/\b\d{2,7}-\d{2}-\d\b/) || [''])[0];
        row.notes = d.minLines.join(' | ').slice(0, 160);
        row.status = d.h1 ? (priceText ? 'ok' : 'no-price') : 'no-content';
        consecutiveFailures = d.h1 ? 0 : consecutiveFailures + 1;
      } catch (err) {
        row.status = `error: ${String(err.message || err).slice(0, 100)}`;
        consecutiveFailures += 1;
        if (/HTTP (403|429)/.test(row.status) && !stopped) {
          log('stopping: the shop refused the automated browser (HTTP 403/429); not retrying');
          stopped = true;
        }
      }
      results.push(row);
      if (results.length % 50 === 0) {
        log(`  ${results.length}/${products.length} pages (worker ${w})`);
        await opts.onProgress(results, [...jsonEndpoints]);
      }
      if (consecutiveFailures >= 15) {
        log('stopping: 15 pages in a row failed (site blocked us or changed layout)');
        stopped = true;
      }
      await new Promise(r => setTimeout(r, opts.delayMs));
    }
    await page.close();
  }

  await Promise.all(Array.from({ length: opts.workers }, (_, i) => worker(i + 1)));
  await browser.close();
  return { results, jsonEndpoints: [...jsonEndpoints] };
}

// ---------------------------------------------------------------- main

async function main() {
  const stage = process.env.MSR_STAGE || 'sitemap';
  const maxPages = Number(process.env.MSR_MAX_PAGES || 4000);
  const workers = Math.max(1, Math.min(4, Number(process.env.MSR_WORKERS || 2)));
  const delayMs = Math.max(500, Number(process.env.MSR_DELAY_MS || 1500));
  const outDir = process.env.MSR_OUT_DIR || 'data/msr';
  await mkdir(outDir, { recursive: true });

  const logLines = [];
  const log = s => {
    const line = `[${new Date().toISOString()}] ${s}`;
    logLines.push(line);
    console.log(line);
  };
  const flushLog = () => writeFile(path.join(outDir, 'run_log.txt'), `${logLines.join('\n')}\n`);

  const all = await readCatalogFromSitemaps(log);
  log(`products in sitemaps: ${all.length}`);

  const counts = new Map();
  for (const p of all) counts.set(p.category, (counts.get(p.category) || 0) + 1);
  const countRows = [...counts.entries()]
    .map(([category, products]) => ({
      category,
      products,
      perfumery: PERFUMERY_CATEGORY_PATTERNS.some(re => re.test(category)) ? 'yes' : '',
      reagent: isReagentCategory(category) ? 'yes' : '',
    }))
    .sort((a, b) => b.products - a.products);
  await writeFile(
    path.join(outDir, 'category_counts.csv'),
    toCsv(countRows, ['category', 'products', 'perfumery', 'reagent'])
  );

  const perfumery = all
    .filter(isPerfumeryProduct)
    .sort((a, b) => categoryPriority(a.category) - categoryPriority(b.category) || a.id - b.id);
  log(`perfumery-relevant products: ${perfumery.length}`);
  await writeFile(
    path.join(outDir, 'perfumery_products.csv'),
    toCsv(perfumery, ['id', 'category', 'name', 'url'])
  );
  const tools = all
    .filter(isToolProduct)
    .sort((a, b) => a.category.localeCompare(b.category) || a.id - b.id);
  log(`bottles / pipettes / beakers / scales: ${tools.length}`);
  await writeFile(
    path.join(outDir, 'tools_packaging.csv'),
    toCsv(tools, ['id', 'category', 'name', 'url'])
  );
  await flushLog();

  if (stage === 'sitemap') return;

  const toScrape = perfumery.slice(0, maxPages);
  log(`opening ${toScrape.length} product pages (workers=${workers}, delay=${delayMs}ms)`);
  const priceColumns = [
    'id',
    'category',
    'name',
    'page_title',
    'price_thb',
    'price_text',
    'stock',
    'cas',
    'notes',
    'status',
    'url',
  ];
  const save = async (rows, endpoints) => {
    const sorted = [...rows].sort((a, b) => a.id - b.id);
    await writeFile(path.join(outDir, 'perfumery_prices.csv'), toCsv(sorted, priceColumns));
    await writeFile(path.join(outDir, 'json_endpoints_seen.txt'), `${endpoints.join('\n')}\n`);
    await flushLog();
  };
  const { results, jsonEndpoints } = await scrapeProductPages(
    toScrape,
    { workers, delayMs, onProgress: save },
    log
  );
  const ok = results.filter(r => r.status === 'ok').length;
  log(`done: ${results.length} pages, ${ok} with a price`);
  await save(results, jsonEndpoints);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
