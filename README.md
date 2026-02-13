# Readest Z-Library OPDS Bridge

An OPDS 1.2 catalog server that bridges [Readest](https://readest.com) to Z-Library, allowing you to search and download books directly from Readest's OPDS reader.

## Features

- **Search** Z-Library's full catalog via OPDS
- **Multi-format downloads** (epub, pdf, mobi, azw3, fb2, djvu, and more)
- **Z-Library auth** — login or paste cookies to bypass the 5 downloads/day anonymous limit
- **Personal library** — track favorites, reading status, progress, and want-to-read lists
- **Download & search history** with stats
- **Web dashboard** with auth management, stats, and quick search
- **OPDS 1.2 compatible** — works with Readest, Calibre, KOReader, and other OPDS clients

## How It Works

```
Readest  ──→  OPDS Server  ──→  z-lib.fm
              (this app)
Readest  ←──  OPDS Server  ←──  z-lib.fm
```

1. Readest sends a search query via OPDS
2. This server fetches `https://z-lib.fm/s/<query>` and parses the HTML
3. Book metadata is extracted and returned as an OPDS Atom feed
4. When you tap download in Readest, the server proxies the file from z-lib.fm

## Local Setup

```bash
cd cOPDS
npm install
npm run dev
```

Server starts at `http://localhost:3000`. Add `http://localhost:3000/opds` as an OPDS feed in Readest.

## Z-Library Authentication

Anonymous users are limited to **5 downloads per IP per 24 hours**. To bypass this, authenticate with your z-lib account via one of these methods:

### Option 1: Dashboard Login
Visit `http://localhost:3000/dashboard` and use the login form.

### Option 2: API Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@email.com","password":"your-password"}'
```

### Option 3: Paste Cookies
```bash
curl -X POST http://localhost:3000/api/auth/cookies \
  -H "Content-Type: application/json" \
  -d '{"cookies":"remix_userid=12345; remix_userkey=abc123"}'
```

### Option 4: Environment Variables
```env
ZLIB_COOKIES=remix_userid=12345; remix_userkey=abc123
# OR
ZLIB_REMIX_USERID=12345
ZLIB_REMIX_USERKEY=abc123
```

## Deploy to Railway

1. Push this repo to GitHub
2. Connect to [Railway](https://railway.app)
3. Set environment variables: `BASE_URL=https://your-app.up.railway.app` and optionally `ZLIB_COOKIES`
4. Railway auto-detects the Dockerfile and deploys

## Deploy to Render

1. Push to GitHub
2. Create a new **Web Service** on [Render](https://render.com)
3. Set:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment variables**: `BASE_URL=https://your-app.onrender.com`, optionally `ZLIB_COOKIES`

## OPDS Endpoints

| Endpoint | Description |
|---|---|
| `GET /opds` | Root OPDS navigation catalog |
| `GET /opds/opensearch.xml` | OpenSearch description |
| `GET /opds/search?q={query}&page={n}` | Search books |
| `GET /opds/book/:bookId/formats` | All available formats for a book |
| `GET /opds/library` | Your library (all statuses) |
| `GET /opds/library/:status` | Filter by: downloaded, reading, finished, want-to-read, favorite |
| `GET /opds/library/downloads` | Download history |
| `GET /opds/download/dl/:code?ext=epub` | Download proxy |
| `GET /opds/cover?url={coverUrl}` | Cover image proxy |

## REST API

| Endpoint | Description |
|---|---|
| `GET /api/auth/status` | Auth status |
| `POST /api/auth/login` | Login with email/password |
| `POST /api/auth/cookies` | Set cookies manually |
| `POST /api/auth/logout` | Clear cookies |
| `GET /api/formats/:bookId` | Get available formats |
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
- Z-Library auth via cookies (login or manual entry)

