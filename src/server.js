import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import { listRuns, runScrape, fetchMoreReviews, getPaginationState, buildAppInfoExport } from './scraper.js';
import { resolveStoreUrl } from './resolve-url.js';
import { STORE_COUNTRIES, isValidStoreCountry, normalizeStoreCountry, normalizeStoreCountries, resolveScrapeRegions } from './countries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const PUBLIC_DIR = path.join(ROOT, 'public');

const PORT = process.env.PORT ?? 3456;
const SERVER_VERSION = '2.2-full-fetch';
const SERVER_STARTED_AT = Date.now();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(PUBLIC_DIR));

let activeJob = null;

function createJob() {
  return {
    id: Date.now().toString(36),
    status: 'queued',
    logs: [],
    progress: {},
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

function pushLog(job, event) {
  if (event.type === 'log') {
    job.logs.push({ time: new Date().toISOString(), message: event.message });
  }
  if (event.type === 'progress') {
    job.progress[`${event.app}:${event.store}`] = event.count;
    const storeLabel = event.store === 'google_play' ? 'Android' : 'iOS';
    job.progressLabel = `${event.app} (${storeLabel}): ${event.count.toLocaleString()} reviews…`;
  }
  if (event.type === 'started') {
    job.status = 'running';
    job.runId = event.runId;
    job.logs.push({
      time: new Date().toISOString(),
      message: `Run started — ${event.appCount} app(s), regions: ${event.country}`,
    });
  }
  if (event.type === 'complete') {
    job.status = 'complete';
    job.result = event;
    job.finishedAt = new Date().toISOString();
  }
}

app.get('/api/countries', (_req, res) => {
  res.json({ countries: STORE_COUNTRIES });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    busy: Boolean(activeJob?.status === 'running'),
    version: SERVER_VERSION,
    mode: 'full-fetch',
    startedAt: SERVER_STARTED_AT,
  });
});

app.get('/api/job', (_req, res) => {
  if (!activeJob) return res.json({ job: null });
  res.json({ job: activeJob });
});

app.get('/api/runs', async (_req, res) => {
  const runs = await listRuns(OUTPUT_DIR);
  res.json({ runs });
});

app.get('/api/runs/:runId/summary', async (req, res) => {
  try {
    const runPath = path.join(OUTPUT_DIR, req.params.runId);
    const summary = JSON.parse(await fsp.readFile(path.join(runPath, 'summary.json'), 'utf8'));
    res.json({ summary });
  } catch {
    res.status(404).json({ error: 'Run not found' });
  }
});

