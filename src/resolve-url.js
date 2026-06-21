import { fetchAppStoreAppDetails } from './scrape-app-store.js';
import { fetchGooglePlayAppDetails } from './scrape-google-play.js';

export function parseStoreUrl(input) {
  const raw = input.trim();
  if (!raw) return { error: 'Empty URL' };

  let url;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return { error: 'Invalid URL' };
  }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'play.google.com' || host === 'market.android.com') {
    const appId = url.searchParams.get('id');
    if (!appId) return { error: 'No Google Play app ID found in URL (expected id=...)' };
    return { store: 'google_play', googlePlayId: appId, country: url.searchParams.get('gl') || 'us' };
  }

  if (host.includes('apple.com')) {
    const match = url.pathname.match(/id(\d+)/);
    if (!match) return { error: 'No App Store ID found in URL (expected .../id123456789)' };
    return { store: 'app_store', appStoreId: Number(match[1]), country: extractAppleCountry(url.pathname) };
  }

  return { error: 'Unsupported link. Use a Google Play or App Store URL.' };
}

function extractAppleCountry(pathname) {
  const match = pathname.match(/^\/([a-z]{2})\//);
  return match?.[1] ?? 'us';
}

function simplifyTitle(title) {
  return title
    .replace(/\s*[-–—|:].*$/, '')
    .replace(/\s+(for|on)\s+(android|ios|iphone|ipad).*$/i, '')
    .trim();
}

export async function resolveStoreUrl(input, { country = 'us' } = {}) {
  const parsed = parseStoreUrl(input);
  if (parsed.error) return parsed;

  const lookupCountry = parsed.country || country;

  if (parsed.store === 'google_play') {
    const details = await fetchGooglePlayAppDetails(parsed.googlePlayId, { country: lookupCountry });
    return {
      store: 'google_play',
      name: simplifyTitle(details.title),
      googlePlayId: parsed.googlePlayId,
      appStoreId: '',
      note: 'Add an App Store link too if you want iOS reviews for this app.',
    };
  }

  const details = await fetchAppStoreAppDetails(parsed.appStoreId, { country: lookupCountry });
  return {
    store: 'app_store',
    name: simplifyTitle(details.title),
    googlePlayId: '',
    appStoreId: parsed.appStoreId,
    note: 'Add a Google Play link too if you want Android reviews for this app.',
  };
}
