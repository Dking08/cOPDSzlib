/**
 * Z-Library OPDS Bridge – Frontend SPA
 */

// ── State ────────────────────────────────────────────────────
const state = {
  currentPage: 'search',
  searchQuery: '',
  searchPage: 1,
  searchResults: [],
  searchTotal: 0,
  libraryFilter: '',
  libraryBooks: [],
  libraryTotal: 0,
  downloads: [],
  downloadsTotal: 0,
  auth: { authenticated: false, email: '', cookieNames: [] },
  mirrors: [],
  proxy: { enabled: false, type: null },
  stats: {},
};

// ── API Helpers ──────────────────────────────────────────────
const API = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  },
  async post(url, body = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  },
};

// ── Toast Notifications ──────────────────────────────────────
function toast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    el.style.transition = 'all 0.3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── Navigation ───────────────────────────────────────────────
function navigate(page) {
  state.currentPage = page;

  // Update nav
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Update pages
  document.querySelectorAll('.page').forEach((el) => {
    el.classList.toggle('active', el.id === `page-${page}`);
  });

  // Load data for page
  if (page === 'library') loadLibrary();
  if (page === 'downloads') loadDownloads();
  if (page === 'settings') loadSettings();
}

// ══════════════════════════════════════════════════════════════
//  SEARCH
// ══════════════════════════════════════════════════════════════

