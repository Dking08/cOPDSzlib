/**
 * SQLite-backed user library for tracking books
 * Stores: downloaded books, favorites, reading status, and history
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'library.db');

let db;

function getDb() {
  if (!db) {
    // Ensure data directory exists
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- Books we've seen / downloaded
    CREATE TABLE IF NOT EXISTS books (
      id           TEXT PRIMARY KEY,   -- book MD5 hash
      title        TEXT NOT NULL,
      author       TEXT DEFAULT '',
      isbn         TEXT DEFAULT '',
      publisher    TEXT DEFAULT '',
      language     TEXT DEFAULT '',
      year         TEXT DEFAULT '',
      extension    TEXT DEFAULT '',
      filesize     TEXT DEFAULT '',
      rating       TEXT DEFAULT '',
      cover_url    TEXT DEFAULT '',
      download     TEXT DEFAULT '',    -- /dl/ path
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- User's library actions
    CREATE TABLE IF NOT EXISTS library (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id      TEXT NOT NULL REFERENCES books(id),
      status       TEXT NOT NULL DEFAULT 'downloaded',  
                   -- downloaded | reading | finished | want-to-read | favorite
      progress     REAL DEFAULT 0,    -- reading progress 0.0-1.0
      notes        TEXT DEFAULT '',
      added_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(book_id, status)
    );

    -- Download history log
    CREATE TABLE IF NOT EXISTS download_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id      TEXT NOT NULL,
      title        TEXT NOT NULL,
      author       TEXT DEFAULT '',
      extension    TEXT DEFAULT '',
      filesize     TEXT DEFAULT '',
      dl_path      TEXT NOT NULL,
      downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Search history
    CREATE TABLE IF NOT EXISTS search_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      query        TEXT NOT NULL,
      result_count INTEGER DEFAULT 0,
      searched_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ─── Book Operations ──────────────────────────────────────────

function upsertBook(book) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO books (id, title, author, isbn, publisher, language, year, extension, filesize, rating, cover_url, download)
    VALUES (@id, @title, @author, @isbn, @publisher, @language, @year, @extension, @filesize, @rating, @cover_url, @download)
    ON CONFLICT(id) DO UPDATE SET
      title=@title, author=@author, isbn=@isbn, publisher=@publisher,
      language=@language, year=@year, extension=@extension, filesize=@filesize,
      rating=@rating, cover_url=@cover_url, download=@download
  `);
  stmt.run({
    id: book.id,
    title: book.title || 'Unknown',
    author: book.author || '',
    isbn: book.isbn || '',
    publisher: book.publisher || '',
    language: book.language || '',
    year: book.year || '',
    extension: book.extension || '',
    filesize: book.filesize || '',
    rating: book.rating || '',
    cover_url: book.coverUrl || book.cover_url || '',
    download: book.download || '',
  });
}

function getBook(bookId) {
  return getDb().prepare('SELECT * FROM books WHERE id = ?').get(bookId);
}

// ─── Library Operations ──────────────────────────────────────

function addToLibrary(bookId, status = 'downloaded') {
  const d = getDb();
  d.prepare(`
    INSERT INTO library (book_id, status) VALUES (?, ?)
    ON CONFLICT(book_id, status) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
  `).run(bookId, status);
}

function removeFromLibrary(bookId, status) {
  getDb().prepare('DELETE FROM library WHERE book_id = ? AND status = ?').run(bookId, status);
}

function updateProgress(bookId, progress) {
  getDb().prepare(`
    UPDATE library SET progress = ?, updated_at = CURRENT_TIMESTAMP
    WHERE book_id = ? AND status IN ('reading', 'downloaded')
  `).run(progress, bookId);
}

function getLibraryBooks(status = null, limit = 50, offset = 0) {
  const d = getDb();
  if (status) {
    return d.prepare(`
      SELECT b.*, l.status as lib_status, l.progress, l.added_at as lib_added_at, l.notes
      FROM library l JOIN books b ON l.book_id = b.id
      WHERE l.status = ?
      ORDER BY l.updated_at DESC LIMIT ? OFFSET ?
    `).all(status, limit, offset);
  }
  return d.prepare(`
    SELECT b.*, l.status as lib_status, l.progress, l.added_at as lib_added_at, l.notes
    FROM library l JOIN books b ON l.book_id = b.id
    ORDER BY l.updated_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
}

function getLibraryCount(status = null) {
  const d = getDb();
  if (status) {
    return d.prepare('SELECT COUNT(*) as count FROM library WHERE status = ?').get(status).count;
  }
  return d.prepare('SELECT COUNT(*) as count FROM library').get().count;
}

function isInLibrary(bookId) {
  const rows = getDb().prepare('SELECT status FROM library WHERE book_id = ?').all(bookId);
  return rows.map((r) => r.status);
}

// ─── Download History ─────────────────────────────────────────

function logDownload(book) {
  getDb().prepare(`
    INSERT INTO download_history (book_id, title, author, extension, filesize, dl_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(book.id || book.book_id, book.title, book.author || '', book.extension || '', book.filesize || '', book.download || book.dl_path || '');
}

function getDownloadHistory(limit = 50, offset = 0) {
  return getDb().prepare(
    'SELECT * FROM download_history ORDER BY downloaded_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
}

function getDownloadCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM download_history').get().count;
}

// ─── Search History ───────────────────────────────────────────

function logSearch(query, resultCount) {
  getDb().prepare(
    'INSERT INTO search_history (query, result_count) VALUES (?, ?)'
  ).run(query, resultCount);
}

function getSearchHistory(limit = 20) {
  return getDb().prepare(
    'SELECT * FROM search_history ORDER BY searched_at DESC LIMIT ?'
  ).all(limit);
}

function getRecentSearches(limit = 10) {
  return getDb().prepare(`
    SELECT query, MAX(searched_at) as last_searched, COUNT(*) as times, MAX(result_count) as results
    FROM search_history GROUP BY query ORDER BY last_searched DESC LIMIT ?
  `).all(limit);
}

// ─── Stats ────────────────────────────────────────────────────

function getStats() {
  const d = getDb();
  return {
    totalBooks: d.prepare('SELECT COUNT(*) as c FROM books').get().c,
    totalDownloads: d.prepare('SELECT COUNT(*) as c FROM download_history').get().c,
    totalSearches: d.prepare('SELECT COUNT(*) as c FROM search_history').get().c,
    libraryByStatus: d.prepare(`
      SELECT status, COUNT(*) as count FROM library GROUP BY status
    `).all(),
    recentDownloads: d.prepare(
      'SELECT * FROM download_history ORDER BY downloaded_at DESC LIMIT 5'
    ).all(),
    recentSearches: getRecentSearches(5),
  };
}

module.exports = {
  getDb,
  upsertBook,
  getBook,
  addToLibrary,
  removeFromLibrary,
  updateProgress,
  getLibraryBooks,
  getLibraryCount,
  isInLibrary,
  getBookStatuses: isInLibrary,
  logDownload,
  getDownloadHistory,
  getDownloadCount,
  logSearch,
  getSearchHistory,
  getRecentSearches,
  getStats,
};
