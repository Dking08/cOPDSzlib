/**
 * Z-Library scraper with mirror rotation & proxy support
 * Handles search, download, formats, and cover proxying
 */

const auth = require('./auth');

// ── Z-Library mirrors (ordered by reliability) ────────────────
const MIRRORS = [
  'https://z-lib.fm',
  'https://z-lib.sk',
  'https://z-library.gs',
  'https://1lib.sk',
  'https://z-lib.gd',
  'https://z-lib.gl',
  'https://zliba.ru',
];

let currentMirrorIdx = 0;
let mirrorFailCounts = new Map();
const MIRROR_MAX_FAILS = 3;

function getMirror() {
  return MIRRORS[currentMirrorIdx];
}

function rotateMirror(reason) {
  const failed = MIRRORS[currentMirrorIdx];
  const fails = (mirrorFailCounts.get(failed) || 0) + 1;
  mirrorFailCounts.set(failed, fails);

  // Find next mirror that hasn't exceeded fail limit
  for (let i = 1; i <= MIRRORS.length; i++) {
    const nextIdx = (currentMirrorIdx + i) % MIRRORS.length;
    const nextMirror = MIRRORS[nextIdx];
    if ((mirrorFailCounts.get(nextMirror) || 0) < MIRROR_MAX_FAILS) {
      currentMirrorIdx = nextIdx;
      console.log(`[Mirror] Rotated from ${failed} → ${nextMirror} (reason: ${reason})`);
      return nextMirror;
    }
  }

  // All mirrors exhausted, reset counts and start over
  mirrorFailCounts.clear();
  currentMirrorIdx = 0;
  console.log('[Mirror] All mirrors exhausted, resetting to', MIRRORS[0]);
  return MIRRORS[0];
}

function getMirrorStatus() {
  return MIRRORS.map((m, i) => ({
    url: m,
    active: i === currentMirrorIdx,
    fails: mirrorFailCounts.get(m) || 0,
  }));
}

function setMirror(url) {
  const idx = MIRRORS.indexOf(url);
  if (idx !== -1) {
    currentMirrorIdx = idx;
    return true;
  }
  // Allow custom mirror
  if (!MIRRORS.includes(url)) {
    MIRRORS.push(url);
    currentMirrorIdx = MIRRORS.length - 1;
  }
  return true;
}

// ── HTTP configuration ────────────────────────────────────────

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  DNT: '1',
  'Upgrade-Insecure-Requests': '1',
};

// Optional proxy support
let proxyAgent = null;

/**
 * Configure an HTTP/SOCKS proxy for all z-lib requests
 * @param {string} proxyUrl - e.g. "http://user:pass@host:port" or "socks5://host:port"
 */
async function setProxy(proxyUrl) {
  if (!proxyUrl) {
    proxyAgent = null;
    console.log('[Proxy] Proxy disabled');
    return { success: true, message: 'Proxy disabled' };
  }

  try {
    if (proxyUrl.startsWith('socks')) {
      const { SocksProxyAgent } = require('socks-proxy-agent');
      proxyAgent = new SocksProxyAgent(proxyUrl);
    } else {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      proxyAgent = new HttpsProxyAgent(proxyUrl);
    }
    console.log('[Proxy] Configured:', proxyUrl.replace(/\/\/.*@/, '//***@'));
    return { success: true, message: 'Proxy configured' };
  } catch (err) {
    console.error('[Proxy] Failed to configure:', err.message);
    return { success: false, message: `Proxy error: ${err.message}. Install socks-proxy-agent or https-proxy-agent.` };
  }
}

function getProxyStatus() {
  return { enabled: !!proxyAgent, type: proxyAgent ? proxyAgent.constructor.name : null };
}

/**
 * Build request headers with auth cookies
 */
function buildHeaders(extra = {}) {
  const headers = { ...DEFAULT_HEADERS, ...extra };
  const cookie = auth.getCookieHeader();
  if (cookie) headers['Cookie'] = cookie;
  return headers;
}

/**
 * Make a fetch request with optional proxy support
 */
async function proxyFetch(url, options = {}) {
  // Node's native fetch doesn't support agent directly,
  // so if proxy is enabled we use the http/https module approach
  if (proxyAgent) {
    const { default: nodeFetch } = await import('node-fetch');
    return nodeFetch(url, { ...options, agent: proxyAgent });
  }
  return fetch(url, options);
}

// ── Search ────────────────────────────────────────────────────