async function doSearch(query, page = 1) {
  if (!query.trim()) return;

  state.searchQuery = query;
  state.searchPage = page;

  const grid = document.getElementById('searchResults');
  const status = document.getElementById('searchStatus');
  const pagination = document.getElementById('searchPagination');

  status.classList.remove('hidden');
  status.innerHTML = `<span class="spinner"></span> Searching "${escHtml(query)}"...`;
  grid.innerHTML = '';
  pagination.classList.add('hidden');

  try {
    const data = await API.get(`/api/search?q=${encodeURIComponent(query)}&page=${page}`);
    state.searchResults = data.books || [];

    if (state.searchResults.length === 0) {
      status.textContent = `No results found for "${query}"`;
      return;
    }

    status.textContent = `Found ${state.searchResults.length} results for "${query}" (page ${page})`;
    renderBookGrid(grid, state.searchResults);

    // Pagination
    pagination.classList.remove('hidden');
    pagination.innerHTML = `
      <button ${page <= 1 ? 'disabled' : ''} onclick="doSearch('${escAttr(query)}', ${page - 1})">← Previous</button>
      <span style="padding:8px 16px;color:var(--text-muted)">Page ${page}</span>
      <button ${state.searchResults.length < 10 ? 'disabled' : ''} onclick="doSearch('${escAttr(query)}', ${page + 1})">Next →</button>
    `;
  } catch (err) {
    status.textContent = `Search failed: ${err.message}`;
    toast('Search failed: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  LIBRARY
// ══════════════════════════════════════════════════════════════

async function loadLibrary(status = state.libraryFilter) {
  state.libraryFilter = status;
  const grid = document.getElementById('libraryBooks');
  const empty = document.getElementById('libraryEmpty');

  // Update tabs
  document.querySelectorAll('#page-library .tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.status === status);
  });

  try {
    const url = status ? `/api/library?status=${status}` : '/api/library';
    const data = await API.get(url);
    state.libraryBooks = data.books || [];
    state.libraryTotal = data.total || 0;

    if (state.libraryBooks.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      renderBookGrid(grid, state.libraryBooks, true);
    }
  } catch (err) {
    toast('Failed to load library: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  DOWNLOADS
// ══════════════════════════════════════════════════════════════

async function loadDownloads() {
  const statsDiv = document.getElementById('downloadStats');
  const list = document.getElementById('downloadHistory');
  const empty = document.getElementById('downloadsEmpty');

  try {
    const [histData, statsData] = await Promise.all([
      API.get('/api/history/downloads?limit=50'),
      API.get('/api/stats'),
    ]);

    state.downloads = histData.downloads || [];
    state.downloadsTotal = histData.total || 0;

    // Stats row
    statsDiv.innerHTML = `
      <div class="stat-card"><div class="stat-number">${statsData.totalDownloads || 0}</div><div class="stat-label">Total Downloads</div></div>
      <div class="stat-card"><div class="stat-number">${statsData.totalSearches || 0}</div><div class="stat-label">Total Searches</div></div>
      <div class="stat-card"><div class="stat-number">${statsData.totalBooks || 0}</div><div class="stat-label">Books Tracked</div></div>
    `;

    if (state.downloads.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      list.innerHTML = state.downloads.map((d) => `
        <div class="download-item">
          <div class="dl-title">${escHtml(d.title || 'Unknown')}</div>
          <div class="dl-meta">${escHtml(d.author || '')}</div>
          <div class="book-tag format">${(d.extension || '').toUpperCase()}</div>
          <div class="dl-meta">${d.filesize || ''}</div>
          <div class="dl-meta">${formatDate(d.downloaded_at)}</div>
        </div>
      `).join('');
    }
  } catch (err) {
    toast('Failed to load downloads: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════════

async function loadSettings() {
  await Promise.all([loadAuthStatus(), loadMirrors(), loadProxyStatus(), loadStats()]);
  updateOpdsUrl();
}

async function loadAuthStatus() {
  try {
    const data = await API.get('/api/auth/status');
    state.auth = data;
    renderAuthUI();
    updateSidebarAuth();
  } catch (err) { /* ignore */ }
}

function renderAuthUI() {
  const loggedIn = document.getElementById('authLoggedIn');
  const loggedOut = document.getElementById('authLoggedOut');

  if (state.auth.authenticated) {
    loggedIn.classList.remove('hidden');
    loggedOut.classList.add('hidden');
    document.getElementById('authEmailDisplay').textContent = state.auth.email || 'Authenticated';
    document.getElementById('authCookieInfo').textContent = `Cookies: ${(state.auth.cookieNames || []).join(', ')}`;

    // Download quota info
    const dlInfo = document.getElementById('authDownloadInfo');
    if (state.auth.downloads) {
      const d = state.auth.downloads;
      dlInfo.textContent = `Downloads today: ${d.today} / ${d.limit} (${d.remaining} remaining)`;
    } else {
      dlInfo.textContent = '';
    }
  } else {
    loggedIn.classList.add('hidden');
    loggedOut.classList.remove('hidden');
  }
}

function updateSidebarAuth() {
  const badge = document.getElementById('authBadge');
  const label = document.getElementById('authLabel');
  if (state.auth.authenticated) {
    badge.className = 'auth-badge connected';
    label.textContent = state.auth.email || 'Connected';
  } else {
    badge.className = 'auth-badge disconnected';
    label.textContent = 'Not Connected';
  }
}

// Auth tab switching
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('authTabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('authTabRegister').classList.toggle('active', tab === 'register');
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const result = await API.post('/api/auth/login', { email, password });
    if (result.success) {
      toast('Login successful!', 'success');
      await loadAuthStatus();
    } else {
      toast(result.message || 'Login failed', 'error');
    }
  } catch (err) {
    toast('Login error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
}

// Registration Step 1: Send verification code
async function handleRegSendCode(e) {
  e.preventDefault();
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const name = document.getElementById('regName').value || 'User';
  const btn = document.getElementById('regSendCodeBtn');

  if (password.length < 6) {
    toast('Password must be at least 6 characters', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const result = await API.post('/api/auth/send-code', { email, password, name });
    if (result.success) {
      toast('Verification code sent! Check your email.', 'success');
      document.getElementById('regEmailDisplay').textContent = email;
      document.getElementById('regStep1').classList.add('hidden');
      document.getElementById('regStep2').classList.remove('hidden');
      document.getElementById('regCode').focus();
    } else {
      toast(result.message || 'Failed to send code', 'error');
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Code';
  }
}

// Registration Step 2: Verify code and complete registration
async function handleRegister(e) {
  e.preventDefault();
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const name = document.getElementById('regName').value || 'User';
  const code = document.getElementById('regCode').value;
  const btn = document.getElementById('regVerifyBtn');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const result = await API.post('/api/auth/register', { email, password, name, code });
    if (result.success) {
      toast('Account created & logged in!', 'success');
      await loadAuthStatus();
    } else {
      toast(result.message || 'Registration failed', 'error');
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify & Register';
  }
}

function regGoBack() {
  document.getElementById('regStep2').classList.add('hidden');
  document.getElementById('regStep1').classList.remove('hidden');
}

async function handleCookies(e) {
  e.preventDefault();
  const cookies = document.getElementById('cookieInput').value;
  try {
    const result = await API.post('/api/auth/cookies', { cookies });
    if (result.authenticated) {
      toast('Cookies set successfully!', 'success');
      await loadAuthStatus();
    } else {
      toast('Cookies set but no auth cookies detected', 'warning');
    }
  } catch (err) {
    toast('Failed to set cookies: ' + err.message, 'error');
  }
}

async function handleLogout() {
  try {
    await API.post('/api/auth/logout');
    toast('Logged out', 'info');
    await loadAuthStatus();
  } catch (err) {
    toast('Logout failed', 'error');
  }
}

async function loadMirrors() {
  try {
    const data = await API.get('/api/mirrors');
    state.mirrors = data.mirrors || [];
    renderMirrors();
    updateSidebarMirror();
  } catch (err) { /* ignore */ }
}

function renderMirrors() {
  const list = document.getElementById('mirrorList');
  list.innerHTML = state.mirrors.map((m) => `
    <div class="mirror-item ${m.active ? 'active' : ''}" onclick="selectMirror('${escAttr(m.url)}')">
      <span class="mirror-dot"></span>
      <span class="mirror-url">${escHtml(m.url)}</span>
      ${m.fails > 0 ? `<span class="mirror-fails">${m.fails} fails</span>` : ''}
      ${m.active ? '<span class="book-tag status">Active</span>' : ''}
    </div>
  `).join('');
}

function updateSidebarMirror() {
  const active = state.mirrors.find((m) => m.active);
  if (active) {
    document.getElementById('currentMirror').textContent = active.url.replace('https://', '');
  }
}

async function selectMirror(url) {
  try {
    await API.post('/api/mirrors', { url });
    toast(`Mirror set to ${url}`, 'success');
    await loadMirrors();
  } catch (err) {
    toast('Failed to set mirror', 'error');
  }
}

async function loadProxyStatus() {
  try {
    const data = await API.get('/api/proxy');
    state.proxy = data;
    document.getElementById('proxyStatus').textContent = data.enabled
      ? `Proxy active (${data.type})`
      : 'No proxy configured';
  } catch (err) { /* ignore */ }
}

async function handleProxy(e) {
  e.preventDefault();
  const url = document.getElementById('proxyUrl').value;
  try {
    const result = await API.post('/api/proxy', { url });
    toast(result.message || 'Proxy updated', result.success ? 'success' : 'error');
    await loadProxyStatus();
  } catch (err) {
    toast('Proxy error: ' + err.message, 'error');
  }
}

async function clearProxy() {
  try {
    const result = await API.post('/api/proxy', { url: '' });
    document.getElementById('proxyUrl').value = '';
    toast('Proxy cleared', 'info');
    await loadProxyStatus();
  } catch (err) {
    toast('Failed to clear proxy', 'error');
  }
}

function updateOpdsUrl() {
  const url = `${window.location.origin}/opds`;
  document.getElementById('opdsUrlDisplay').textContent = url;
}

function copyOpdsUrl() {
  const url = document.getElementById('opdsUrlDisplay').textContent;
  navigator.clipboard.writeText(url).then(() => toast('OPDS URL copied!', 'success'));
}

async function loadStats() {
  try {
    const data = await API.get('/api/stats');
    state.stats = data;
    const grid = document.getElementById('statsGrid');
    const byStatus = {};
    (data.libraryByStatus || []).forEach((s) => { byStatus[s.status] = s.count; });

    grid.innerHTML = `
      <div class="stat-card"><div class="stat-number">${data.totalBooks || 0}</div><div class="stat-label">Books Tracked</div></div>
      <div class="stat-card"><div class="stat-number">${data.totalDownloads || 0}</div><div class="stat-label">Downloads</div></div>
      <div class="stat-card"><div class="stat-number">${data.totalSearches || 0}</div><div class="stat-label">Searches</div></div>
      <div class="stat-card"><div class="stat-number">${byStatus['favorite'] || 0}</div><div class="stat-label">Favorites</div></div>
      <div class="stat-card"><div class="stat-number">${byStatus['reading'] || 0}</div><div class="stat-label">Reading</div></div>
      <div class="stat-card"><div class="stat-number">${byStatus['finished'] || 0}</div><div class="stat-label">Finished</div></div>
    `;
  } catch (err) { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════
//  BOOK GRID & CARDS
// ══════════════════════════════════════════════════════════════

function renderBookGrid(container, books, isLibrary = false) {
  container.innerHTML = books.map((book) => {
    const coverHtml = book.coverUrl
      ? `<img class="book-cover" src="/opds/cover?url=${encodeURIComponent(book.coverUrl)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'book-cover-placeholder\\'>📕</div>'">`
      : '<div class="book-cover-placeholder">📕</div>';

    const tags = [];
    if (book.extension) tags.push(`<span class="book-tag format">${book.extension.toUpperCase()}</span>`);
    if (book.filesize) tags.push(`<span class="book-tag">${book.filesize}</span>`);
    if (book.rating && book.rating !== '0') tags.push(`<span class="book-tag rating">★ ${book.rating}</span>`);
    if (isLibrary && book.lib_status) tags.push(`<span class="book-tag status">${book.lib_status}</span>`);

    return `
      <div class="book-card" onclick="openBookModal('${escAttr(book.id)}')">
        ${coverHtml}
        <div class="book-info">
          <div class="book-title">${escHtml(book.title)}</div>
          <div class="book-author">${escHtml(book.author)}</div>
          <div class="book-meta">${tags.join('')}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
//  BOOK MODAL
// ══════════════════════════════════════════════════════════════

async function openBookModal(bookId) {
  const modal = document.getElementById('bookModal');
  const detail = document.getElementById('bookDetail');

  // Find book in current data
  let book = state.searchResults.find((b) => b.id === bookId)
    || state.libraryBooks.find((b) => b.id === bookId);

  if (!book) {
    // Try to fetch from API
    try {
      const data = await API.get(`/api/book/${bookId}`);
      book = data;
    } catch {
      toast('Book not found', 'error');
      return;
    }
  }

  // Check library status
  let libraryStatus = null;
  try {
    const libData = await API.get(`/api/library/status/${bookId}`);
    libraryStatus = libData.statuses || [];
  } catch { libraryStatus = []; }

  const coverHtml = book.coverUrl
    ? `<img class="detail-cover" src="/opds/cover?url=${encodeURIComponent(book.coverUrl)}" alt="" onerror="this.style.display='none'">`
    : '<div class="detail-cover" style="display:flex;align-items:center;justify-content:center;font-size:40px">📕</div>';

  const statuses = ['favorite', 'reading', 'finished', 'want-to-read'];
  const statusLabels = { 'favorite': '❤️ Favorite', 'reading': '📖 Reading', 'finished': '✅ Finished', 'want-to-read': '📌 Want to Read' };

  const statusBtns = statuses.map((s) => {
    const active = libraryStatus.includes(s);
    return `<button class="btn ${active ? 'active-status' : ''}" onclick="toggleLibraryStatus('${escAttr(bookId)}', '${s}', ${!active})">${statusLabels[s]}</button>`;
  }).join('');

  detail.innerHTML = `
    <div class="detail-header">
      ${coverHtml}
      <div class="detail-info">
        <div class="detail-title">${escHtml(book.title)}</div>
        <div class="detail-author">${escHtml(book.author)}</div>
        <div class="detail-meta">
          ${book.publisher ? `<div><strong>Publisher:</strong> ${escHtml(book.publisher)}</div>` : ''}
          ${book.year ? `<div><strong>Year:</strong> ${escHtml(book.year)}</div>` : ''}
          ${book.language ? `<div><strong>Language:</strong> ${escHtml(book.language)}</div>` : ''}
          ${book.isbn ? `<div><strong>ISBN:</strong> ${escHtml(book.isbn)}</div>` : ''}
          ${book.extension ? `<div><strong>Format:</strong> ${book.extension.toUpperCase()} ${book.filesize ? '(' + book.filesize + ')' : ''}</div>` : ''}
          ${book.rating && book.rating !== '0' ? `<div><strong>Rating:</strong> ★ ${book.rating}</div>` : ''}
        </div>
      </div>
    </div>

    <div class="detail-actions">
      <h4>Library</h4>
      <div class="action-group">${statusBtns}</div>

      <h4>Download</h4>
      <div class="action-group">
        ${book.download
          ? `<button class="btn btn-primary" onclick="downloadBook('${escAttr(book.id)}', '${escAttr(book.download)}', '${escAttr(book.extension || 'epub')}')">
               ⬇️ Download ${(book.extension || 'EPUB').toUpperCase()} ${book.filesize ? '(' + book.filesize + ')' : ''}
             </button>`
          : '<span class="text-muted">No direct download available</span>'
        }
        <button class="btn" onclick="loadFormats('${escAttr(book.id)}')">📦 More Formats</button>
      </div>
      <div id="formatsContainer-${bookId}"></div>
    </div>
  `;

  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('bookModal').classList.add('hidden');
}

async function toggleLibraryStatus(bookId, status, add) {
  try {
    if (add) {
      await API.post('/api/library/add', { bookId, status });
      toast(`Added to ${status}`, 'success');
    } else {
      await API.post('/api/library/remove', { bookId, status });
      toast(`Removed from ${status}`, 'info');
    }
    // Refresh modal
    openBookModal(bookId);
    // Refresh library if visible
    if (state.currentPage === 'library') loadLibrary();
  } catch (err) {
    toast('Failed to update library', 'error');
  }
}

async function loadFormats(bookId) {
  const container = document.getElementById(`formatsContainer-${bookId}`);
  if (!container) return;

  container.innerHTML = '<div style="padding:12px;color:var(--text-dim)"><span class="spinner"></span> Loading formats...</div>';

  try {
    const data = await API.get(`/api/formats/${bookId}`);
    const formats = data.formats || [];

    if (formats.length === 0) {
      container.innerHTML = '<div style="padding:8px;color:var(--text-dim)">No additional formats found</div>';
      return;
    }

    container.innerHTML = `
      <div class="format-grid" style="margin-top:10px">
        ${formats.map((f) => `
          <button class="format-btn" onclick="downloadBook('${escAttr(bookId)}', '${escAttr(f.href)}', '${escAttr(f.extension)}')">
            <span class="ext">${(f.extension || '').toUpperCase()}</span>
            <span class="size">${f.filesizeString || f.filesize || ''}</span>
          </button>
        `).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div style="padding:8px;color:var(--danger)">Failed to load formats: ${err.message}</div>`;
  }
}

async function downloadBook(bookId, dlPath, ext) {
  if (!dlPath) {
    toast('No download path available', 'error');
    return;
  }

  toast('Starting download...', 'info');

  // Build download URL
  const code = dlPath.replace(/^\/dl\//, '');
  const url = `/opds/download/dl/${code}?ext=${encodeURIComponent(ext)}&id=${encodeURIComponent(bookId)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      toast(errData.error || 'Download failed', 'error', 5000);
      return;
    }

    // Trigger browser download
    const blob = await res.blob();
    const contentDisp = res.headers.get('content-disposition') || '';
    let filename = `book.${ext}`;
    const match = contentDisp.match(/filename[^;=\n]*=["']?([^"';\n]*)["']?/i);
    if (match) filename = match[1];

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);

    toast(`Downloaded: ${filename}`, 'success');
    if (state.currentPage === 'downloads') loadDownloads();
  } catch (err) {
    toast('Download failed: ' + err.message, 'error', 5000);
  }
}

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return dateStr; }
}

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Navigation
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(el.dataset.page);
    });
  });

  // Search
  document.getElementById('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('searchInput').value.trim();
    if (q) doSearch(q, 1);
  });

  // Library tabs
  document.querySelectorAll('#page-library .tab').forEach((t) => {
    t.addEventListener('click', () => loadLibrary(t.dataset.status));
  });

  // Auth
  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('cookieForm').addEventListener('submit', handleCookies);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);

  // Auth tabs
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.addEventListener('click', () => switchAuthTab(t.dataset.tab));
  });

  // Registration
  document.getElementById('regForm').addEventListener('submit', handleRegSendCode);
  document.getElementById('regVerifyForm').addEventListener('submit', handleRegister);
  document.getElementById('regBackBtn').addEventListener('click', regGoBack);

  // Proxy
  document.getElementById('proxyForm').addEventListener('submit', handleProxy);
  document.getElementById('clearProxyBtn').addEventListener('click', clearProxy);

  // OPDS copy
  document.getElementById('copyOpdsBtn').addEventListener('click', copyOpdsUrl);

  // Modal close
  document.querySelector('.modal-backdrop').addEventListener('click', closeModal);
  document.querySelector('.modal-close').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Load initial state
  loadAuthStatus();
  loadMirrors();
});
