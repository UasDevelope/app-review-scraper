import fs from 'fs/promises';
import path from 'path';
import {
  fetchGooglePlayAppDetails,
  fetchGooglePlayReviewsBatch,
} from './scrape-google-play.js';
import {
  APP_STORE_MAX,
  fetchAppStoreAppDetails,
  fetchAllAppStoreReviews,
  fetchAppStoreReviewsAllRegions,
} from './scrape-app-store.js';
import { orderStoreCountries, resolveScrapeRegions } from './countries.js';
import {
  ensureDir,
  outputDir,
  sanitizeFilename,
  sleep,
  writeCsv,
  writeJson,
} from './utils.js';

const PAGINATION_FILE = 'pagination-state.json';
// Popular apps (e.g. Replika ~524K reviews) would take hours without a cap.
const GOOGLE_PLAY_MAX = 5000;
export { GOOGLE_PLAY_MAX as GOOGLE_PLAY_BATCH_SIZE };

function dedupeReviews(reviews) {
  const seen = new Set();
  const out = [];
  for (const review of reviews) {
    const key = review.reviewId ?? `${review.userName}|${review.date}|${(review.text ?? '').slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(review);
  }
  return out;
}

export async function scrapeApp(app, outRoot, { countries, country, maxCoverage = false, onLog, fetchDetails = true }) {
  const androidRegions = orderStoreCountries(resolveScrapeRegions({ countries, country, maxCoverage: false }));
  const iosRegions = orderStoreCountries(
    maxCoverage
      ? resolveScrapeRegions({ maxCoverage: true })
      : resolveScrapeRegions({ countries, country, maxCoverage: false }),
  );
  const primary = androidRegions[0] ?? iosRegions[0] ?? 'us';
  const label = app.name ?? app.googlePlayId ?? app.appStoreId;
  const safeName = sanitizeFilename(String(label));
  const log = (message) => onLog?.({ type: 'log', message, app: label });
  const androidLabel = androidRegions.length === 1 ? androidRegions[0] : `${androidRegions.length} regions`;
  const iosLabel = maxCoverage
    ? `all ${iosRegions.length} regions`
    : iosRegions.length === 1
      ? iosRegions[0]
      : `${iosRegions.length} regions`;

  log(`Starting ${label}…`);

  const result = {
    name: app.name ?? safeName,
    safeName,
    googlePlay: null,
    appStore: null,
    errors: [],
    pagination: {
      googlePlay: null,
      appStore: null,
    },
  };

  if (app.googlePlayId) {
    try {
      if (fetchDetails) {
        log(`Google Play: fetching app details (${app.googlePlayId})...`);
        const details = await fetchGooglePlayAppDetails(app.googlePlayId, { country: primary });
        const appDir = path.join(outRoot, safeName, 'google_play');
        await ensureDir(appDir);
        await writeJson(path.join(appDir, 'app-details.json'), details);
        result.googlePlay = { details, reviewCount: 0 };

        const listed = details.reviewsCount ?? details.ratingsCount;
        if (listed && listed > GOOGLE_PLAY_MAX) {
          log(`Google Play: store lists ${listed.toLocaleString()} reviews — fetching ${GOOGLE_PLAY_MAX.toLocaleString()} most recent per region`);
        }
      }

      const merged = [];
      let hasMore = false;
      let continuationToken = null;

      for (const region of androidRegions) {
        log(`Google Play (${region}): fetching up to ${GOOGLE_PLAY_MAX.toLocaleString()} reviews...`);
        let lastLogged = 0;
        const batch = await fetchGooglePlayReviewsBatch(app.googlePlayId, {
          country: region,
          batchSize: GOOGLE_PLAY_MAX,
          continuationToken: null,
          onProgress: (count) => {
            onLog?.({ type: 'progress', store: 'google_play', app: label, count: merged.length + count });
            if (count - lastLogged >= 500 || count <= 150) {
              lastLogged = count;
              log(`Google Play (${region}): ${count.toLocaleString()} reviews fetched…`);
            }
          },
        });
        merged.push(...batch.reviews);
        if (androidRegions.length === 1 && batch.hasMore) {
          hasMore = true;
          continuationToken = batch.continuationToken;
        }
        if (androidRegions.length > 1) await sleep(400);
      }

      const reviews = dedupeReviews(merged);

      const appDir = path.join(outRoot, safeName, 'google_play');
      await ensureDir(appDir);
      await writeJson(path.join(appDir, 'reviews.json'), reviews);
      await writeCsv(path.join(appDir, 'reviews.csv'), reviews);

      result.googlePlay = {
        ...result.googlePlay,
        reviews,
        reviewCount: reviews.length,
      };
      result.pagination.googlePlay = {
        hasMore,
        fetched: reviews.length,
        continuationToken,
        platformMax: GOOGLE_PLAY_MAX,
        storeCountry: androidRegions.length === 1 ? primary : androidRegions.join(','),
      };

      log(`Google Play: done — ${reviews.length} unique reviews (${androidLabel})${hasMore ? ' — more available, click Fetch next 5,000' : ''}`);
    } catch (error) {
      const message = error?.message ?? String(error);
      result.errors.push({ store: 'google_play', message });
      log(`Google Play error: ${message}`);
    }
  }

  if (app.appStoreId) {
    try {
      if (fetchDetails) {
        log(`App Store: fetching app details (${app.appStoreId})...`);
        const details = await fetchAppStoreAppDetails(app.appStoreId, { country: primary });
        const appDir = path.join(outRoot, safeName, 'app_store');
        await ensureDir(appDir);
        await writeJson(path.join(appDir, 'app-details.json'), details);
        result.appStore = { details, reviewCount: 0 };
      }

      log(`App Store: maximum coverage — ${iosRegions.length} regions (RSS + page HTML per region)…`);
      const trackViewUrl = result.appStore?.details?.url ?? null;
      let reviews;
      let lastLogged = 0;

      if (iosRegions.length > 1) {
        reviews = await fetchAppStoreReviewsAllRegions(app.appStoreId, {
          countries: iosRegions,
          trackViewUrl,
          onProgress: ({ completed, total, unique }) => {
            onLog?.({ type: 'progress', store: 'app_store', app: label, count: unique });
            if (completed - lastLogged >= 10 || completed === total) {
              lastLogged = completed;
              log(`App Store: ${completed}/${total} regions — ${unique.toLocaleString()} unique reviews…`);
            }
          },
        });
      } else {
        reviews = await fetchAllAppStoreReviews(app.appStoreId, {
          country: iosRegions[0],
          trackViewUrl,
          delayMs: 400,
        });
      }

      const appDir = path.join(outRoot, safeName, 'app_store');
      await ensureDir(appDir);
      await writeJson(path.join(appDir, 'reviews.json'), reviews);
      await writeCsv(path.join(appDir, 'reviews.csv'), reviews);

      result.appStore = {
        ...result.appStore,
        reviews,
        reviewCount: reviews.length,
      };
      result.pagination.appStore = {
        hasMore: false,
        fetched: reviews.length,
        platformMax: APP_STORE_MAX * iosRegions.length,
        storeCountry: maxCoverage ? 'all' : iosRegions.length === 1 ? iosRegions[0] : iosRegions.join(','),
        maxCoverage: Boolean(maxCoverage),
      };

      log(`App Store: done — ${reviews.length} unique reviews (${iosLabel})`);
    } catch (error) {
      const message = error?.message ?? String(error);
      result.errors.push({ store: 'app_store', message });
      log(`App Store error: ${message}`);
    }
  }

  onLog?.({ type: 'app_done', app: label, result });
  return result;
}

export async function fetchMoreReviewsForApp(appEntry, outRoot, { country, batchSize, onLog }) {
  const label = appEntry.name;
  const safeName = appEntry.safeName ?? sanitizeFilename(label);
  const log = (message) => onLog?.({ type: 'log', message, app: label });
  const updates = { pagination: { googlePlay: appEntry.googlePlay, appStore: appEntry.appStore } };

  if (appEntry.googlePlayId && appEntry.googlePlay?.hasMore) {
    try {
      log(`Google Play: fetching next ${batchSize.toLocaleString()} reviews...`);
      const existing = JSON.parse(
        await fs.readFile(path.join(outRoot, safeName, 'google_play', 'reviews.json'), 'utf8'),
      );
      const batch = await fetchGooglePlayReviewsBatch(appEntry.googlePlayId, {
        country,
        batchSize,
        continuationToken: appEntry.googlePlay.continuationToken,
      });
      const merged = [...existing, ...batch.reviews];
      const appDir = path.join(outRoot, safeName, 'google_play');
      await writeJson(path.join(appDir, 'reviews.json'), merged);
      await writeCsv(path.join(appDir, 'reviews.csv'), merged);

      updates.googlePlayReviews = merged.length;
      updates.pagination.googlePlay = {
        continuationToken: batch.continuationToken,
        hasMore: batch.hasMore,
        fetched: merged.length,
        platformMax: GOOGLE_PLAY_MAX,
        storeCountry: country,
      };
      log(`Google Play: now ${merged.length} total reviews${batch.hasMore ? ' (more available)' : ''}`);
    } catch (error) {
      log(`Google Play error: ${error.message ?? error}`);
      updates.errors = [{ store: 'google_play', message: error.message ?? String(error) }];
    }
  }

  if (appEntry.appStoreId && appEntry.appStore?.hasMore) {
    try {
      log(`App Store: fetching next ${batchSize} reviews...`);
      const existing = JSON.parse(
        await fs.readFile(path.join(outRoot, safeName, 'app_store', 'reviews.json'), 'utf8'),
      );
      const batch = await fetchAppStoreReviewsBatch(appEntry.appStoreId, {
        country,
        batchSize,
        startPage: appEntry.appStore.nextPage,
      });
      const merged = [...existing, ...batch.reviews];
      const appDir = path.join(outRoot, safeName, 'app_store');
      await writeJson(path.join(appDir, 'reviews.json'), merged);
      await writeCsv(path.join(appDir, 'reviews.csv'), merged);

      updates.appStoreReviews = merged.length;
      updates.pagination.appStore = {
        nextPage: batch.nextPage,
        hasMore: batch.hasMore,
        fetched: merged.length,
        platformMax: batch.platformMax,
      };
      log(`App Store: now ${merged.length} total reviews${batch.hasMore ? ' (more available)' : ''}`);
    } catch (error) {
      log(`App Store error: ${error.message ?? error}`);
      updates.errors = [{ store: 'app_store', message: error.message ?? String(error) }];
    }
  }

  return updates;
}

export async function runScrape({
  apps,
  countries,
  country = 'us',
  maxCoverage = false,
  outRoot: customOutRoot = null,
  onLog,
}) {
  if (!Array.isArray(apps) || apps.length === 0) {
    throw new Error('Add at least one app to scrape.');
  }

  const androidRegions = orderStoreCountries(resolveScrapeRegions({ countries, country, maxCoverage: false }));
  const iosRegions = orderStoreCountries(
    maxCoverage
      ? resolveScrapeRegions({ maxCoverage: true })
      : resolveScrapeRegions({ countries, country, maxCoverage: false }),
  );

  const outRoot = customOutRoot ?? outputDir();
  await ensureDir(outRoot);
  const runId = path.basename(outRoot);

  onLog?.({
    type: 'started',
    runId,
    outRoot,
    appCount: apps.length,
    country: maxCoverage ? `all ${iosRegions.length} iOS regions` : androidRegions.join(', '),
    countries: maxCoverage ? iosRegions : androidRegions,
    maxCoverage: Boolean(maxCoverage),
  });

  const paginationState = {
    runId,
    country: androidRegions[0],
    countries: maxCoverage ? iosRegions : androidRegions,
    maxCoverage: Boolean(maxCoverage),
    apps: [],
  };

  const summary = [];

  for (const app of apps) {
    const result = await scrapeApp(app, outRoot, { countries: androidRegions, maxCoverage, onLog });
    summary.push({
      name: result.name,
      googlePlayReviews: result.googlePlay?.reviewCount ?? null,
      appStoreReviews: result.appStore?.reviewCount ?? null,
      errors: result.errors,
    });

    paginationState.apps.push({
      name: result.name,
      safeName: result.safeName,
      googlePlayId: app.googlePlayId ?? null,
      appStoreId: app.appStoreId ?? null,
      googlePlay: result.pagination.googlePlay,
      appStore: result.pagination.appStore,
    });

    await sleep(500);
  }

  await writeJson(path.join(outRoot, PAGINATION_FILE), paginationState);
  const exportData = await mergeExports(outRoot, summary);

  const hasMore = paginationState.apps.some((a) => a.googlePlay?.hasMore || a.appStore?.hasMore);

  const payload = {
    runId,
    outRoot,
    summary,
    totalReviews: exportData.totalReviews,
    totalApps: summary.length,
    hasMore,
    country: maxCoverage ? `all ${iosRegions.length} iOS regions` : androidRegions.join(', '),
    countries: maxCoverage ? iosRegions : androidRegions,
    maxCoverage: Boolean(maxCoverage),
  };

  onLog?.({ type: 'complete', ...payload });
  return payload;
}

export async function fetchMoreReviews(runId, { batchSize = GOOGLE_PLAY_MAX, onLog } = {}) {
  const actualOutRoot = path.join(process.cwd(), 'output', runId);

  if (!(await fileExists(actualOutRoot))) {
    throw new Error('Run not found.');
  }

  const state = JSON.parse(await fs.readFile(path.join(actualOutRoot, PAGINATION_FILE), 'utf8'));
  const size = batchSize ?? state.batchSize ?? GOOGLE_PLAY_MAX;
  const country = state.countries?.[0] ?? state.country ?? 'us';

  let summary = [];
  try {
    summary = JSON.parse(await fs.readFile(path.join(actualOutRoot, 'summary.json'), 'utf8'));
  } catch {
    summary = state.apps.map((a) => ({ name: a.name }));
  }

  for (const appEntry of state.apps) {
    const updates = await fetchMoreReviewsForApp(appEntry, actualOutRoot, {
      country,
      batchSize: size,
      onLog,
    });

    if (updates.googlePlayReviews != null) {
      appEntry.googlePlay = updates.pagination.googlePlay;
    }
    if (updates.appStoreReviews != null) {
      appEntry.appStore = updates.pagination.appStore;
    }

    const summaryEntry = summary.find((s) => s.name === appEntry.name);
    if (summaryEntry) {
      if (updates.googlePlayReviews != null) summaryEntry.googlePlayReviews = updates.googlePlayReviews;
      if (updates.appStoreReviews != null) summaryEntry.appStoreReviews = updates.appStoreReviews;
    }
  }

  state.batchSize = size;
  await writeJson(path.join(actualOutRoot, PAGINATION_FILE), state);
  const exportData = await mergeExports(actualOutRoot, summary);

  const hasMore = state.apps.some((a) => a.googlePlay?.hasMore || a.appStore?.hasMore);

  const payload = {
    runId,
    summary,
    totalReviews: exportData.totalReviews,
    hasMore,
    batchSize: size,
  };

  onLog?.({ type: 'complete', ...payload });
  return payload;
}

async function mergeExports(outRoot, summary) {
  const allReviews = [];
  const allDetails = [];

  let scrapeCountry = 'us';
  try {
    const state = JSON.parse(await fs.readFile(path.join(outRoot, PAGINATION_FILE), 'utf8'));
    scrapeCountry = state.countries?.join(', ') ?? state.country ?? 'us';
  } catch {
    // no pagination file
  }

  for (const entry of summary) {
    const safeName = sanitizeFilename(entry.name);
    const paths = [
      ['google_play', path.join(outRoot, safeName, 'google_play', 'reviews.json'), path.join(outRoot, safeName, 'google_play', 'app-details.json')],
      ['app_store', path.join(outRoot, safeName, 'app_store', 'reviews.json'), path.join(outRoot, safeName, 'app_store', 'app-details.json')],
    ];

    for (const [store, reviewsPath, detailsPath] of paths) {
      let detailsCountry = scrapeCountry;
      try {
        const details = JSON.parse(await fs.readFile(detailsPath, 'utf8'));
        allDetails.push({ appName: entry.name, ...details });
        detailsCountry = details.storeCountry ?? scrapeCountry;
      } catch {
        // not scraped
      }
      try {
        const reviews = JSON.parse(await fs.readFile(reviewsPath, 'utf8'));
        allReviews.push(
          ...reviews.map((r) => ({
            appName: entry.name,
            ...r,
            storeCountry: r.storeCountry ?? detailsCountry,
          })),
        );
      } catch {
        // not scraped
      }
    }
  }

  await writeJson(path.join(outRoot, 'summary.json'), summary);
  await writeJson(path.join(outRoot, 'all-reviews.json'), allReviews);
  await writeCsv(path.join(outRoot, 'all-reviews.csv'), allReviews);
  await writeJson(path.join(outRoot, 'all-app-details.json'), allDetails);
  await writeCsv(path.join(outRoot, 'all-app-details.csv'), allDetails.map(flattenAppDetailsForCsv));

  return { totalReviews: allReviews.length, allReviews, allDetails };
}

export async function getPaginationState(runId) {
  const runPath = path.join(process.cwd(), 'output', runId);
  const statePath = path.join(runPath, PAGINATION_FILE);
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function listRuns(outputBase = path.join(process.cwd(), 'output')) {
  try {
    const entries = await fs.readdir(outputBase, { withFileTypes: true });
    const runs = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runPath = path.join(outputBase, entry.name);
      let summary = null;
      let totalReviews = 0;
      let hasMore = false;

      try {
        summary = JSON.parse(await fs.readFile(path.join(runPath, 'summary.json'), 'utf8'));
        const allReviews = JSON.parse(await fs.readFile(path.join(runPath, 'all-reviews.json'), 'utf8'));
        totalReviews = allReviews.length;
      } catch {
        // incomplete run
      }

      try {
        const state = JSON.parse(await fs.readFile(path.join(runPath, PAGINATION_FILE), 'utf8'));
        hasMore = state.apps?.some((a) => a.googlePlay?.hasMore || a.appStore?.hasMore) ?? false;
      } catch {
        // no pagination state
      }

      runs.push({
        runId: entry.name,
        summary,
        totalReviews,
        hasSummary: Boolean(summary),
        hasMore,
      });
    }

    return runs.sort((a, b) => b.runId.localeCompare(a.runId));
  } catch {
    return [];
  }
}

function flattenAppDetailsForCsv(details) {
  return {
    appName: details.appName,
    store: details.store,
    appId: details.appId,
    title: details.title,
    developer: details.developer,
    score: details.score,
    ratingsCount: details.ratingsCount,
    reviewsCount: details.reviewsCount,
    description: details.description,
    storeCountry: details.storeCountry ?? '',
    termsOfService: details.termsOfService ?? '',
    privacyPolicy: details.privacyPolicy ?? '',
    developerWebsite: details.developerWebsite ?? '',
    url: details.url,
  };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
