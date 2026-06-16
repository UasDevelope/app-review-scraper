const URL_PATTERN = /https?:\/\/[^\s)\]"'<>]+/gi;

const TERMS_LABELS = [
  /terms of service/i,
  /terms of use/i,
  /terms and conditions/i,
  /terms & conditions/i,
  /license agreement/i,
  /user agreement/i,
  /\beula\b/i,
];

const PRIVACY_LABELS = [
  /privacy policy/i,
  /privacy statement/i,
  /privacy notice/i,
];

export function extractLegalLinks(text = '') {
  const result = {
    termsOfService: null,
    privacyPolicy: null,
    legalLinksFound: [],
  };

  if (!text) return result;

  const allUrls = [...new Set(text.match(URL_PATTERN)?.map(cleanUrl) ?? [])];
  result.legalLinksFound = allUrls.filter((url) => {
    const lower = url.toLowerCase();
    return /terms|privacy|legal|license|eula/.test(lower);
  });

  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    const block = [line, lines[i + 1]?.trim() ?? '', lines[i + 2]?.trim() ?? ''].join('\n');
    const blockUrls = [...new Set(block.match(URL_PATTERN)?.map(cleanUrl) ?? [])];

    const isTermsLine = TERMS_LABELS.some((pattern) => pattern.test(line));
    const isPrivacyLine = PRIVACY_LABELS.some((pattern) => pattern.test(line));
    const isCombinedLine = /privacy\s*&\s*terms|terms\s*&\s*privacy/i.test(line);

    if (isCombinedLine && blockUrls.length >= 2) {
      for (const url of blockUrls) {
        assignUrlByHint(result, url);
      }
      continue;
    }

    if (isTermsLine && !isPrivacyLine && blockUrls.length) {
      result.termsOfService ??= pickTermsUrl(blockUrls);
    }

    if (isPrivacyLine && !isTermsLine && blockUrls.length) {
      result.privacyPolicy ??= pickPrivacyUrl(blockUrls);
    }
  }

  for (const url of allUrls) {
    assignUrlByHint(result, url);
  }

  return result;
}

function assignUrlByHint(result, url) {
  const lower = url.toLowerCase();
  if (!result.termsOfService && /\/terms|terms-of|terms_of|user-agreement|license|eula/.test(lower) && !/privacy/.test(lower)) {
    result.termsOfService = url;
  }
  if (!result.privacyPolicy && /privacy/.test(lower)) {
    result.privacyPolicy = url;
  }
}

function pickTermsUrl(urls) {
  return urls.find((url) => /terms|license|eula|user-agreement/i.test(url) && !/privacy/i.test(url)) ?? urls[0];
}

function pickPrivacyUrl(urls) {
  return urls.find((url) => /privacy/i.test(url)) ?? urls[0];
}

export function mergeLegalFields(base = {}, description = '', extras = {}) {
  const extracted = extractLegalLinks(description);

  return {
    termsOfService: extras.termsOfService ?? base.termsOfService ?? extracted.termsOfService ?? null,
    privacyPolicy: extras.privacyPolicy ?? base.privacyPolicy ?? extracted.privacyPolicy ?? null,
    developerWebsite: extras.developerWebsite ?? base.developerWebsite ?? null,
    legalLinksFound: extracted.legalLinksFound,
  };
}

function cleanUrl(url) {
  return url.replace(/[.,;]+$/, '');
}
