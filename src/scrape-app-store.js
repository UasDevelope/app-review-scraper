import { mergeLegalFields } from './legal-links.js';

const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const DEFAULT_DELAY_MS = 600;
const MAX_RETRIES = 4;
const RSS_MAX_PAGES = 10;
const RSS_SORTS = ['mostRecent', 'mostHelpful'];

// Best-effort cap. Apple no longer reliably exposes 500 reviews via public APIs.
export const APP_STORE_MAX = 500;

const JSON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AppReviewScraper/1.0)',
  Accept: 'application/json, text/plain, */*',
};

const PAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Version/17.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const HTML_SUFFIXES = [
  '',
  '?see-all=reviews',
  '?see-all=customer-reviews',
  '?platform=iphone&see-all=reviews',
];

export async function fetchAppStoreAppDetails(appId, { country = 'us' } = {}) {
  const url = `${LOOKUP_URL}?id=${appId}&country=${country}&entity=software`;
  const body = await fetchWithRetry(url, { headers: JSON_HEADERS });
  const json = JSON.parse(body);
  const app = json.results?.[0];

  if (!app) {
    throw new Error(`App Store app not found for id ${appId}`);
  }

  const legal = mergeLegalFields({}, app.description, {
    developerWebsite: app.sellerUrl ?? null,
  });

  return {
    store: 'app_store',
    appId: String(appId),
    storeCountry: country,
    bundleId: app.bundleId,
    title: app.trackName,
    summary: app.description?.split('\n')[0] ?? '',
    description: app.description,
    developer: app.artistName,
    developerWebsite: app.sellerUrl ?? null,
    genre: app.primaryGenreName,
    genres: app.genres ?? [],
    score: app.averageUserRating,
    ratingsCount: app.userRatingCount ?? null,
    reviewsCount: app.userRatingCount ?? null,
    price: app.price,
    free: app.price === 0,
    currency: app.currency,
    contentRating: app.contentAdvisoryRating,
    version: app.version,
    updated: app.currentVersionReleaseDate ? new Date(app.currentVersionReleaseDate).toISOString() : null,
    released: app.releaseDate ? new Date(app.releaseDate).toISOString() : null,
    url: app.trackViewUrl,
    icon: app.artworkUrl512 || app.artworkUrl100 || app.artworkUrl60,
    screenshots: app.screenshotUrls ?? [],
    supportedDevices: app.supportedDevices ?? [],
    termsOfService: legal.termsOfService,
    privacyPolicy: legal.privacyPolicy,
    legalLinksFound: legal.legalLinksFound,
  };
}

export async function fetchAllAppStoreReviews(
  appId,
  { country = 'us', delayMs = DEFAULT_DELAY_MS, maxReviews = APP_STORE_MAX, trackViewUrl = null } = {},
) {
  const reviews = await fetchAppStoreReviewsCombined(appId, { country, trackViewUrl, delayMs });
  return reviews.slice(0, maxReviews);
}

export async function fetchAppStoreReviewsBatch(
  appId,
  { country = 'us', batchSize = 100, startPage = 1, delayMs = DEFAULT_DELAY_MS, trackViewUrl = null } = {},
) {
  const reviews = await fetchAppStoreReviewsCombined(appId, { country, trackViewUrl, delayMs });
  const start = Math.max(0, startPage - 1) * batchSize;
  const slice = reviews.slice(start, start + batchSize);

  return {
    reviews: slice,
    nextPage: startPage + 1,
    hasMore: start + slice.length < reviews.length,
    platformMax: APP_STORE_MAX,
  };
}

async function fetchAppStoreReviewsCombined(
  appId,
  { country = 'us', trackViewUrl = null, delayMs = DEFAULT_DELAY_MS } = {},
) {
  const merged = new Map();

  const rssReviews = await fetchAppStoreReviewsFromRss(appId, { country, delayMs });
  for (const review of rssReviews) merged.set(review.id, review);

  const htmlReviews = await fetchAppStoreReviewsFromHtml(appId, { country, trackViewUrl, delayMs });
  for (const review of htmlReviews) merged.set(review.id, review);

  return [...merged.values()]
    .sort((a, b) => {
      const aTime = a.updated ? Date.parse(a.updated) : 0;
      const bTime = b.updated ? Date.parse(b.updated) : 0;
      return bTime - aTime;
    })
    .map((review) => normalizeAppStoreReview(review, appId, country));
}

