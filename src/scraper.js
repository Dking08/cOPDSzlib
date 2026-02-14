/**
 * Library Genesis scraper — NO rate limits on downloads!
 *
 * Flow:
 *   1. Search    → libgen.li/index.php?req=<query>&...
 *   2. Ads page  → libgen.li/ads.php?md5=<md5>       → extract get.php?md5=...&key=...
 *   3. Download  → libgen.li/get.php?md5=...&key=...  → 307 → CDN → actual file
 *
 * Cover images:  libgen.li/covers/<bucket>/<md5>_small.jpg
 */

const cheerio = require('cheerio');

// ── Configuration ─────────────────────────────────────────────

const LIBGEN_BASE = 'https://libgen.li';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Optional proxy support
let proxyAgent = null;

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
    return { success: false, message: `Proxy error: ${err.message}` };
  }
}

function getProxyStatus() {
  return { enabled: !!proxyAgent, type: proxyAgent ? proxyAgent.constructor.name : null };
}

async function proxyFetch(url, options = {}) {
  if (proxyAgent) {
    const { default: nodeFetch } = await import('node-fetch');
    return nodeFetch(url, { ...options, agent: proxyAgent });
  }
  return fetch(url, options);
}

// ══════════════════════════════════════════════════════════════
//  SEARCH
// ══════════════════════════════════════════════════════════════

/**
 * Build the full libgen.li search URL
 */
function buildSearchUrl(query, page = 1) {
  const params = new URLSearchParams({
    req: query,
    res: '25',
    covers: 'on',
    filesuns: 'all',
  });
  for (const c of ['t', 'a', 's', 'y', 'p', 'i']) params.append('columns[]', c);
  for (const o of ['f', 'e', 's', 'a', 'p', 'w']) params.append('objects[]', o);
  for (const t of ['l', 'c', 'f', 'a', 'm', 'r', 's']) params.append('topics[]', t);
  if (page > 1) params.set('page', String(page));
  return `${LIBGEN_BASE}/index.php?${params.toString()}`;
}

/**
 * Fetch search results HTML from libgen.li
 */
