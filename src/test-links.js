import { parseStoreUrl, resolveStoreUrl } from './resolve-url.js';

const IOS_LINKS = [
  'https://apps.apple.com/us/app/soultalk-ai-friends-chat/id6504914846',
  'https://apps.apple.com/us/app/interactive-girlfriend-date-ai/id6503018938',
  'https://apps.apple.com/us/app/ai-friend-virtual-assist/id6445799347',
  'https://apps.apple.com/us/app/replika-ai-friend/id1158555867',
  'https://apps.apple.com/us/app/wysa-mental-wellbeing-ai/id1166585565',
  'https://apps.apple.com/us/app/myfitnesspal-calorie-counter/id341232718',
  'https://apps.apple.com/us/app/cal-ai-calorie-tracker/id6480417616',
  'https://apps.apple.com/us/app/noom-weight-loss-food-tracker/id634598719',
];

const ANDROID_LINKS = [
  'https://play.google.com/store/apps/details?id=ai.replika.app',
  'https://play.google.com/store/apps/details?id=com.withfeelingai.test',
  'https://play.google.com/store/apps/details?id=ai.nomi.twa',
  'https://play.google.com/store/apps/details?id=com.slay.pengu',
  'https://play.google.com/store/apps/details?id=com.scaleup.chatai',
  'https://play.google.com/store/apps/details?id=com.myfitnesspal.android',
  'https://play.google.com/store/apps/details?id=com.mapmyfitness.android2',
];

async function testLink(url, expectedStore) {
  const parsed = parseStoreUrl(url);
  if (parsed.error) {
    return { url, ok: false, stage: 'parse', error: parsed.error };
  }
  if (parsed.store !== expectedStore) {
    return { url, ok: false, stage: 'parse', error: `Expected ${expectedStore}, got ${parsed.store}` };
  }

  try {
    const resolved = await resolveStoreUrl(url, { country: 'us' });
    if (resolved.error) {
      return { url, ok: false, stage: 'lookup', error: resolved.error };
    }
    return {
      ok: true,
      store: resolved.store,
      name: resolved.name,
      googlePlayId: resolved.googlePlayId || '—',
      appStoreId: resolved.appStoreId || '—',
    };
  } catch (err) {
    return { url, ok: false, stage: 'lookup', error: err.message ?? String(err) };
  }
}

console.log('Testing App Store links (8)...\n');
const iosResults = [];
for (const url of IOS_LINKS) {
  const r = await testLink(url, 'app_store');
  iosResults.push(r);
  const id = url.match(/id(\d+)/)?.[1];
  if (r.ok) console.log(`✓ ${r.name} (id ${id})`);
  else console.log(`✗ id ${id} — ${r.stage}: ${r.error}`);
}

console.log('\nTesting Google Play links (7)...\n');
const androidResults = [];
for (const url of ANDROID_LINKS) {
  const r = await testLink(url, 'google_play');
  androidResults.push(r);
  const id = new URL(url).searchParams.get('id');
  if (r.ok) console.log(`✓ ${r.name} (${id})`);
  else console.log(`✗ ${id} — ${r.stage}: ${r.error}`);
}

const passed = [...iosResults, ...androidResults].filter((r) => r.ok).length;
const total = iosResults.length + androidResults.length;
console.log(`\n=== ${passed}/${total} links OK ===`);

if (passed < total) process.exit(1);
