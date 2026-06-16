import { fetchAppStoreAppDetails, fetchAllAppStoreReviews } from './scrape-app-store.js';
import { fetchGooglePlayAppDetails, fetchAllGooglePlayReviews } from './scrape-google-play.js';
import { parseStoreUrl } from './resolve-url.js';

const tests = [
  {
    name: 'Zoom iOS',
    run: async () => {
      const details = await fetchAppStoreAppDetails(546505307);
      const reviews = await fetchAllAppStoreReviews(546505307);
      assert(details.title, 'missing title');
      assert(details.description, 'missing description');
      assert(reviews.length > 0, 'no reviews');
      assert(reviews[0].rating && reviews[0].text !== undefined, 'review missing rating/text');
      console.log(`  title: ${details.title}`);
      console.log(`  reviews: ${reviews.length}`);
      console.log(`  terms: ${details.termsOfService ?? 'not found'}`);
      console.log(`  privacy: ${details.privacyPolicy ?? 'not found'}`);
    },
  },
  {
    name: 'Zoom Android',
    run: async () => {
      const details = await fetchGooglePlayAppDetails('us.zoom.videomeetings');
      const reviews = await fetchAllGooglePlayReviews('us.zoom.videomeetings', { maxReviews: 5 });
      assert(details.title, 'missing title');
      assert(details.description, 'missing description');
      assert(reviews.length === 5, 'expected 5 reviews');
      console.log(`  title: ${details.title}`);
      console.log(`  reviews: ${reviews.length}`);
      console.log(`  privacy: ${details.privacyPolicy ?? 'not found'}`);
    },
  },
  {
    name: 'URL parser',
    run: async () => {
      const gp = parseStoreUrl('https://play.google.com/store/apps/details?id=com.zhiliaoapp.musically');
      const ios = parseStoreUrl('https://apps.apple.com/us/app/zoom-workplace/id546505307');
      assert(gp.googlePlayId === 'com.zhiliaoapp.musically', 'bad google id');
      assert(ios.appStoreId === 546505307, 'bad app store id');
      console.log('  Google Play + App Store URL parsing OK');
    },
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('Running scraper verification...\n');

let passed = 0;
for (const test of tests) {
  process.stdout.write(`• ${test.name}... `);
  try {
    await test.run();
    passed += 1;
    console.log('OK\n');
  } catch (error) {
    console.log('FAILED');
    console.error(`  ${error.message}\n`);
    process.exitCode = 1;
  }
}

console.log(`${passed}/${tests.length} checks passed`);
