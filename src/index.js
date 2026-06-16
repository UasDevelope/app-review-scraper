import fs from 'fs/promises';
import path from 'path';
import { runScrape } from './scraper.js';
import { STORE_COUNTRIES, normalizeStoreCountry } from './countries.js';

const APPS_FILE = process.argv[2] ?? 'apps.json';
const COUNTRY = getArgValue('--country', 'us');

function getArgValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) return fallback;
  return value;
}

async function loadApps() {
  const filePath = path.resolve(process.cwd(), APPS_FILE);
  const raw = await fs.readFile(filePath, 'utf8');
  const apps = JSON.parse(raw);

  if (!Array.isArray(apps) || apps.length === 0) {
    throw new Error(`No apps found in ${APPS_FILE}. Copy apps.example.json to apps.json and add your apps.`);
  }

  return apps;
}

async function main() {
  const country = normalizeStoreCountry(COUNTRY);
  console.log('App Store & Google Play Scraper');
  console.log(`Config: ${APPS_FILE} | Country: ${country} (${STORE_COUNTRIES.length} storefronts available)`);

  const apps = await loadApps();
  console.log(`Apps to scrape: ${apps.length}`);

  const result = await runScrape({
    apps,
    country,
    onLog: (event) => {
      if (event.type === 'log') console.log(event.message);
      if (event.type === 'started') console.log(`Output folder: ${event.outRoot}`);
      if (event.type === 'complete') {
        console.log('\n=== Complete ===');
        console.log(`Total reviews exported: ${event.totalReviews}`);
        console.log(`Results saved to: ${event.outRoot}`);
      }
    },
  });

  return result;
}

main().catch((error) => {
  console.error('\nFatal error:', error.message ?? error);
  process.exit(1);
});