app.get('/api/runs/:runId/preview', async (req, res) => {
  try {
    const runPath = path.join(OUTPUT_DIR, req.params.runId);
    const page = Math.max(1, Number(req.query.page) || 1);
    const allowedLimits = [10, 20, 50, 100];
    const requested = Number(req.query.limit) || 20;
    const limit = allowedLimits.includes(requested) ? requested : 20;
    const reviews = JSON.parse(await fsp.readFile(path.join(runPath, 'all-reviews.json'), 'utf8'));
    const details = JSON.parse(await fsp.readFile(path.join(runPath, 'all-app-details.json'), 'utf8'));
    const dated = reviews.filter((r) => r.date).map((r) => r.date).sort();
    const dateRange = dated.length
      ? { oldest: dated[0].slice(0, 10), newest: dated[dated.length - 1].slice(0, 10) }
      : null;
    const totalPages = Math.max(1, Math.ceil(reviews.length / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;
    res.json({
      reviews: reviews.slice(start, start + limit),
      totalReviews: reviews.length,
      appDetails: details,
      dateRange,
      page: safePage,
      limit,
      totalPages,
    });
  } catch {
    res.status(404).json({ error: 'Run not found' });
  }
});

const ALLOWED_FILES = new Set([
  'all-reviews.csv',
  'all-reviews.json',
  'all-app-details.json',
  'all-app-details.csv',
  'app-info.json',
  'app-info.csv',
  'summary.json',
]);

async function loadAppInfoForRun(runId) {
  const runPath = path.join(OUTPUT_DIR, runId);
  const infoPath = path.join(runPath, 'app-info.json');
  if (fs.existsSync(infoPath)) {
    return JSON.parse(await fsp.readFile(infoPath, 'utf8'));
  }
  const detailsPath = path.join(runPath, 'all-app-details.json');
  if (!fs.existsSync(detailsPath)) return null;
  const details = JSON.parse(await fsp.readFile(detailsPath, 'utf8'));
  return buildAppInfoExport(details);
}

app.get('/api/runs/:runId/download/:filename', async (req, res) => {
  const filename = req.params.filename;
  if (!ALLOWED_FILES.has(filename)) {
    return res.status(400).json({ error: 'Invalid file' });
  }

  const runPath = path.join(OUTPUT_DIR, req.params.runId);
  const filePath = path.join(runPath, filename);

  if (filename === 'app-info.json' || filename === 'app-info.csv') {
    const appInfo = await loadAppInfoForRun(req.params.runId);
    if (!appInfo?.length) {
      return res.status(404).json({ error: 'No app details found for this run' });
    }
    if (filename === 'app-info.json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="app-info.json"');
      return res.send(JSON.stringify(appInfo, null, 2));
    }
    const { toCsv } = await import('./utils.js');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="app-info.csv"');
    return res.send(toCsv(appInfo));
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filePath, filename);
});

app.get('/api/runs/:runId/download-zip', async (req, res) => {
  const runPath = path.join(OUTPUT_DIR, req.params.runId);
  if (!fs.existsSync(runPath)) {
    return res.status(404).json({ error: 'Run not found' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.runId}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => res.status(500).end(err.message));
  archive.pipe(res);
  archive.directory(runPath, false);
  await archive.finalize();
});

app.get('/api/runs/:runId/download-info-zip', async (req, res) => {
  const runId = req.params.runId;
  const runPath = path.join(OUTPUT_DIR, runId);
  if (!fs.existsSync(runPath)) {
    return res.status(404).json({ error: 'Run not found' });
  }

  const appInfo = await loadAppInfoForRun(runId);
  if (!appInfo?.length) {
    return res.status(404).json({ error: 'No app details found for this run' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${runId}-app-info.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => res.status(500).end(err.message));
  archive.pipe(res);

  const jsonPath = path.join(runPath, 'app-info.json');
  const csvPath = path.join(runPath, 'app-info.csv');
  if (fs.existsSync(jsonPath)) archive.file(jsonPath, { name: 'app-info.json' });
  else archive.append(JSON.stringify(appInfo, null, 2), { name: 'app-info.json' });

  if (fs.existsSync(csvPath)) archive.file(csvPath, { name: 'app-info.csv' });
  else {
    const { toCsv } = await import('./utils.js');
    archive.append(toCsv(appInfo), { name: 'app-info.csv' });
  }

  await archive.finalize();
});

app.post('/api/resolve-url', async (req, res) => {
  const { url, country = 'us' } = req.body ?? {};
  if (!url?.trim()) {
    return res.status(400).json({ error: 'Paste a store URL.' });
  }

  if (!isValidStoreCountry(country)) {
    return res.status(400).json({ error: 'Invalid country code.' });
  }

  try {
    const resolved = await resolveStoreUrl(url, { country: normalizeStoreCountry(country) });
    if (resolved.error) return res.status(400).json(resolved);
    res.json(resolved);
  } catch (error) {
    res.status(500).json({ error: error.message ?? String(error) });
  }
});

app.get('/api/runs/:runId/pagination', async (req, res) => {
  const state = await getPaginationState(req.params.runId);
  if (!state) return res.status(404).json({ error: 'Run not found' });
  const hasMore = state.apps?.some((a) => a.googlePlay?.hasMore || a.appStore?.hasMore) ?? false;
  res.json({ state, hasMore });
});

app.post('/api/runs/:runId/fetch-more', async (req, res) => {
  if (activeJob?.status === 'running') {
    return res.status(409).json({ error: 'A scrape is already running. Please wait.' });
  }

  const { batchSize = 5000 } = req.body ?? {};
  const job = createJob();
  activeJob = job;
  res.json({ jobId: job.id, message: 'Fetching next batch' });

  try {
    await fetchMoreReviews(req.params.runId, {
      batchSize: Number(batchSize) || 5000,
      onLog: (event) => pushLog(job, event),
    });
  } catch (error) {
    job.status = 'error';
    job.error = error.message ?? String(error);
    job.finishedAt = new Date().toISOString();
    job.logs.push({ time: new Date().toISOString(), message: `Error: ${job.error}` });
  }
});

app.post('/api/scrape', async (req, res) => {
  if (activeJob?.status === 'running') {
    return res.status(409).json({ error: 'A scrape is already running. Please wait.' });
  }

  const { apps, countries, country = 'us', maxCoverage = false } = req.body ?? {};
  const regions = maxCoverage
    ? resolveScrapeRegions({ maxCoverage: true })
    : normalizeStoreCountries(countries ?? country);

  if (!regions.length) {
    return res.status(400).json({ error: 'Select at least one valid country.' });
  }

  if (!Array.isArray(apps) || apps.length === 0) {
    return res.status(400).json({ error: 'Add at least one app.' });
  }

  for (const app of apps) {
    if (!app.name?.trim()) {
      return res.status(400).json({ error: 'Each app needs a name.' });
    }
    if (!app.googlePlayId && !app.appStoreId) {
      return res.status(400).json({ error: `${app.name}: provide Google Play ID and/or App Store ID.` });
    }
  }

  const job = createJob();
  activeJob = job;
  res.json({ jobId: job.id, message: 'Scrape started' });

  try {
    await runScrape({
      apps: apps.map((app) => ({
        name: app.name.trim(),
        googlePlayId: app.googlePlayId?.trim() || undefined,
        appStoreId: app.appStoreId ? Number(app.appStoreId) : undefined,
      })),
      countries: regions,
      maxCoverage: Boolean(maxCoverage),
      onLog: (event) => pushLog(job, event),
    });
  } catch (error) {
    job.status = 'error';
    job.error = error.message ?? String(error);
    job.finishedAt = new Date().toISOString();
    job.logs.push({ time: new Date().toISOString(), message: `Error: ${job.error}` });
  }
});

await fsp.mkdir(OUTPUT_DIR, { recursive: true });

const HOST = process.env.HOST ?? '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`\n  App Review Scraper UI v${SERVER_VERSION}`);
  console.log(`  Open in browser: http://localhost:${PORT}\n`);
});
