import { mergeLegalFields } from './legal-links.js';

const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const MAX_PAGES = 10;
const DEFAULT_DELAY_MS = 600;
const MAX_RETRIES = 4;

export async function fetchAppStoreAppDetails(appId, { country = 'us' } = {}) {
  const url = `${LOOKUP_URL}?id=${appId}&country=${country}&entity=software`;
  const body = await fetchWithRetry(url);
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
  { country = 'us', delayMs = DEFAULT_DELAY_MS, maxReviews = Infinity } = {},
) {
  const reviews = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await fetchAppStoreReviewsPage(appId, { country, page });
    if (!batch.length) break;

    for (const review of batch) {
      reviews.push(normalizeAppStoreReview(review, appId, country));
      if (reviews.length >= maxReviews) break;
    }

    if (reviews.length >= maxReviews) break;
    if (page < MAX_PAGES && delayMs > 0) await sleep(delayMs);
  }

  return reviews.slice(0, maxReviews);
}

export async function fetchAppStoreReviewsBatch(
  appId,
  { country = 'us', batchSize = 100, startPage = 1, delayMs = DEFAULT_DELAY_MS } = {},
) {
  const reviews = [];
  let page = startPage;

  while (reviews.length < batchSize && page <= MAX_PAGES) {
    const batch = await fetchAppStoreReviewsPage(appId, { country, page });
    if (!batch.length) break;

    for (const review of batch) {
      reviews.push(normalizeAppStoreReview(review, appId, country));
      if (reviews.length >= batchSize) break;
    }

    page += 1;
    if (reviews.length >= batchSize) break;
    if (page <= MAX_PAGES && delayMs > 0) await sleep(delayMs);
  }

  const nextPage = page;
  const hasMore = nextPage <= MAX_PAGES && reviews.length >= batchSize;

  return {
    reviews,
    nextPage,
    hasMore,
    platformMax: MAX_PAGES * 50,
  };
}

async function fetchAppStoreReviewsPage(appId, { country = 'us', page = 1, sort = 'mostRecent' } = {}) {
  const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${appId}/sortby=${sort}/json`;
  const body = await fetchWithRetry(url);
  const json = JSON.parse(body);
  const entries = json?.feed?.entry;

  if (!entries) return [];

  const list = Array.isArray(entries) ? entries : [entries];
  return list
    .filter((entry) => entry?.['im:rating'])
    .map((review) => ({
      id: review.id?.label,
      userName: review.author?.name?.label,
      score: parseInt(review['im:rating'].label, 10),
      title: review.title?.label ?? '',
      text: review.content?.label ?? '',
      version: review['im:version']?.label ?? null,
      url: review.link?.attributes?.href ?? null,
      updated: review.updated?.label ?? null,
    }));
}

async function fetchWithRetry(url, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AppReviewScraper/1.0)',
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return await response.text();
  } catch (error) {
    const retryable = isRetryableError(error);
    if (retryable && attempt < MAX_RETRIES) {
      const waitMs = attempt * 1000;
      await sleep(waitMs);
      return fetchWithRetry(url, attempt + 1);
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
