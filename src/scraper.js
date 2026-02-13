const auth = require('./auth');

const ZLIB_BASE = 'https://z-lib.fm';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  DNT: '1',
  'Upgrade-Insecure-Requests': '1',
};

/**
 * Build request headers with auth cookies included
 * @param {Object} [extra] - Extra headers to merge
 * @returns {Object} Headers object
 */
function buildHeaders(extra = {}) {
  const headers = { ...DEFAULT_HEADERS, ...extra };
  const cookie = auth.getCookieHeader();
  if (cookie) headers['Cookie'] = cookie;
  return headers;
}

/**
 * Fetch search results HTML from z-lib.fm
 * @param {string} query - Search query
 * @param {number} [page=1] - Page number
 * @returns {Promise<string>} Raw HTML
 */
async function fetchSearchPage(query, page = 1) {
  const encoded = encodeURIComponent(query);
  let url = `${ZLIB_BASE}/s/${encoded}`;
  if (page > 1) url += `?page=${page}`;

  const res = await fetch(url, { headers: buildHeaders(), redirect: 'follow' });
  auth.storeCookiesFromResponse(res);
  if (!res.ok) throw new Error(`Search fetch failed: ${res.status} ${res.statusText}`);
  return res.text();
}

/**
 * Parse the searchResultBox HTML and extract book entries
 * @param {string} html - Raw HTML from z-lib search page
 * @returns {Array<Object>} Array of book objects
 */
function parseSearchResults(html) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const books = [];

  $('z-bookcard').each((_i, el) => {
    const $el = $(el);

    const id = $el.attr('id') || '';
    const isbn = $el.attr('isbn') || '';
    const href = $el.attr('href') || '';
    const download = $el.attr('download') || '';
    const publisher = $el.attr('publisher') || '';
    const language = $el.attr('language') || '';
    const year = $el.attr('year') || '';
    const extension = $el.attr('extension') || '';
    const filesize = $el.attr('filesize') || '';
    const rating = $el.attr('rating') || '';
    const quality = $el.attr('quality') || '';

    const title = $el.find('[slot="title"]').text().trim() || 'Unknown Title';
    const author = $el.find('[slot="author"]').text().trim() || 'Unknown Author';
    const coverUrl = $el.find('img').attr('data-src') || '';

    if (!id || !download) return; // skip incomplete entries

    books.push({
      id,
      isbn,
      href,
      download,
      publisher,
      language,
      year,
      extension,
      filesize,
      rating,
      quality,
      title,
      author,
      coverUrl,
    });
  });

  return books;
}

/**
 * Stream the book download from z-lib.fm
 * Handles cookies, redirects, and detects error pages
 * @param {string} dlPath - The download path (e.g. /dl/JrpaOxdXA0)
 * @returns {Promise<{response: Response, error: string|null}>}
 */
async function fetchDownload(dlPath) {
  const url = `${ZLIB_BASE}${dlPath}`;

  // Step 1: If no cookies yet, prime the cookie jar by visiting the site
  if (!auth.getCookieHeader()) {
    try {
      const primeRes = await fetch(ZLIB_BASE, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
      });
      auth.storeCookiesFromResponse(primeRes);
      await primeRes.text(); // consume body
    } catch (_) {
      // non-fatal
    }
  }

  // Step 2: Fetch the download with full browser-like headers
  const res = await fetch(url, {
    headers: buildHeaders({
      Referer: `${ZLIB_BASE}/`,
      'sec-ch-ua': '"Chromium";v="143", "Not A(Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
    }),
    redirect: 'follow',
  });

  auth.storeCookiesFromResponse(res);

  if (!res.ok) {
    return { response: res, error: `Download failed: ${res.status} ${res.statusText}` };
  }

  // Step 3: Validate the response is actually a file, not an HTML error page
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    // It's HTML — likely a rate-limit or login page
    const html = await res.text();
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);

    // Check for rate limit error
    const limitHeader = $('.download-limits-error__header').text().trim();
    const limitMessage = $('.download-limits-error__message').text().trim();

    if (limitHeader || limitMessage) {
      const msg = limitHeader
        ? `${limitHeader}: ${limitMessage}`
        : 'Download limit reached. Please configure z-lib account cookies.';
      return { response: null, error: msg };
    }

    // Check for login redirect
    if (html.includes('loginForm') || html.includes('/login')) {
      return {
        response: null,
        error: 'Authentication required. Please login via /api/auth/login or set ZLIB_COOKIES.',
      };
    }

    return {
      response: null,
      error: 'Download returned HTML instead of file. Check auth configuration.',
    };
  }

  // Success — it's an actual file
  return { response: res, error: null };
}

/**
 * Fetch all available formats for a book via the papi
 * @param {string} bookId - The z-lib book ID
 * @returns {Promise<Array<{id: number, extension: string, filesizeString: string, href: string}>>}
 */
async function fetchBookFormats(bookId) {
  const url = `${ZLIB_BASE}/papi/book/${bookId}/formats`;
  const res = await fetch(url, {
    headers: buildHeaders({ Accept: 'application/json' }),
    redirect: 'follow',
  });
  auth.storeCookiesFromResponse(res);
  if (!res.ok) throw new Error(`Formats fetch failed: ${res.status}`);
  const data = await res.json();
  if (!data.success || !data.books) return [];
  return data.books;
}

/**
 * Proxy a cover image from z-lib / covers CDN
 * @param {string} coverUrl - Full cover image URL
 * @returns {Promise<Response>} Fetch response to pipe
 */
async function fetchCover(coverUrl) {
  const res = await fetch(coverUrl, {
    headers: buildHeaders({ Referer: `${ZLIB_BASE}/` }),
    redirect: 'follow',
  });
  auth.storeCookiesFromResponse(res);
  if (!res.ok) throw new Error(`Cover fetch failed: ${res.status}`);
  return res;
}

module.exports = { fetchSearchPage, parseSearchResults, fetchDownload, fetchBookFormats, fetchCover };
