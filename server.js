const express = require('express');
const { Readable } = require('stream');
const path = require('path');
const {
  fetchSearchPage,
  parseSearchResults,
  fetchDownload,
  fetchBookFormats,
  fetchCover,
  getMirror,
  getMirrorStatus,
  setMirror,
  setProxy,
  getProxyStatus,
  MIRRORS,
} = require('./src/scraper');
const {
  rootCatalog,
  openSearchDescription,
  searchResultsFeed,
  libraryFeed,
  bookFormatsFeed,
  OPDS_MIME,
  OPDS_ACQ_MIME,
  SEARCH_MIME,
} = require('./src/opds');
const lib = require('./src/library');
const auth = require('./src/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

/** Map DB book row to frontend-friendly shape */
function mapBook(b) {
  if (!b) return b;
  b.coverUrl = b.cover_url || b.coverUrl || '';
  return b;
}

// ─── Middleware ───────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ─── Health check / API info ──────────────────────────────────

app.get('/api/info', (_req, res) => {
  const stats = lib.getStats();
  res.json({
    name: 'Readest Z-Library OPDS Bridge',
    version: '3.0.0',
    frontend: `${BASE_URL}/`,
    opds: `${BASE_URL}/opds`,
    dashboard: `${BASE_URL}/dashboard`,
    api: {
      search: `${BASE_URL}/api/search?q={query}`,
      library: `${BASE_URL}/api/library`,
      formats: `${BASE_URL}/api/formats/{bookId}`,
      mirrors: `${BASE_URL}/api/mirrors`,
      proxy: `${BASE_URL}/api/proxy`,
      stats: `${BASE_URL}/api/stats`,
    },
    auth: {
      status: `${BASE_URL}/api/auth/status`,
      login: `${BASE_URL}/api/auth/login`,
      cookies: `${BASE_URL}/api/auth/cookies`,
    },
    stats: {
      books_tracked: stats.totalBooks,
      total_downloads: stats.totalDownloads,
      total_searches: stats.totalSearches,
    },
  });
});

// ═══════════════════════════════════════════════════════════════
//  OPDS FEEDS
// ═══════════════════════════════════════════════════════════════

// ─── OPDS Root Catalog ────────────────────────────────────────

app.get('/opds', (_req, res) => {
  res.set('Content-Type', OPDS_MIME);
  res.send(rootCatalog(BASE_URL));
});

// ─── OpenSearch Description ───────────────────────────────────

app.get('/opds/opensearch.xml', (_req, res) => {
  res.set('Content-Type', SEARCH_MIME);
  res.send(openSearchDescription(BASE_URL));
});

// ─── Search ───────────────────────────────────────────────────

app.get('/opds/search', async (req, res) => {
  const query = req.query.q || req.query.query || '';
  const page = parseInt(req.query.page, 10) || 1;

  if (!query.trim()) {
    res.set('Content-Type', OPDS_ACQ_MIME);
    return res.send(
      searchResultsFeed({ baseUrl: BASE_URL, query: '', books: [], page: 1 })
    );
  }

  try {
    console.log(`[Search] query="${query}" page=${page}`);
    const html = await fetchSearchPage(query, page);
    const books = parseSearchResults(html);
    console.log(`[Search] Found ${books.length} results`);

    // Log search & cache books in DB
    lib.logSearch(query, books.length);
    for (const book of books) {
      lib.upsertBook(book);
    }

    res.set('Content-Type', OPDS_ACQ_MIME);
    res.send(searchResultsFeed({ baseUrl: BASE_URL, query, books, page }));
  } catch (err) {
    console.error('[Search Error]', err.message);
    res.status(502).set('Content-Type', 'text/plain').send(`Search failed: ${err.message}`);
  }
});

// ─── Book Formats (OPDS) ─────────────────────────────────────

app.get('/opds/book/:bookId/formats', async (req, res) => {
  const { bookId } = req.params;

  try {
    const formats = await fetchBookFormats(bookId);
    let book = lib.getBook(bookId);

    if (!book) {
      // Minimal fallback if book not in DB
      book = { id: bookId, title: 'Book ' + bookId, author: '', extension: '', filesize: '', download: '' };
    }

    res.set('Content-Type', OPDS_ACQ_MIME);
    res.send(bookFormatsFeed({ baseUrl: BASE_URL, book, formats }));
  } catch (err) {
    console.error('[Formats Error]', err.message);
    res.status(502).send(`Formats fetch failed: ${err.message}`);
  }
});

// ─── Library Feeds ────────────────────────────────────────────

app.get('/opds/library', (_req, res) => {
  const books = lib.getLibraryBooks(null, 100, 0);
  res.set('Content-Type', OPDS_ACQ_MIME);
  res.send(libraryFeed({ baseUrl: BASE_URL, title: 'My Library', id: 'all', books, status: null }));
});

app.get('/opds/library/downloads', (_req, res) => {
  const history = lib.getDownloadHistory(100, 0);
  // Map download history to a book-like structure
  const books = history.map((h) => {
    const cached = lib.getBook(h.book_id);
    return cached || {
      id: h.book_id,
      title: h.title,
      author: h.author,
      extension: h.extension,
      filesize: h.filesize,
      download: h.dl_path,
      coverUrl: '',
      publisher: '',
      language: '',
      year: '',
      rating: '',
    };
  });
  res.set('Content-Type', OPDS_ACQ_MIME);
  res.send(libraryFeed({ baseUrl: BASE_URL, title: 'Download History', id: 'downloads', books, status: 'downloads' }));
});

app.get('/opds/library/:status', (req, res) => {
  const { status } = req.params;
  const validStatuses = ['downloaded', 'reading', 'finished', 'want-to-read', 'favorite'];
  if (!validStatuses.includes(status)) {
    return res.status(400).send('Invalid status');
  }

  const titleMap = {
    downloaded: 'Downloaded Books',
    reading: 'Currently Reading',
    finished: 'Finished Books',
    'want-to-read': 'Want to Read',
    favorite: 'Favorites',
  };

  const books = lib.getLibraryBooks(status, 100, 0);
  res.set('Content-Type', OPDS_ACQ_MIME);
  res.send(libraryFeed({ baseUrl: BASE_URL, title: titleMap[status], id: status, books, status }));
});

// ─── Download Proxy ───────────────────────────────────────────

app.get('/opds/download/dl/:code', async (req, res) => {
  const dlPath = `/dl/${req.params.code}`;
  const ext = req.query.ext || 'epub';
  const bookId = req.query.id || '';

  try {
    console.log(`[Download] ${dlPath} (book: ${bookId})`);

    // Log download in history
    if (bookId) {
      const book = lib.getBook(bookId);
      if (book) {
        lib.logDownload({ ...book, download: dlPath });
        lib.addToLibrary(bookId, 'downloaded');
      } else {
        lib.logDownload({ id: bookId, title: 'Unknown', dl_path: dlPath, extension: ext });
      }
    }

    const upstream = await fetchDownload(dlPath);

    // Check for download errors (rate limit, auth required, etc.)
    if (upstream.error) {
      console.error(`[Download Error] ${upstream.error}`);
      const statusCode = upstream.error.includes('Authentication') ? 401 : 429;
      return res.status(statusCode).json({
        error: upstream.error,
        help: 'Configure z-lib cookies via POST /api/auth/cookies or login via POST /api/auth/login',
      });
    }

    const response = upstream.response;

    // Forward content headers
    const contentType = response.headers.get('content-type');
    const contentDisp = response.headers.get('content-disposition');
    const contentLen = response.headers.get('content-length');

    if (contentType) res.set('Content-Type', contentType);
    if (contentDisp) {
      res.set('Content-Disposition', contentDisp);
    } else {
      res.set('Content-Disposition', `attachment; filename="book.${ext}"`);
    }
    if (contentLen) res.set('Content-Length', contentLen);

    const readable = Readable.fromWeb(response.body);
    readable.pipe(res);
    readable.on('error', (err) => {
      console.error('[Download Stream Error]', err.message);
      if (!res.headersSent) res.status(500).end();
    });
  } catch (err) {
    console.error('[Download Error]', err.message);
    res.status(502).send(`Download failed: ${err.message}`);
  }
});

// ─── Cover Image Proxy ───────────────────────────────────────

app.get('/opds/cover', async (req, res) => {
  const coverUrl = req.query.url;
  if (!coverUrl) return res.status(400).send('Missing cover url');

  try {
    const upstream = await fetchCover(coverUrl);
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');

    const readable = Readable.fromWeb(upstream.body);
    readable.pipe(res);
  } catch (err) {
    console.error('[Cover Error]', err.message);
    res.status(502).send('Cover fetch failed');
  }
});

// ═══════════════════════════════════════════════════════════════
//  JSON SEARCH API (for frontend)
// ═══════════════════════════════════════════════════════════════

app.get('/api/search', async (req, res) => {
  const query = req.query.q || '';
  const page = parseInt(req.query.page, 10) || 1;
  if (!query.trim()) return res.json({ books: [], page: 1 });

  try {
    console.log(`[API Search] query="${query}" page=${page}`);
    const html = await fetchSearchPage(query, page);
    const books = parseSearchResults(html);
    lib.logSearch(query, books.length);
    for (const book of books) lib.upsertBook(book);
    res.json({ books, page, count: books.length });
  } catch (err) {
    console.error('[API Search Error]', err.message);
    res.status(502).json({ error: err.message, books: [] });
  }
});

// ─── Book Lookup ──────────────────────────────────────────────

app.get('/api/book/:bookId', (req, res) => {
  const book = lib.getBook(req.params.bookId);
  if (!book) return res.status(404).json({ error: 'Book not found' });
  // Map DB column name to frontend-expected key
  book.coverUrl = book.cover_url || '';
  res.json(book);
});

// ─── Library Status for a Book ────────────────────────────────

app.get('/api/library/status/:bookId', (req, res) => {
  try {
    const statuses = lib.getBookStatuses ? lib.getBookStatuses(req.params.bookId) : [];
    res.json({ bookId: req.params.bookId, statuses });
  } catch {
    res.json({ bookId: req.params.bookId, statuses: [] });
  }
});

// ═══════════════════════════════════════════════════════════════
//  MIRROR & PROXY API
// ═══════════════════════════════════════════════════════════════

app.get('/api/mirrors', (_req, res) => {
  res.json({ mirrors: getMirrorStatus(), current: getMirror() });
});

app.post('/api/mirrors', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  setMirror(url);
  res.json({ success: true, current: getMirror(), mirrors: getMirrorStatus() });
});

