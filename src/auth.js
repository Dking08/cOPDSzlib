/**
 * Z-Library authentication & cookie management
 * Supports manual cookie entry and email/password login
 */

const ZLIB_BASE = 'https://z-lib.fm';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

// In-memory cookie jar
let cookieJar = {};
let isAuthenticated = false;
let authEmail = '';

/**
 * Parse a Set-Cookie header string into name/value
 */
function parseSetCookie(setCookieStr) {
  const parts = setCookieStr.split(';')[0].trim();
  const eqIdx = parts.indexOf('=');
  if (eqIdx === -1) return null;
  return {
    name: parts.substring(0, eqIdx).trim(),
    value: parts.substring(eqIdx + 1).trim(),
  };
}

/**
 * Parse a cookie string like "name1=val1; name2=val2" into the jar
 */
function parseCookieString(cookieStr) {
  if (!cookieStr) return;
  const pairs = cookieStr.split(';').map((s) => s.trim()).filter(Boolean);
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const name = pair.substring(0, eqIdx).trim();
    const value = pair.substring(eqIdx + 1).trim();
    if (name) cookieJar[name] = value;
  }
}

/**
 * Build a Cookie header string from the jar
 */
function getCookieHeader() {
  const entries = Object.entries(cookieJar);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Store cookies from a fetch Response's Set-Cookie headers
 */
function storeCookiesFromResponse(response) {
  // getSetCookie() is available in Node 20+
  const setCookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [];
  for (const sc of setCookies) {
    const parsed = parseSetCookie(sc);
    if (parsed) {
      cookieJar[parsed.name] = parsed.value;
    }
  }
}

/**
 * Initialize cookies from environment variable
 */
function initFromEnv() {
  const envCookies = process.env.ZLIB_COOKIES;
  if (envCookies) {
    parseCookieString(envCookies);
    isAuthenticated = true;
    console.log('[Auth] Loaded cookies from ZLIB_COOKIES env var');
    console.log('[Auth] Cookie names:', Object.keys(cookieJar).join(', '));
  }

  // Also support individual env vars
  if (process.env.ZLIB_REMIX_USERID) {
    cookieJar['remix_userid'] = process.env.ZLIB_REMIX_USERID;
    isAuthenticated = true;
  }
  if (process.env.ZLIB_REMIX_USERKEY) {
    cookieJar['remix_userkey'] = process.env.ZLIB_REMIX_USERKEY;
    isAuthenticated = true;
  }
}

/**
 * Login to z-lib.fm with email/password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function login(email, password) {
  try {
    // Step 1: Get the login page to collect initial cookies
    const loginPageRes = await fetch(`${ZLIB_BASE}/login`, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    storeCookiesFromResponse(loginPageRes);
    await loginPageRes.text(); // consume body

    // Step 2: POST login form
    const formData = new URLSearchParams();
    formData.append('email', email);
    formData.append('password', password);
    formData.append('site_mode', 'books');
    formData.append('action', 'login');
    formData.append('redirectUrl', '');

    const loginRes = await fetch(`${ZLIB_BASE}/`, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: getCookieHeader(),
        Referer: `${ZLIB_BASE}/login`,
        Origin: ZLIB_BASE,
      },
      body: formData.toString(),
      redirect: 'manual', // Don't follow redirect to capture cookies
    });

    storeCookiesFromResponse(loginRes);

    // Check if login was successful by looking for auth cookies
    const hasAuth =
      cookieJar['remix_userid'] ||
      cookieJar['remix_userkey'] ||
      cookieJar['logged_in'] ||
      cookieJar['session'];

    // Follow the redirect if any
    const location = loginRes.headers.get('location');
    if (location) {
      const followRes = await fetch(
        location.startsWith('http') ? location : `${ZLIB_BASE}${location}`,
        {
          headers: {
            'User-Agent': USER_AGENT,
            Cookie: getCookieHeader(),
          },
          redirect: 'follow',
        }
      );
      storeCookiesFromResponse(followRes);
      const html = await followRes.text();

      // Check if we're on a logged-in page
      const isLoggedIn =
        html.includes('logout') ||
        html.includes('mybooks') ||
        html.includes('profile') ||
        !html.includes('loginForm');

      if (isLoggedIn || hasAuth) {
        isAuthenticated = true;
        authEmail = email;
        console.log('[Auth] Login successful for:', email);
        console.log('[Auth] Cookie names:', Object.keys(cookieJar).join(', '));
        return { success: true, message: 'Login successful' };
      }
    }

    // If we got auth cookies directly (no redirect)
    if (hasAuth) {
      isAuthenticated = true;
      authEmail = email;
      console.log('[Auth] Login successful for:', email);
      return { success: true, message: 'Login successful' };
    }

    // Login might still work with just the bsrv cookie for downloads
    // Check if we have any new cookies
    if (Object.keys(cookieJar).length > 1) {
      isAuthenticated = true;
      authEmail = email;
      console.log('[Auth] Login completed (session cookies set) for:', email);
      return { success: true, message: 'Login completed - session cookies set' };
    }

    return { success: false, message: 'Login failed - no auth cookies received' };
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    return { success: false, message: `Login error: ${err.message}` };
  }
}

/**
 * Manually set cookies
 * @param {string} cookieStr - Cookie string like "name1=val1; name2=val2"
 */
function setCookies(cookieStr) {
  parseCookieString(cookieStr);
  isAuthenticated = Object.keys(cookieJar).length > 0;
  console.log('[Auth] Cookies updated:', Object.keys(cookieJar).join(', '));
}

/**
 * Clear all cookies
 */
function clearCookies() {
  cookieJar = {};
  isAuthenticated = false;
  authEmail = '';
  console.log('[Auth] Cookies cleared');
}

/**
 * Get auth status
 */
function getStatus() {
  return {
    authenticated: isAuthenticated,
    email: authEmail,
    cookieCount: Object.keys(cookieJar).length,
    cookieNames: Object.keys(cookieJar),
  };
}

// Initialize from env on module load
initFromEnv();

module.exports = {
  getCookieHeader,
  storeCookiesFromResponse,
  login,
  setCookies,
  clearCookies,
  getStatus,
  initFromEnv,
  get isAuthenticated() {
    return isAuthenticated;
  },
};
