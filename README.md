# Readest Z-Library OPDS Bridge

An OPDS 1.2 catalog server that bridges [Readest](https://readest.com) to Z-Library, allowing you to search and download books directly from Readest's OPDS reader.

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

## Deploy to Railway

1. Push this repo to GitHub
2. Connect to [Railway](https://railway.app)
3. Set environment variable: `BASE_URL=https://your-app.up.railway.app`
4. Railway auto-detects the Dockerfile and deploys

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
| `GET /opds/download/dl/:code?ext=epub` | Download proxy |
| `GET /opds/cover?url={coverUrl}` | Cover image proxy |

## Usage in Readest

1. Open Readest → Settings → OPDS Catalogs
2. Add new catalog with URL: `https://your-deployed-url/opds`
3. Search for any book — results appear with covers, metadata, and download links
4. Tap a book to download it directly into Readest

## Tech Stack

- **Node.js 18+** with native `fetch`
- **Express** for HTTP routing
- **Cheerio** for HTML parsing
- Zero external auth required — uses public z-lib.fm search
