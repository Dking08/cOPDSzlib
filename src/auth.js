/**
 * Z-Library authentication module
 * Supports: in-app registration (email verification), login, auto-refresh
 * Endpoints discovered:
 *   /papi/user/verification/send-code — send 4-digit code to email
 *   /rpc.php?action=registration      — register with verifyCode
 *   /rpc.php?action=login             — login (returns JSON with gg_json_mode)
 */

const DOMAIN = 'https://z-lib.fm';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

// ── State ─────────────────────────────────────────────────────
let cookieJar = {};
let isAuthenticated = false;
let authEmail = '';
let storedPassword = '';   // kept for auto-refresh
let dailyDownloads = 0;
let dailyReset = new Date().toDateString();

// ── Cookie helpers ────────────────────────────────────────────

function parseSetCookie(str) {
  const parts = str.split(';')[0].trim();
  const eq = parts.indexOf('=');
  if (eq === -1) return null;
  return { name: parts.substring(0, eq).trim(), value: parts.substring(eq + 1).trim() };
}

function parseCookieString(cookieStr) {
  if (!cookieStr) return;
  for (const pair of cookieStr.split(';').map(s => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.substring(0, eq).trim();
    const value = pair.substring(eq + 1).trim();
    if (name) cookieJar[name] = value;
  }
}

function getCookieHeader() {
  const entries = Object.entries(cookieJar);
  return entries.length === 0 ? '' : entries.map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookiesFromResponse(response) {
  const setCookies = response.headers.getSetCookie?.() || [];
  for (const sc of setCookies) {
    const p = parseSetCookie(sc);
    if (p) cookieJar[p.name] = p.value;
  }
}

function hasAuthCookies() {
  return !!(cookieJar.remix_userid && cookieJar.remix_userkey);
}

// ── Download counter ──────────────────────────────────────────

function trackDownload() {
  const today = new Date().toDateString();
  if (today !== dailyReset) { dailyDownloads = 0; dailyReset = today; }
  dailyDownloads++;
}

function getDownloadCount() {
  const today = new Date().toDateString();
  if (today !== dailyReset) { dailyDownloads = 0; dailyReset = today; }
  return dailyDownloads;
}

function getDownloadLimit() {
  return isAuthenticated ? 10 : 5;
}

// ── Helpers ───────────────────────────────────────────────────

async function ensureBsrvCookie() {
  if (cookieJar.bsrv) return;
  try {
    const res = await fetch(`${DOMAIN}/registration`, {
      headers: { 'User-Agent': USER_AGENT }, redirect: 'follow',
    });
    storeCookiesFromResponse(res);
    await res.text();
  } catch (e) {
    console.error('[Auth] Failed to get bsrv cookie:', e.message);
  }
}

async function getRxValue() {
  try {
    const res = await fetch(`${DOMAIN}/registration`, {
      headers: { 'User-Agent': USER_AGENT }, redirect: 'follow',
    });
    storeCookiesFromResponse(res);
    const html = await res.text();
    const m = html.match(/jsRXValue.*?value\s*=\s*(\d+)/);
    return m ? m[1] : '215';
  } catch (_) { return '215'; }
}

// ══════════════════════════════════════════════════════════════
//  REGISTRATION  (in-app, 2 steps)
// ══════════════════════════════════════════════════════════════

/**
 * Step 1: Send 4-digit verification code to email
 */
async function sendVerificationCode(email, password, name) {
  try {
    const rx = await getRxValue();
    const body = new URLSearchParams({
      email, password, name, rx,
      action: 'registration', redirectUrl: '',
    });
    const res = await fetch(`${DOMAIN}/papi/user/verification/send-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Cookie: getCookieHeader(),
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${DOMAIN}/registration`,
      },
      body: body.toString(),
    });
    storeCookiesFromResponse(res);
    const data = await res.json();
    if (data.success === 1) {
      console.log('[Auth] Verification code sent to:', email);
      return { success: true, message: `Verification code sent to ${email}. Check your inbox (and spam).` };
    }
    return { success: false, message: data.error || 'Failed to send verification code' };
  } catch (err) {
    console.error('[Auth] sendVerificationCode error:', err.message);
    return { success: false, message: `Error: ${err.message}` };
  }
}

/**
 * Step 2: Complete registration with the 4-digit code
 */
