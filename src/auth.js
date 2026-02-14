/**
 * Z-Library authentication & cookie management
 * Supports manual cookie entry and email/password login
 */

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
  const setCookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [];
  for (const sc of setCookies) {
    const parsed = parseSetCookie(sc);
    if (parsed) cookieJar[parsed.name] = parsed.value;
  }
}

/**
 * Check if the cookie jar contains real auth cookies
 */
function hasAuthCookies() {
  return !!(cookieJar['remix_userid'] || cookieJar['remix_userkey']);
}

/**
 * Initialize cookies from environment variable
 */
function initFromEnv() {
  const envCookies = process.env.ZLIB_COOKIES;
  if (envCookies) {
    parseCookieString(envCookies);
  }
  if (process.env.ZLIB_REMIX_USERID) {
    cookieJar['remix_userid'] = process.env.ZLIB_REMIX_USERID;
  }
  if (process.env.ZLIB_REMIX_USERKEY) {
    cookieJar['remix_userkey'] = process.env.ZLIB_REMIX_USERKEY;
  }
  if (hasAuthCookies()) {
    isAuthenticated = true;
    console.log('[Auth] Authenticated via environment variables');
  }
}

/**
 * Login to z-lib with email/password
 * z-lib returns 200 + homepage for both success & failure.
 * Success is detected by remix_userid / remix_userkey cookies being set.
 */
async function login(email, password, domain = 'https://z-lib.fm') {
  try {
    // Step 1: Get login page cookies (bsrv)
    const loginPageRes = await fetch(`${domain}/login`, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    storeCookiesFromResponse(loginPageRes);
    await loginPageRes.text();

    // Step 2: POST login
    const formData = new URLSearchParams();
    formData.append('email', email);
    formData.append('password', password);
    formData.append('site_mode', 'books');
    formData.append('action', 'login');
    formData.append('redirectUrl', '');

    const loginRes = await fetch(`${domain}/`, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: getCookieHeader(),
        Referer: `${domain}/login`,
        Origin: domain,
      },
      body: formData.toString(),
      redirect: 'follow',
    });
    storeCookiesFromResponse(loginRes);
    await loginRes.text();

    // Step 3: Check for auth cookies
    if (hasAuthCookies()) {
      isAuthenticated = true;
      authEmail = email;
      console.log('[Auth] Login successful for:', email);
      return { success: true, message: 'Login successful' };
    }

    return { success: false, message: 'Login failed — invalid email or password' };
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    return { success: false, message: `Login error: ${err.message}` };
  }
}

/**
 * Manually set cookies
 */
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
}

function getStatus() {
  return {
    authenticated: isAuthenticated,
    email: authEmail,
    cookieCount: Object.keys(cookieJar).length,
    cookieNames: Object.keys(cookieJar),
  };
}

initFromEnv();

module.exports = {
  getCookieHeader,
  storeCookiesFromResponse,
  login,
  setCookies,
  clearCookies,
  getStatus,
  hasAuthCookies,
  get isAuthenticated() { return isAuthenticated; },
};
