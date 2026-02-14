# Readest LibGen OPDS Bridge

An OPDS 1.2 catalog server that bridges [Readest](https://readest.com) to Library Genesis (libgen.li), allowing you to search and download books directly from Readest's OPDS reader — **no download limits, no authentication required**.

## Features

- **Search** Library Genesis's full catalog via OPDS
- **Multi-format downloads** (epub, pdf, mobi, azw3, fb2, djvu, and more)
- **No rate limits** — Library Genesis has no per-IP download restrictions
- **No authentication** — works out of the box, no accounts needed
- **Personal library** — track favorites, reading status, progress, and want-to-read lists
- **Download & search history** with stats
- **Web frontend** — full SPA with search, library, downloads, and settings
- **Web dashboard** with stats and quick search
- **OPDS 1.2 compatible** — works with Readest, Calibre, KOReader, and other OPDS clients

## How It Works

```
Readest  ──→  OPDS Server  ──→  libgen.li
              (this app)
Readest  ←──  OPDS Server  ←──  libgen.li
```

1. Readest sends a search query via OPDS
2. This server fetches `https://libgen.li/index.php?req=<query>` and parses the HTML
3. Book metadata is extracted and returned as an OPDS Atom feed
4. When you tap download, the server proxies the file from Library Genesis CDN

## Local Setup

```bash
cd cOPDS
npm install
npm run dev
```

Server starts at `http://localhost:3000`. Add `http://localhost:3000/opds` as an OPDS feed in Readest.

## Deploy to Railway

1. Push this repo to GitHub
2. Connect to [Railway](https://railway.app)
3. Set environment variable: `BASE_URL=https://your-app.up.railway.app`
4. Railway auto-detects and deploys

## Deploy to Render

1. Push to GitHub
2. Create a new **Web Service** on [Render](https://render.com)
3. Set:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment variable**: `BASE_URL=https://your-app.onrender.com`

## OPDS Endpoints

| Endpoint | Description |
|---|---|
| `GET /opds` | Root OPDS navigation catalog |
| `GET /opds/opensearch.xml` | OpenSearch description |
| `GET /opds/search?q={query}&page={n}` | Search books |
| `GET /opds/library` | Your library (all statuses) |
| `GET /opds/library/:status` | Filter by: downloaded, reading, finished, want-to-read, favorite |
| `GET /opds/library/downloads` | Download history |
| `GET /libgen/dl/:md5` | Download proxy |
| `GET /opds/cover?url={coverUrl}` | Cover image proxy |

## REST API

| Endpoint | Description |
|---|---|
| `GET /api/info` | Server info and stats |
| `GET /api/search?q={query}&page={n}` | Search books (JSON) |
| `GET /api/book/:bookId/details` | Book details |
| `GET /api/library` | Library books |
| `POST /api/library/add` | Add to library |
| `POST /api/library/remove` | Remove from library |
| `POST /api/library/progress` | Update reading progress |
| `GET /api/stats` | Usage statistics |
| `GET /api/history/downloads` | Download history |
| `GET /api/history/searches` | Search history |

## Usage in Readest

1. Open Readest → Settings → OPDS Catalogs
2. Add new catalog with URL: `https://your-deployed-url/opds`
3. Search for any book — results appear with covers, metadata, and download links
4. Tap a book to download it directly into Readest

## Tech Stack

- **Node.js 18+** with native `fetch`
- **Express** for HTTP routing
- **Cheerio** for HTML parsing
- **better-sqlite3** for library persistence
- Library Genesis as source — unlimited, auth-free downloads