async function register(email, password, name, verifyCode) {
  try {
    await ensureBsrvCookie();
    const rx = await getRxValue();
    const body = new URLSearchParams({
      email, password, name, rx,
      action: 'registration', redirectUrl: '',
      gg_json_mode: '1', verifyCode,
    });
    const res = await fetch(`${DOMAIN}/rpc.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Cookie: getCookieHeader(),
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${DOMAIN}/registration`,
        Origin: DOMAIN,
      },
      body: body.toString(),
      redirect: 'manual',
    });
    storeCookiesFromResponse(res);
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch (_) {}

    if (json?.response?.validationError) {
      return { success: false, message: json.response.message || 'Validation error' };
    }
    if (hasAuthCookies()) {
      isAuthenticated = true; authEmail = email; storedPassword = password;
      console.log('[Auth] Registration successful for:', email);
      return { success: true, message: 'Account created! You are now logged in.', email };
    }
    if (json?.response?.user_id) {
      console.log('[Auth] Registration returned user_id, attempting login...');
      return await login(email, password);
    }
    return {
      success: false,
      message: json?.response?.message || json?.errors?.[0]?.message || 'Registration failed. Check the code and try again.',
    };
  } catch (err) {
    console.error('[Auth] register error:', err.message);
    return { success: false, message: `Error: ${err.message}` };
  }
}

// ══════════════════════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════════════════════

async function login(email, password) {
  try {
    // Method 1: RPC endpoint (JSON response)
    await ensureBsrvCookie();
    const rpcBody = new URLSearchParams({
      email, password,
      action: 'login', gg_json_mode: '1',
      isModal: 'true', redirectUrl: '',
    });
    const rpcRes = await fetch(`${DOMAIN}/rpc.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Cookie: getCookieHeader(),
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${DOMAIN}/login`, Origin: DOMAIN,
      },
      body: rpcBody.toString(),
      redirect: 'manual',
    });
    storeCookiesFromResponse(rpcRes);
    if (hasAuthCookies()) {
      isAuthenticated = true; authEmail = email; storedPassword = password;
      console.log('[Auth] Login successful via RPC for:', email);
      return { success: true, message: 'Login successful' };
    }

    // Method 2: Traditional form POST
    const loginPageRes = await fetch(`${DOMAIN}/login`, {
      headers: { 'User-Agent': USER_AGENT }, redirect: 'follow',
    });
    storeCookiesFromResponse(loginPageRes);
    await loginPageRes.text();

    const formBody = new URLSearchParams({
      email, password, site_mode: 'books',
      action: 'login', redirectUrl: '',
    });
    const loginRes = await fetch(`${DOMAIN}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Cookie: getCookieHeader(),
        Referer: `${DOMAIN}/login`, Origin: DOMAIN,
      },
      body: formBody.toString(),
      redirect: 'follow',
    });
    storeCookiesFromResponse(loginRes);
    await loginRes.text();

    if (hasAuthCookies()) {
      isAuthenticated = true; authEmail = email; storedPassword = password;
      console.log('[Auth] Login successful via form for:', email);
      return { success: true, message: 'Login successful' };
    }
    return { success: false, message: 'Login failed — invalid email or password' };
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    return { success: false, message: `Login error: ${err.message}` };
  }
}

/**
 * Auto-refresh session if cookies expired (called before downloads)
 */
async function ensureSession() {
  if (hasAuthCookies()) return true;
  if (!storedPassword || !authEmail) return false;
  console.log('[Auth] Session expired, auto-refreshing...');
  const result = await login(authEmail, storedPassword);
  return result.success;
}

// ── Manual cookie methods ─────────────────────────────────────

function setCookies(cookieStr) {
  parseCookieString(cookieStr);
  isAuthenticated = hasAuthCookies();
  console.log('[Auth] Cookies set:', Object.keys(cookieJar).join(', '));
  return isAuthenticated;
}

function clearCookies() {
  cookieJar = {};
  isAuthenticated = false;
  authEmail = '';
  storedPassword = '';
  dailyDownloads = 0;
}

function getStatus() {
  return {
    authenticated: isAuthenticated,
    email: authEmail,
    cookieCount: Object.keys(cookieJar).length,
    cookieNames: Object.keys(cookieJar),
    downloads: {
      today: getDownloadCount(),
      limit: getDownloadLimit(),
      remaining: Math.max(0, getDownloadLimit() - getDownloadCount()),
    },
  };
}

// ── Init from env ─────────────────────────────────────────────

function initFromEnv() {
  if (process.env.ZLIB_COOKIES) parseCookieString(process.env.ZLIB_COOKIES);
  if (process.env.ZLIB_REMIX_USERID) cookieJar.remix_userid = process.env.ZLIB_REMIX_USERID;
  if (process.env.ZLIB_REMIX_USERKEY) cookieJar.remix_userkey = process.env.ZLIB_REMIX_USERKEY;
  if (process.env.ZLIB_EMAIL) authEmail = process.env.ZLIB_EMAIL;
  if (process.env.ZLIB_PASSWORD) storedPassword = process.env.ZLIB_PASSWORD;
  if (hasAuthCookies()) {
    isAuthenticated = true;
    console.log('[Auth] Authenticated via environment variables');
  }
}

initFromEnv();

module.exports = {
  getCookieHeader,
  storeCookiesFromResponse,
  sendVerificationCode,
  register,
  login,
  ensureSession,
  setCookies,
  clearCookies,
  getStatus,
  hasAuthCookies,
  trackDownload,
  getDownloadCount,
  getDownloadLimit,
  get isAuthenticated() { return isAuthenticated; },
};
