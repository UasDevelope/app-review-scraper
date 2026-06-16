// App Store storefronts (app-store-scraper markets) — same ISO codes Google Play uses.
const CODES = [
  'dz', 'ao', 'ai', 'ar', 'am', 'au', 'at', 'az', 'bh', 'bb', 'by', 'be', 'bz', 'bm', 'bo', 'bw',
  'br', 'vg', 'bn', 'bg', 'ca', 'ky', 'cl', 'cn', 'co', 'cr', 'hr', 'cy', 'cz', 'dk', 'dm', 'ec',
  'eg', 'sv', 'ee', 'fi', 'fr', 'de', 'gb', 'gh', 'gr', 'gd', 'gt', 'gy', 'hn', 'hk', 'hu', 'is',
  'in', 'id', 'ie', 'il', 'it', 'jm', 'jp', 'jo', 'ke', 'kr', 'kw', 'lv', 'lb', 'lt', 'lu', 'mo',
  'mk', 'mg', 'my', 'ml', 'mt', 'mu', 'mx', 'ms', 'np', 'nl', 'nz', 'ni', 'ne', 'ng', 'no', 'om',
  'pk', 'pa', 'py', 'pe', 'ph', 'pl', 'pt', 'qa', 'ro', 'ru', 'sa', 'sn', 'sg', 'sk', 'si', 'za',
  'es', 'lk', 'sr', 'se', 'ch', 'tw', 'tz', 'th', 'tn', 'tr', 'ug', 'ua', 'ae', 'us', 'uy', 'uz',
  've', 'vn', 'ye',
];

const displayNames = new Intl.DisplayNames('en', { type: 'region' });

/** @type {{ code: string, name: string }[]} */
export const STORE_COUNTRIES = CODES.map((code) => ({
  code,
  name: displayNames.of(code.toUpperCase()) ?? code.toUpperCase(),
})).sort((a, b) => a.name.localeCompare(b.name));

const CODE_SET = new Set(CODES);

/** All supported storefront ISO codes (115 regions). */
export const ALL_STORE_COUNTRY_CODES = [...CODES];

/** High-yield regions scraped first for faster early results. */
export const PRIORITY_STORE_COUNTRIES = [
  'us', 'gb', 'ca', 'au', 'de', 'fr', 'jp', 'in', 'br', 'mx', 'kr', 'it', 'es', 'nl', 'se',
];

export function isValidStoreCountry(code) {
  return CODE_SET.has(String(code ?? '').toLowerCase());
}

export function normalizeStoreCountry(code, fallback = 'us') {
  const normalized = String(code ?? fallback).toLowerCase();
  return isValidStoreCountry(normalized) ? normalized : fallback;
}

/** Accept a single code, array of codes, or undefined — returns deduped valid list. */
export function normalizeStoreCountries(input, fallback = 'us') {
  let raw = [];
  if (Array.isArray(input)) raw = input;
  else if (input != null && input !== '') raw = [input];

  const seen = new Set();
  const out = [];
  for (const code of raw) {
    const normalized = String(code ?? '').toLowerCase();
    if (!isValidStoreCountry(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out.length ? out : [normalizeStoreCountry(fallback)];
}

/** Resolve which regions to scrape; maxCoverage uses every supported storefront. */
export function resolveScrapeRegions({ countries, country, maxCoverage = false } = {}) {
  if (maxCoverage) return ALL_STORE_COUNTRY_CODES;
  return normalizeStoreCountries(countries ?? country);
}

export function orderStoreCountries(codes) {
  const set = new Set(codes);
  const ordered = PRIORITY_STORE_COUNTRIES.filter((c) => set.has(c));
  for (const code of codes) {
    if (!ordered.includes(code)) ordered.push(code);
  }
  return ordered;
}