async function fetchSearchPage(query, page = 1) {
  const url = buildSearchUrl(query, page);
  console.log(`[Search] ${url.substring(0, 80)}...`);
  const res = await proxyFetch(url, { headers: DEFAULT_HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`Search failed: ${res.status} ${res.statusText}`);
  return await res.text();
}

/**
 * Parse libgen.li search results table
 *
 * Table layout (by <td> index):
 *   0: Cover thumbnail + edition link
 *   1: Title (+ edition link)
 *   2: Author(s)
 *   3: Publisher
 *   4: Year
 *   5: Language
 *   6: Pages
 *   7: File size (+ file.php link)
 *   8: Extension
 *   9: Mirror links (ads.php has md5)
 */
function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const books = [];

  // main results table is the 2nd table on the page (index 1)
  const table = $('table').eq(1);
  if (!table.length) return { books, totalPages: 1 };

  const rows = table.find('tr');

  for (let i = 1; i < rows.length; i++) {
    const row = $(rows[i]);
    const tds = row.find('td');
    if (tds.length < 9) continue;

    const editionHref = $(tds[0]).find('a').first().attr('href') || '';
    const coverSrc = $(tds[0]).find('img').first().attr('src') || '';
    const editionId = editionHref.match(/id=(\d+)/)?.[1] || '';

    const title = $(tds[1]).find('a').first().text().trim() || $(tds[1]).text().trim();
    const author = $(tds[2]).text().trim();
    const publisher = $(tds[3]).text().trim();
    const year = $(tds[4]).text().trim();
    const language = $(tds[5]).text().trim();
    const pages = $(tds[6]).text().trim();
    const filesize = $(tds[7]).text().trim();
    const extension = $(tds[8]).text().trim().toLowerCase();

    // Extract md5 from the ads.php link in mirrors column
    let md5 = '';
    $(tds[9]).find('a').each((_j, a) => {
      const href = $(a).attr('href') || '';
      const match = href.match(/md5=([a-f0-9]{32})/i);
      if (match && !md5) md5 = match[1];
    });

    if (!md5 && !editionId) continue;

    let coverUrl = '';
    if (coverSrc) {
      coverUrl = coverSrc.startsWith('http')
        ? coverSrc
        : `${LIBGEN_BASE}${coverSrc.startsWith('/') ? '' : '/'}${coverSrc}`;
    }

    books.push({
      id: md5 || editionId,
      editionId,
      md5,
      title: title || 'Unknown Title',
      author: author || 'Unknown Author',
      publisher,
      year,
      language,
      pages,
      filesize,
      extension,
      coverUrl,
      download: md5 ? `/libgen/dl/${md5}` : '',
      href: editionId ? `${LIBGEN_BASE}/edition.php?id=${editionId}` : '',
    });
  }

  // Pagination
  let totalPages = 1;
  const pgMatch = html.match(/new Paginator\("[^"]*",\s*(\d+)/);
  if (pgMatch) totalPages = parseInt(pgMatch[1], 10);

  return { books, totalPages };
}

// ══════════════════════════════════════════════════════════════
//  DOWNLOAD (ads.php → get.php → CDN)
// ══════════════════════════════════════════════════════════════

/**
 * Fetch the ads.php page and extract the get.php download link
 */
async function getDownloadLink(md5) {
  const adsUrl = `${LIBGEN_BASE}/ads.php?md5=${md5}`;
  console.log(`[Download] Fetching ads page: ${adsUrl}`);

  const res = await proxyFetch(adsUrl, { headers: DEFAULT_HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`Ads page failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  let getLink = '';
  $('a').each((_i, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('get.php') && href.includes('md5=') && href.includes('key=')) {
      getLink = href;
    }
  });

  if (!getLink) throw new Error('Could not find download link on ads page');

  if (!getLink.startsWith('http')) {
    getLink = `${LIBGEN_BASE}/${getLink.replace(/^\//, '')}`;
  }

  console.log(`[Download] Got link: ${getLink}`);
  return getLink;
}

/**
 * Download a book via libgen: ads.php → get.php → CDN stream
 * @param {string} md5 - The book's MD5 hash
 * @returns {Promise<{response: Response|null, error: string|null}>}
 */
async function fetchDownload(md5) {
  try {
    const getLink = await getDownloadLink(md5);

    const res = await proxyFetch(getLink, {
      headers: { ...DEFAULT_HEADERS, Referer: `${LIBGEN_BASE}/ads.php?md5=${md5}` },
      redirect: 'follow',
    });

    if (!res.ok) {
      return { response: null, error: `Download failed: HTTP ${res.status}` };
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      const html = await res.text();
      if (html.includes('404') || html.includes('not found')) {
        return { response: null, error: 'File not found on server' };
      }
      return { response: null, error: 'Download returned HTML instead of file.' };
    }

    return { response: res, error: null };
  } catch (err) {
    console.error(`[Download] Error:`, err.message);
    return { response: null, error: `Download error: ${err.message}` };
  }
}

// ══════════════════════════════════════════════════════════════
//  BOOK DETAILS (edition page)
// ══════════════════════════════════════════════════════════════

async function fetchBookDetails(editionId) {
  const url = `${LIBGEN_BASE}/edition.php?id=${editionId}`;
  const res = await proxyFetch(url, { headers: DEFAULT_HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`Edition page failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  let md5 = '';
  $('a').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/md5=([a-f0-9]{32})/i);
    if (match && !md5) md5 = match[1];
  });

  const details = { md5, editionId };
  $('td').each((_i, td) => {
    const text = $(td).text().trim();
    if (text.startsWith('Title:')) details.title = text.replace('Title:', '').trim();
    if (text.startsWith('Author(s):')) details.author = text.replace('Author(s):', '').trim();
    if (text.startsWith('Publisher:')) details.publisher = text.replace('Publisher:', '').trim();
    if (text.startsWith('Year:')) details.year = text.replace('Year:', '').trim();
    if (text.startsWith('Language:')) details.language = text.replace('Language:', '').trim();
    if (text.startsWith('ISBN:')) details.isbn = text.replace('ISBN:', '').trim();
  });

  return details;
}

// ══════════════════════════════════════════════════════════════
//  COVER PROXY
// ══════════════════════════════════════════════════════════════

async function fetchCover(coverUrl) {
  if (coverUrl && !coverUrl.startsWith('http')) {
    coverUrl = `${LIBGEN_BASE}${coverUrl.startsWith('/') ? '' : '/'}${coverUrl}`;
  }
  const res = await proxyFetch(coverUrl, {
    headers: { ...DEFAULT_HEADERS, Referer: `${LIBGEN_BASE}/` },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Cover fetch failed: ${res.status}`);
  return res;
}

// ══════════════════════════════════════════════════════════════
//  MIRROR COMPAT (kept for server.js compatibility)
// ══════════════════════════════════════════════════════════════

const MIRRORS = [LIBGEN_BASE];
function getMirror() { return LIBGEN_BASE; }
function getMirrorStatus() { return [{ url: LIBGEN_BASE, active: true, fails: 0 }]; }
function setMirror() { return true; }
function rotateMirror() { return LIBGEN_BASE; }

module.exports = {
  fetchSearchPage,
  parseSearchResults,
  fetchDownload,
  fetchBookDetails,
  fetchCover,
  getMirror,
  rotateMirror,
  getMirrorStatus,
  setMirror,
  setProxy,
  getProxyStatus,
  MIRRORS,
  LIBGEN_BASE,
};