async function fetchSearchPage(query, page = 1) {
  const encoded = encodeURIComponent(query);
  const base = getMirror();
  let url = `${base}/s/${encoded}`;
  if (page > 1) url += `?page=${page}`;

  try {
    const res = await proxyFetch(url, { headers: buildHeaders(), redirect: 'follow' });
    auth.storeCookiesFromResponse(res);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } catch (err) {
    console.error(`[Search] Failed on ${base}: ${err.message}`);
    rotateMirror('search-fail');
    // Retry once on next mirror
    const newBase = getMirror();
    url = `${newBase}/s/${encoded}`;
    if (page > 1) url += `?page=${page}`;
    const res = await proxyFetch(url, { headers: buildHeaders(), redirect: 'follow' });
    auth.storeCookiesFromResponse(res);
    if (!res.ok) throw new Error(`Search failed on retry: ${res.status}`);
    return await res.text();
  }
}

function parseSearchResults(html) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const books = [];

  $('z-bookcard').each((_i, el) => {
    const $el = $(el);
    const id = $el.attr('id') || '';
    const download = $el.attr('download') || '';
    if (!id || !download) return;

    books.push({
      id,
      isbn: $el.attr('isbn') || '',
      href: $el.attr('href') || '',
      download,
      publisher: $el.attr('publisher') || '',
      language: $el.attr('language') || '',
      year: $el.attr('year') || '',
      extension: $el.attr('extension') || '',
      filesize: $el.attr('filesize') || '',
      rating: $el.attr('rating') || '',
      quality: $el.attr('quality') || '',
      title: $el.find('[slot="title"]').text().trim() || 'Unknown Title',
      author: $el.find('[slot="author"]').text().trim() || 'Unknown Author',
      coverUrl: $el.find('img').attr('data-src') || '',
    });
  });

  return books;
}

// ── Download ──────────────────────────────────────────────────

/**
 * Download a book, with mirror rotation on rate-limit
 * @returns {Promise<{response: Response|null, error: string|null}>}
 */
async function fetchDownload(dlPath) {
  const mirrors = [getMirror(), ...MIRRORS.filter((m, i) => i !== currentMirrorIdx)];

  for (const base of mirrors) {
    const url = `${base}${dlPath}`;
    try {
      const res = await proxyFetch(url, {
        headers: buildHeaders({
          Referer: `${base}/`,
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'same-origin',
        }),
        redirect: 'follow',
      });
      auth.storeCookiesFromResponse(res);

      if (!res.ok) {
        console.log(`[Download] ${base} returned ${res.status}`);
        continue;
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/html')) {
        const html = await res.text();
        const cheerio = require('cheerio');
        const $ = cheerio.load(html);

        const limitHeader = $('.download-limits-error__header').text().trim();
        if (limitHeader) {
          const limitMsg = $('.download-limits-error__message').text().trim();
          console.log(`[Download] Rate limited on ${base}: ${limitHeader}`);
          rotateMirror('rate-limit');
          continue; // Try next mirror
        }

        if (html.includes('loginForm') || html.includes('/login')) {
          return { response: null, error: 'Authentication required. Login via the dashboard or API.' };
        }

        return { response: null, error: 'Download returned HTML instead of file. Try another mirror or login.' };
      }

      // Success!
      return { response: res, error: null };
    } catch (err) {
      console.log(`[Download] Error on ${base}: ${err.message}`);
      rotateMirror('error');
      continue;
    }
  }

  return {
    response: null,
    error: 'Download failed on all mirrors. You may have hit the daily limit (5/day anonymous, 10/day with account). Try logging in or setting a proxy.',
  };
}

// ── Formats ───────────────────────────────────────────────────

async function fetchBookFormats(bookId) {
  const base = getMirror();
  const url = `${base}/papi/book/${bookId}/formats`;
  const res = await proxyFetch(url, {
    headers: buildHeaders({ Accept: 'application/json' }),
    redirect: 'follow',
  });
  auth.storeCookiesFromResponse(res);
  if (!res.ok) throw new Error(`Formats fetch failed: ${res.status}`);
  const data = await res.json();
  if (!data.success || !data.books) return [];
  return data.books;
}

// ── Cover Proxy ───────────────────────────────────────────────

async function fetchCover(coverUrl) {
  const res = await proxyFetch(coverUrl, {
    headers: buildHeaders({ Referer: `${getMirror()}/` }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Cover fetch failed: ${res.status}`);
  return res;
}

module.exports = {
  fetchSearchPage,
  parseSearchResults,
  fetchDownload,
  fetchBookFormats,
  fetchCover,
  getMirror,
  rotateMirror,
  getMirrorStatus,
  setMirror,
  setProxy,
  getProxyStatus,
  MIRRORS,
};