async function fetchAppStoreReviewsFromRss(appId, { country = 'us', delayMs = 0 } = {}) {
  const merged = new Map();

  for (const sort of RSS_SORTS) {
    for (let page = 1; page <= RSS_MAX_PAGES; page += 1) {
      const batch = await fetchAppStoreReviewsRssPage(appId, { country, page, sort });
      if (!batch.length) break;

      for (const review of batch) merged.set(review.id, review);
      if (page < RSS_MAX_PAGES && delayMs > 0) await sleep(delayMs);
    }
  }

  return [...merged.values()];
}

async function fetchAppStoreReviewsRssPage(appId, { country = 'us', page = 1, sort = 'mostRecent' } = {}) {
  const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${appId}/sortby=${sort}/json`;

  try {
    const body = await fetchWithRetry(url, { headers: JSON_HEADERS });
    const json = JSON.parse(body);
    const entries = json?.feed?.entry;
    if (!entries) return [];

    const list = Array.isArray(entries) ? entries : [entries];
    return list
      .filter((entry) => entry?.['im:rating'])
      .map((review) => ({
        id: review.id?.label,
        userName: review.author?.name?.label ?? '',
        score: parseInt(review['im:rating'].label, 10),
        title: review.title?.label ?? '',
        text: review.content?.label ?? '',
        version: review['im:version']?.label ?? null,
        url: review.link?.attributes?.href ?? null,
        updated: review.updated?.label ?? null,
      }));
  } catch {
    return [];
  }
}

async function fetchAppStoreReviewsFromHtml(
  appId,
  { country = 'us', trackViewUrl = null, delayMs = 0 } = {},
) {
  const pageUrl = await resolveAppStorePageUrl(appId, { country, trackViewUrl });
  const merged = new Map();

  for (let i = 0; i < HTML_SUFFIXES.length; i += 1) {
    try {
      const html = await fetchWithRetry(pageUrl + HTML_SUFFIXES[i], { headers: PAGE_HEADERS });
      for (const review of extractReviewsFromHtml(html)) {
        merged.set(review.id, review);
      }
    } catch {
      // Some suffixes or storefronts may 404 — skip and continue.
    }
    if (i < HTML_SUFFIXES.length - 1 && delayMs > 0) await sleep(delayMs);
  }

  return [...merged.values()];
}

async function resolveAppStorePageUrl(appId, { country = 'us', trackViewUrl = null } = {}) {
  const url = trackViewUrl ?? (await fetchAppStoreAppDetails(appId, { country })).url;
  const base = url.replace(/\?.*$/, '');
  return base.replace(/\/[a-z]{2}\//, `/${country}/`);
}

function extractReviewsFromHtml(html) {
  const marker = 'id="serialized-server-data"';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return [];

  const jsonStart = html.indexOf('>', markerIndex) + 1;
  const jsonEnd = html.indexOf('</script>', jsonStart);
  if (jsonEnd <= jsonStart) return [];

  let data;
  try {
    data = JSON.parse(html.slice(jsonStart, jsonEnd));
  } catch {
    return [];
  }

  const reviews = new Map();
  walkReviewNodes(data, reviews);
  return [...reviews.values()];
}

function walkReviewNodes(node, out) {
  if (!node || typeof node !== 'object') return;

  if (node.$kind === 'Review' && node.id && node.contents) {
    out.set(node.id, {
      id: node.id,
      userName: node.reviewerName ?? '',
      score: node.rating,
      title: node.title ?? '',
      text: node.contents ?? '',
      version: node.version ?? null,
      url: null,
      updated: node.date ?? null,
    });
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) walkReviewNodes(item, out);
    return;
  }

  for (const value of Object.values(node)) walkReviewNodes(value, out);
}

async function fetchWithRetry(url, { attempt = 1, headers = JSON_HEADERS } = {}) {
  try {
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.text();
  } catch (error) {
    const retryable = isRetryableError(error);
    if (retryable && attempt < MAX_RETRIES) {
      const waitMs = attempt * 1000;
      await sleep(waitMs);
      return fetchWithRetry(url, { attempt: attempt + 1, headers });
    }
    throw error;
  }
}

function isRetryableError(error) {
  const message = error?.message ?? String(error);
  return (
    message.includes('SSL') ||
    message.includes('TLS') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT') ||
    message.includes('fetch failed') ||
    message.includes('HTTP 5')
  );
}

function normalizeAppStoreReview(review, appId, country = 'us') {
  return {
    store: 'app_store',
    appId: String(appId),
    storeCountry: country,
    reviewId: review.id,
    userName: review.userName,
    rating: review.score,
    title: review.title ?? '',
    text: review.text ?? '',
    date: review.updated ? new Date(review.updated).toISOString() : null,
    appVersion: review.version ?? null,
    url: review.url ?? null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
