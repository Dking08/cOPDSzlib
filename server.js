const express = require('express');
const { fetchSearchPage, parseSearchResults, fetchDownload, fetchCover } = require('./src/scraper');
const {
  rootCatalog,
  openSearchDescription,
  searchResultsFeed,
  OPDS_MIME,
  OPDS_ACQ_MIME,
  SEARCH_MIME,
} = require('./src/opds');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

// ─── Middleware ───────────────────────────────────────────────

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ─── Health check ─────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({
    name: 'Readest Z-Library OPDS Bridge',
    version: '1.0.0',
    opds: `${BASE_URL}/opds`,
    usage: 'Add this OPDS feed URL to Readest: ' + `${BASE_URL}/opds`,
  });
});

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

    res.set('Content-Type', OPDS_ACQ_MIME);
    res.send(searchResultsFeed({ baseUrl: BASE_URL, query, books, page }));
  } catch (err) {
    console.error('[Search Error]', err.message);
    res.status(502).set('Content-Type', 'text/plain').send(`Search failed: ${err.message}`);
  }
});

// ─── Download Proxy ───────────────────────────────────────────

app.get('/opds/download/dl/:code', async (req, res) => {
  const dlPath = `/dl/${req.params.code}`;
  const ext = req.query.ext || 'epub';

  try {
    console.log(`[Download] ${dlPath}`);
    const upstream = await fetchDownload(dlPath);

    // Forward content headers from z-lib
    const contentType = upstream.headers.get('content-type');
    const contentDisp = upstream.headers.get('content-disposition');
    const contentLen = upstream.headers.get('content-length');

    if (contentType) res.set('Content-Type', contentType);
    if (contentDisp) {
      res.set('Content-Disposition', contentDisp);
    } else {
      res.set('Content-Disposition', `attachment; filename="book.${ext}"`);
    }
    if (contentLen) res.set('Content-Length', contentLen);

    // Stream the response body
    const { Readable } = require('stream');
    const readable = Readable.fromWeb(upstream.body);
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
    res.set('Cache-Control', 'public, max-age=86400'); // cache 24h

    const { Readable } = require('stream');
    const readable = Readable.fromWeb(upstream.body);
    readable.pipe(res);
  } catch (err) {
    console.error('[Cover Error]', err.message);
    res.status(502).send('Cover fetch failed');
  }
});

// ─── Start Server ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║          Readest Z-Library OPDS Bridge                  ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  Server running on port ${String(PORT).padEnd(30)}  ║
║                                                          ║
║  OPDS Feed URL:                                          ║
║  ${(BASE_URL + '/opds').padEnd(55)} ║
║                                                          ║
║  Add the above URL to Readest as a custom OPDS feed      ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});
