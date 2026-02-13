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
 * Fetch search results HTML from z-lib.fm
 * @param {string} query - Search query
 * @param {number} [page=1] - Page number
 * @returns {Promise<string>} Raw HTML
 */
async function fetchSearchPage(query, page = 1) {
  const encoded = encodeURIComponent(query);
  let url = `${ZLIB_BASE}/s/${encoded}`;
  if (page > 1) url += `?page=${page}`;

  const res = await fetch(url, { headers: DEFAULT_HEADERS, redirect: 'follow' });
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
 * @param {string} dlPath - The download path (e.g. /dl/JrpaOxdXA0)
 * @returns {Promise<Response>} Fetch response to pipe
 */
async function fetchDownload(dlPath) {
  const url = `${ZLIB_BASE}${dlPath}`;
  const res = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      Referer: `${ZLIB_BASE}/`,
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  return res;
}

/**
 * Proxy a cover image from z-lib / covers CDN
 * @param {string} coverUrl - Full cover image URL
 * @returns {Promise<Response>} Fetch response to pipe
 */
async function fetchCover(coverUrl) {
  const res = await fetch(coverUrl, {
    headers: { 'User-Agent': USER_AGENT, Referer: `${ZLIB_BASE}/` },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Cover fetch failed: ${res.status}`);
  return res;
}

module.exports = { fetchSearchPage, parseSearchResults, fetchDownload, fetchCover };