app.get('/api/proxy', (_req, res) => {
  res.json(getProxyStatus());
});

app.post('/api/proxy', async (req, res) => {
  const { url } = req.body;
  const result = await setProxy(url || '');
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
//  AUTH API
// ═══════════════════════════════════════════════════════════════

app.get('/api/auth/status', (_req, res) => {
  res.json(auth.getStatus());
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  const result = await auth.login(email, password);
  res.json(result);
});

app.post('/api/auth/cookies', (req, res) => {
  const { cookies } = req.body;
  if (!cookies) {
    return res.status(400).json({ error: 'cookies string required (e.g. "remix_userid=123; remix_userkey=abc")' });
  }
  auth.setCookies(cookies);
  res.json({ success: true, ...auth.getStatus() });
});

app.post('/api/auth/logout', (_req, res) => {
  auth.clearCookies();
  res.json({ success: true, message: 'Cookies cleared' });
});

// ═══════════════════════════════════════════════════════════════
//  REST API (for dashboard & programmatic use)
// ═══════════════════════════════════════════════════════════════

// ─── Get all formats for a book ───────────────────────────────

app.get('/api/formats/:bookId', async (req, res) => {
  try {
    const formats = await fetchBookFormats(req.params.bookId);
    res.json({ success: true, bookId: req.params.bookId, formats });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ─── Library API ──────────────────────────────────────────────

app.get('/api/library', (req, res) => {
  const status = req.query.status || null;
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;
  const books = lib.getLibraryBooks(status, limit, offset).map(mapBook);
  const count = lib.getLibraryCount(status);
  res.json({ books, total: count });
});

app.post('/api/library/add', (req, res) => {
  const { bookId, status } = req.body;
  if (!bookId) return res.status(400).json({ error: 'bookId required' });

  const validStatuses = ['downloaded', 'reading', 'finished', 'want-to-read', 'favorite'];
  const s = validStatuses.includes(status) ? status : 'downloaded';

  lib.addToLibrary(bookId, s);
  res.json({ success: true, bookId, status: s });
});

app.post('/api/library/remove', (req, res) => {
  const { bookId, status } = req.body;
  if (!bookId || !status) return res.status(400).json({ error: 'bookId and status required' });

  lib.removeFromLibrary(bookId, status);
  res.json({ success: true });
});

app.post('/api/library/progress', (req, res) => {
  const { bookId, progress } = req.body;
  if (!bookId || progress === undefined) return res.status(400).json({ error: 'bookId and progress required' });

  lib.updateProgress(bookId, parseFloat(progress));
  res.json({ success: true, bookId, progress });
});

// ─── Stats & History API ──────────────────────────────────────

app.get('/api/stats', (_req, res) => {
  res.json(lib.getStats());
});

app.get('/api/history/downloads', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;
  res.json({ downloads: lib.getDownloadHistory(limit, offset), total: lib.getDownloadCount() });
});

app.get('/api/history/searches', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 20;
  res.json({ searches: lib.getRecentSearches(limit) });
});

// ═══════════════════════════════════════════════════════════════
//  WEB DASHBOARD
// ═══════════════════════════════════════════════════════════════

app.get('/dashboard', (_req, res) => {
  const stats = lib.getStats();
  const recentSearches = lib.getRecentSearches(10);
  const authStatus = auth.getStatus();

  const statusBadge = (s) => {
    const colors = { downloaded: '#3b82f6', reading: '#f59e0b', finished: '#10b981', 'want-to-read': '#8b5cf6', favorite: '#ef4444' };
    return `<span style="background:${colors[s] || '#6b7280'};color:#fff;padding:2px 8px;border-radius:12px;font-size:12px">${s}</span>`;
  };

  const libraryRows = lib.getLibraryBooks(null, 20, 0).map((b) => `
    <tr>
      <td>${b.title}</td>
      <td>${b.author}</td>
      <td>${(b.extension || '').toUpperCase()}</td>
      <td>${statusBadge(b.lib_status)}</td>
      <td>${b.progress > 0 ? Math.round(b.progress * 100) + '%' : '-'}</td>
      <td>${b.lib_added_at || ''}</td>
    </tr>
  `).join('');

  const downloadRows = stats.recentDownloads.map((d) => `
    <tr>
      <td>${d.title}</td>
      <td>${d.author}</td>
      <td>${(d.extension || '').toUpperCase()}</td>
      <td>${d.filesize}</td>
      <td>${d.downloaded_at}</td>
    </tr>
  `).join('');

  const searchRows = recentSearches.map((s) => `
    <tr>
      <td><a href="/opds/search?q=${encodeURIComponent(s.query)}">${s.query}</a></td>
      <td>${s.results}</td>
      <td>${s.times}</td>
      <td>${s.last_searched}</td>
    </tr>
  `).join('');

  const statusCounts = {};
  for (const s of stats.libraryByStatus) statusCounts[s.status] = s.count;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Z-Library OPDS Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 28px; margin-bottom: 8px; color: #f1f5f9; }
    .subtitle { color: #94a3b8; margin-bottom: 30px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 30px; }
    .stat-card { background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; border: 1px solid #334155; }
    .stat-card .number { font-size: 36px; font-weight: 700; color: #38bdf8; }
    .stat-card .label { font-size: 13px; color: #94a3b8; margin-top: 4px; }
    .opds-url { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin-bottom: 30px; display: flex; align-items: center; gap: 12px; }
    .opds-url code { flex: 1; color: #38bdf8; font-size: 15px; word-break: break-all; }
    .opds-url button { background: #3b82f6; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
    .opds-url button:hover { background: #2563eb; }
    .section { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #334155; }
    .section h2 { font-size: 18px; margin-bottom: 16px; color: #f1f5f9; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 10px 12px; border-bottom: 2px solid #334155; color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 10px 12px; border-bottom: 1px solid #1e293b; font-size: 14px; }
    tr:hover td { background: #334155; }
    a { color: #38bdf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .search-box { display: flex; gap: 8px; margin-bottom: 20px; }
    .search-box input { flex: 1; padding: 10px 16px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; font-size: 15px; }
    .search-box button { background: #3b82f6; color: #fff; border: none; padding: 10px 24px; border-radius: 8px; cursor: pointer; font-size: 15px; }
    .empty { color: #64748b; text-align: center; padding: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Z-Library OPDS Bridge</h1>
    <p class="subtitle">Your personal bridge between Readest and Z-Library</p>

    <div class="opds-url">
      <span style="color:#94a3b8">OPDS Feed:</span>
      <code id="opdsUrl">${BASE_URL}/opds</code>
      <button onclick="navigator.clipboard.writeText(document.getElementById('opdsUrl').textContent)">Copy</button>
    </div>

    <div class="section" style="border-color:${authStatus.authenticated ? '#10b981' : '#ef4444'}">
      <h2>Z-Library Auth ${authStatus.authenticated ? '<span style="color:#10b981">● Connected</span>' : '<span style="color:#ef4444">● Not Connected</span>'}</h2>
      ${authStatus.authenticated
        ? `<p style="color:#94a3b8;margin-bottom:12px">Logged in${authStatus.email ? ' as <strong>' + authStatus.email + '</strong>' : ''}. Cookies: ${authStatus.cookieNames.join(', ')}</p>
           <button onclick="fetch('/api/auth/logout',{method:'POST'}).then(()=>location.reload())" style="background:#ef4444;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">Logout</button>`
        : `<p style="color:#94a3b8;margin-bottom:12px">Login to bypass download limits (5/day anonymous limit)</p>
           <form onsubmit="event.preventDefault();fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:this.email.value,password:this.password.value})}).then(r=>r.json()).then(d=>{alert(d.message||d.error);if(d.success)location.reload()})">
             <div style="display:flex;gap:8px;flex-wrap:wrap">
               <input name="email" type="email" placeholder="Z-Library email" style="flex:1;min-width:200px;padding:8px 12px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0" required />
               <input name="password" type="password" placeholder="Password" style="flex:1;min-width:200px;padding:8px 12px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0" required />
               <button type="submit" style="background:#3b82f6;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer">Login</button>
             </div>
           </form>
           <details style="margin-top:12px">
             <summary style="color:#94a3b8;cursor:pointer;font-size:13px">Or paste cookies manually</summary>
             <form onsubmit="event.preventDefault();fetch('/api/auth/cookies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cookies:this.cookies.value})}).then(r=>r.json()).then(d=>{alert(d.authenticated?'Cookies set!':d.error);if(d.authenticated)location.reload()})" style="margin-top:8px">
               <div style="display:flex;gap:8px">
                 <input name="cookies" placeholder="remix_userid=123; remix_userkey=abc; ..." style="flex:1;padding:8px 12px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-family:monospace;font-size:12px" required />
                 <button type="submit" style="background:#8b5cf6;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">Set</button>
               </div>
             </form>
           </details>`
      }
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="number">${stats.totalBooks}</div>
        <div class="label">Books Tracked</div>
      </div>
      <div class="stat-card">
        <div class="number">${stats.totalDownloads}</div>
        <div class="label">Downloads</div>
      </div>
      <div class="stat-card">
        <div class="number">${stats.totalSearches}</div>
        <div class="label">Searches</div>
      </div>
      <div class="stat-card">
        <div class="number">${statusCounts['favorite'] || 0}</div>
        <div class="label">Favorites</div>
      </div>
      <div class="stat-card">
        <div class="number">${statusCounts['reading'] || 0}</div>
        <div class="label">Reading</div>
      </div>
      <div class="stat-card">
        <div class="number">${statusCounts['finished'] || 0}</div>
        <div class="label">Finished</div>
      </div>
    </div>

    <div class="section">
      <h2>Quick Search</h2>
      <form class="search-box" action="/opds/search" method="get">
        <input name="q" placeholder="Search for books..." autocomplete="off" />
        <button type="submit">Search</button>
      </form>
    </div>

    <div class="section">
      <h2>Recent Searches</h2>
      ${searchRows ? `
      <table>
        <thead><tr><th>Query</th><th>Results</th><th>Times</th><th>Last Searched</th></tr></thead>
        <tbody>${searchRows}</tbody>
      </table>` : '<p class="empty">No searches yet. Search for a book to get started!</p>'}
    </div>

    <div class="section">
      <h2>Library</h2>
      ${libraryRows ? `
      <table>
        <thead><tr><th>Title</th><th>Author</th><th>Format</th><th>Status</th><th>Progress</th><th>Added</th></tr></thead>
        <tbody>${libraryRows}</tbody>
      </table>` : '<p class="empty">Your library is empty. Download some books to see them here!</p>'}
    </div>

    <div class="section">
      <h2>Recent Downloads</h2>
      ${downloadRows ? `
      <table>
        <thead><tr><th>Title</th><th>Author</th><th>Format</th><th>Size</th><th>Downloaded</th></tr></thead>
        <tbody>${downloadRows}</tbody>
      </table>` : '<p class="empty">No downloads yet.</p>'}
    </div>

    <div class="section" style="text-align:center;color:#64748b;font-size:13px;border:none;background:none">
      <p>
        <a href="/opds">OPDS Feed</a> &middot;
        <a href="/api/stats">API Stats</a> &middot;
        <a href="/api/library">Library API</a> &middot;
        <a href="/api/history/downloads">Downloads API</a> &middot;
        <a href="/api/history/searches">Searches API</a>
      </p>
    </div>
  </div>
</body>
</html>`);
});

// ─── Start Server ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          Readest Z-Library OPDS Bridge v3.0                 ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Server:     http://localhost:${String(PORT).padEnd(27)}    ║
║  Frontend:   ${(BASE_URL + '/').padEnd(43)}  ║
║  OPDS Feed:  ${(BASE_URL + '/opds').padEnd(43)}  ║
║  Dashboard:  ${(BASE_URL + '/dashboard').padEnd(43)}  ║
║                                                              ║
║  Features:                                                   ║
║    - Web frontend (search, library, downloads, settings)     ║
║    - Multi-format downloads (epub, pdf, mobi, azw3...)       ║
║    - Z-Library auth (login or paste cookies)                  ║
║    - Mirror rotation (${MIRRORS.length} mirrors) + proxy support               ║
║    - Personal library tracking                               ║
║    - Download & search history                               ║
║    - OPDS feed for e-reader apps                             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
