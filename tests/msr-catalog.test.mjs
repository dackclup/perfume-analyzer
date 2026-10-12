import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  isPerfumeryProduct,
  parsePriceTHB,
  parseProductUrl,
  parseSitemapIndex,
  parseSitemapUrls,
  priceFromJsonLd,
  toCsv,
} from '../tools/msr-catalog/scrape.mjs';

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
<url>
<loc><![CDATA[https://www.myskinrecipes.com/shop/en/musk-aroma-chemicals/2894-habanolide.html]]></loc>
<lastmod>2026-06-22T15:16:43+07:00</lastmod>
<image:image>
<image:loc><![CDATA[https://www.myskinrecipes.com/shop/1-large_default/habanolide.jpg]]></image:loc>
<image:title><![CDATA[Habanolide]]></image:title>
</image:image>
</url>
<url>
<loc><![CDATA[https://www.myskinrecipes.com/shop/en/fragrance-fixative/7835-12h-fix™-smell-lasts-12-hours.html]]></loc>
<image:image><image:title><![CDATA[12H Fix™ &amp;#039;Fixative&amp;#039;]]></image:title></image:image>
</url>
<url>
<loc><![CDATA[https://www.myskinrecipes.com/shop/en/ungrouped-reagent/111199--rose-oil.html]]></loc>
</url>
</urlset>`;

describe('msr-catalog sitemap parsing', () => {
  it('reads child sitemaps from the index', () => {
    const xml = `<sitemapindex><sitemap><loc>https://www.myskinrecipes.com/shop/1_en_0_sitemap.xml</loc></sitemap>
      <sitemap><loc>https://www.myskinrecipes.com/shop/1_th_0_sitemap.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemapIndex(xml)).toEqual([
      'https://www.myskinrecipes.com/shop/1_en_0_sitemap.xml',
      'https://www.myskinrecipes.com/shop/1_th_0_sitemap.xml',
    ]);
  });

  it('extracts loc and image title per url', () => {
    const rows = parseSitemapUrls(SITEMAP);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      loc: 'https://www.myskinrecipes.com/shop/en/musk-aroma-chemicals/2894-habanolide.html',
      title: 'Habanolide',
    });
    expect(rows[1].title).toBe("12H Fix™ 'Fixative'");
    expect(rows[2].title).toBe('');
  });

  it('parses product urls, including non-ASCII slugs', () => {
    expect(
      parseProductUrl(
        'https://www.myskinrecipes.com/shop/en/musk-aroma-chemicals/2894-habanolide.html'
      )
    ).toEqual({
      lang: 'en',
      category: 'musk-aroma-chemicals',
      id: 2894,
      slug: 'habanolide',
    });
    expect(
      parseProductUrl(
        'https://www.myskinrecipes.com/shop/en/fragrance-fixative/7835-12h-fix™-smell-lasts-12-hours.html'
      )?.id
    ).toBe(7835);
    expect(
      parseProductUrl('https://www.myskinrecipes.com/shop/en/317-musk-aroma-chemicals')
    ).toBeNull();
    expect(parseProductUrl('not a url')).toBeNull();
  });

  it('decodes double-encoded entities', () => {
    expect(decodeEntities('it&amp;#039;s A &amp;amp; B')).toBe("it's A & B");
  });
});

describe('msr-catalog classification', () => {
  it('keeps perfumery categories and drops reagents', () => {
    expect(
      isPerfumeryProduct({ id: 2894, category: 'musk-aroma-chemicals', name: 'Habanolide' })
    ).toBe(true);
    expect(
      isPerfumeryProduct({
        id: 7789,
        category: 'dior-fragrance',
        name: 'Sauvage (compare to Dior)',
      })
    ).toBe(true);
    expect(
      isPerfumeryProduct({
        id: 3241,
        category: 'essential-oil-distillation',
        name: 'Patchouli Oil',
      })
    ).toBe(true);
    expect(
      isPerfumeryProduct({ id: 111199, category: 'ungrouped-reagent', name: 'rose oil' })
    ).toBe(false);
    expect(isPerfumeryProduct({ id: 79, category: 'moisturizer', name: 'Hyaluronic Acid' })).toBe(
      false
    );
  });

  it('keeps known perfumery items filed under odd categories', () => {
    expect(
      isPerfumeryProduct({ id: 2846, category: 'hair-growth-ingredients', name: 'Sandal Pentanol' })
    ).toBe(true);
  });
});

describe('msr-catalog price parsing', () => {
  it('reads baht amounts in common formats', () => {
    expect(parsePriceTHB('฿44.45')).toBe(44.45);
    expect(parsePriceTHB('Price: 1,850.00 บาท')).toBe(1850);
    expect(parsePriceTHB('THB 39.66 / g')).toBe(39.66);
    expect(parsePriceTHB('no price here')).toBeNull();
    expect(parsePriceTHB('')).toBeNull();
  });

  it('reads JSON-LD product offers', () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      offers: { price: '44.45', priceCurrency: 'THB', availability: 'https://schema.org/InStock' },
    });
    expect(priceFromJsonLd(['not json', ld])).toEqual({
      price: 44.45,
      currency: 'THB',
      availability: 'InStock',
    });
    expect(priceFromJsonLd([])).toBeNull();
  });

  it('writes CSV with quoting', () => {
    expect(toCsv([{ a: 'x, "y"', b: 2 }], ['a', 'b'])).toBe('a,b\n"x, ""y""",2\n');
  });
});
