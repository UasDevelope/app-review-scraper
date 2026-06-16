import { fetchAllAppStoreReviews, fetchAppStoreAppDetails } from './scrape-app-store.js';
import { fetchAllGooglePlayReviews, fetchGooglePlayAppDetails } from './scrape-google-play.js';

const IOS_APPS = [
  { name: 'SoulTalk', appStoreId: 6504914846 },
  { name: 'Interactive Girlfriend Date.AI', appStoreId: 6503018938 },
  { name: 'AI Friend', appStoreId: 6445799347 },
  { name: 'Replika', appStoreId: 1158555867 },
  { name: 'Wysa', appStoreId: 1166585565 },
  { name: 'MyFitnessPal', appStoreId: 341232718 },
  { name: 'Cal AI', appStoreId: 6480417616 },
  { name: 'Noom', appStoreId: 634598719 },
];

const ANDROID_APPS = [
  { name: 'Replika', googlePlayId: 'ai.replika.app' },
  { name: 'Paradot', googlePlayId: 'com.withfeelingai.test' },
  { name: 'Nomi', googlePlayId: 'ai.nomi.twa' },
  { name: 'Friends', googlePlayId: 'com.slay.pengu' },
  { name: 'AI Chatbot', googlePlayId: 'com.scaleup.chatai' },
  { name: 'MyFitnessPal', googlePlayId: 'com.myfitnesspal.android' },
  { name: 'Map My Fitness', googlePlayId: 'com.mapmyfitness.android2' },
];

const COUNTRY = 'us';
const SAMPLE = 5;

async function testIos(app) {
  try {
    await fetchAppStoreAppDetails(app.appStoreId, { country: COUNTRY });
    const reviews = await fetchAllAppStoreReviews(app.appStoreId, {
      country: COUNTRY,
      maxReviews: SAMPLE,
    });
    return {
      ok: true,
      reviews: reviews.length,
      sampleRating: reviews[0]?.rating ?? '—',
    };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

async function testAndroid(app) {
  try {
    await fetchGooglePlayAppDetails(app.googlePlayId, { country: COUNTRY });
    const reviews = await fetchAllGooglePlayReviews(app.googlePlayId, {
      country: COUNTRY,
      maxReviews: SAMPLE,
      delayMs: 200,
    });
    return {
      ok: true,
      reviews: reviews.length,
      sampleRating: reviews[0]?.rating ?? '—',
    };
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

console.log(`Review fetch test — country: ${COUNTRY}, sample: ${SAMPLE} reviews each\n`);

const results = [];

console.log('App Store (iOS):');
for (const app of IOS_APPS) {
  const r = await testIos(app);
  results.push({ ...app, store: 'ios', ...r });
  if (r.ok) {
    console.log(`  ✓ ${app.name} — ${r.reviews} reviews fetched (sample rating: ${r.sampleRating})`);
  } else {
    console.log(`  ✗ ${app.name} — ${r.error}`);
  }
}

console.log('\nGoogle Play (Android):');
for (const app of ANDROID_APPS) {
  const r = await testAndroid(app);
  results.push({ ...app, store: 'android', ...r });
  if (r.ok) {
    console.log(`  ✓ ${app.name} — ${r.reviews} reviews fetched (sample rating: ${r.sampleRating})`);
  } else {
    console.log(`  ✗ ${app.name} — ${r.error}`);
  }
}

const passed = results.filter((r) => r.ok).length;
const withReviews = results.filter((r) => r.ok && r.reviews > 0).length;
const empty = results.filter((r) => r.ok && r.reviews === 0);

console.log(`\n=== Summary ===`);
console.log(`Passed: ${passed}/${results.length}`);
console.log(`Fetched reviews: ${withReviews}/${results.length}`);
if (empty.length) {
  console.log(`No reviews returned (app may have 0 public reviews in ${COUNTRY}):`);
  empty.forEach((r) => console.log(`  - ${r.name} (${r.store})`));
}

if (passed < results.length) process.exit(1);
