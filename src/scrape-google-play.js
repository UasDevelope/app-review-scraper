import gplay from 'google-play-scraper';
import { mergeLegalFields } from './legal-links.js';

const DEFAULT_DELAY_MS = 300;
const MAX_RETRIES = 4;

export async function fetchGooglePlayAppDetails(appId, { lang = 'en', country = 'us' } = {}) {
  const app = await withRetry(() => gplay.app({ appId, lang, country }));

  const legal = mergeLegalFields({}, app.description, {
    privacyPolicy: app.privacyPolicy ?? null,
    developerWebsite: app.developerWebsite ?? null,
  });

  return {
    store: 'google_play',
    appId: app.appId,
    storeCountry: country,
    title: app.title,
    summary: app.summary,
    description: app.description,
    developer: app.developer,
    developerWebsite: app.developerWebsite ?? null,
    developerLegalName: app.developerLegalName ?? null,
    genre: app.genre,
    score: app.score,
    scoreText: app.scoreText,
    ratingsCount: app.ratings,
    reviewsCount: app.reviews,
    installs: app.installs,
    minInstalls: app.minInstalls,
    price: app.price,
    free: app.free,
    currency: app.currency,
    contentRating: app.contentRating,
    version: app.version,
    updated: app.updated ? new Date(app.updated).toISOString() : null,
    released: app.released ?? null,
    url: app.url,
    icon: app.icon,
    screenshots: app.screenshots ?? [],
    histogram: app.histogram ?? {},
    termsOfService: legal.termsOfService,
    privacyPolicy: legal.privacyPolicy,
    legalLinksFound: legal.legalLinksFound,
  };
}

export async function fetchAllGooglePlayReviews(
  appId,
  { lang = 'en', country = 'us', delayMs = DEFAULT_DELAY_MS, maxReviews = Infinity, onProgress } = {},
) {
  const reviews = [];
  let nextPaginationToken = null;
  let page = 0;

  while (reviews.length < maxReviews) {
    page += 1;
    const response = await withRetry(() =>
      gplay.reviews({
        appId,
        lang,
        country,
        sort: gplay.sort.NEWEST,
        paginate: true,
        nextPaginationToken,
      }),
    );

    const batch = response.data ?? [];
    if (batch.length === 0) break;

    for (const review of batch) {
      reviews.push(normalizeGooglePlayReview(review, appId, country));
      if (reviews.length >= maxReviews) break;
    }

    nextPaginationToken = response.nextPaginationToken;
    if (!nextPaginationToken) break;

    if (onProgress) onProgress(reviews.length);
    if (delayMs > 0) await sleep(delayMs);
    if (page % 10 === 0) {
      console.log(`  Google Play: fetched ${reviews.length} reviews so far...`);
    }
  }

  return reviews;
}

export async function fetchGooglePlayReviewsBatch(
  appId,
  { lang = 'en', country = 'us', batchSize = 100, continuationToken = null, delayMs = DEFAULT_DELAY_MS, onProgress, onReviewChunk } = {},
) {
  const reviews = [];
  let nextToken = continuationToken;
  let pagesFetched = 0;

  while (reviews.length < batchSize) {
    const response = await withRetry(() =>
      gplay.reviews({
        appId,
        lang,
        country,
        sort: gplay.sort.NEWEST,
        paginate: true,
        nextPaginationToken: nextToken,
      }),
    );

    const batch = response.data ?? [];
    if (batch.length === 0) {
      nextToken = null;
      break;
    }

    const pageReviews = [];
    for (const review of batch) {
      const normalized = normalizeGooglePlayReview(review, appId, country);
      pageReviews.push(normalized);
      reviews.push(normalized);
      if (reviews.length >= batchSize) break;
    }

    if (pageReviews.length && onReviewChunk) onReviewChunk(pageReviews);

    nextToken = response.nextPaginationToken;
    pagesFetched += 1;
    if (onProgress) onProgress(reviews.length);
    if (!nextToken) break;
    if (reviews.length >= batchSize) break;
    if (delayMs > 0) await sleep(delayMs);
  }

  return {
    reviews,
    continuationToken: nextToken,
    hasMore: Boolean(nextToken),
  };
}

function normalizeGooglePlayReview(review, appId, country = 'us') {
  return {
    store: 'google_play',
    storeCountry: country,
    appId,
    reviewId: review.id,
    userName: review.userName,
    rating: review.score,
    title: review.title ?? '',
    text: review.text ?? '',
    date: review.date ? new Date(review.date).toISOString() : null,
    appVersion: review.version ?? null,
    thumbsUp: review.thumbsUp ?? 0,
    replyText: review.replyText ?? null,
    replyDate: review.replyDate ? new Date(review.replyDate).toISOString() : null,
    url: review.url ?? null,
  };
}

async function withRetry(fn, attempt = 1) {
  try {
    return await fn();
  } catch (error) {
    if (attempt < MAX_RETRIES && isRetryableError(error)) {
      await sleep(attempt * 1000);
      return withRetry(fn, attempt + 1);
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
    message.includes('fetch failed')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
