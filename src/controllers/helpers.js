const jwt = require('jsonwebtoken');
const Joi = require('joi');
const crypto = require('crypto');

const WEB_ACCESS_SECRET = process.env.ACCESS_TOKEN_PRIVATE_KEY_WEB || process.env.ACCESS_TOKEN_PRIVATE_KEY;
const DEVICE_ACCESS_SECRET = process.env.ACCESS_TOKEN_PRIVATE_KEY_DEVICE || process.env.ACCESS_TOKEN_PRIVATE_KEY;
const BRGY_ACCESS_SECRET =
  process.env.ACCESS_TOKEN_PRIVATE_KEY_BRGY ||
  DEVICE_ACCESS_SECRET ||
  WEB_ACCESS_SECRET;
const WEB_REFRESH_SECRET =
  process.env.REFRESH_TOKEN_PRIVATE_KEY_WEB ||
  process.env.REFRESH_TOKEN_PRIVATE_KEY ||
  WEB_ACCESS_SECRET;
const DEVICE_REFRESH_SECRET =
  process.env.REFRESH_TOKEN_PRIVATE_KEY || DEVICE_ACCESS_SECRET;
const BRGY_REFRESH_SECRET =
  process.env.REFRESH_TOKEN_PRIVATE_KEY_BRGY ||
  DEVICE_REFRESH_SECRET ||
  WEB_REFRESH_SECRET;
const PASSWORD_RESET_SECRET =
  process.env.PASSWORD_RESET_TOKEN_KEY || WEB_ACCESS_SECRET;

const WEB_ACCESS_EXPIRY = process.env.JWT_WEB_EXPIRY || '12h';
const DEVICE_ACCESS_EXPIRY = process.env.JWT_DEVICE_EXPIRY || process.env.JWT_EXPIRY || '12h';
const BRGY_ACCESS_EXPIRY = process.env.JWT_BRGY_EXPIRY || '365d';
const WEB_REFRESH_EXPIRY = process.env.REFRESH_TOKEN_WEB_EXPIRY || '30 days';
const DEVICE_REFRESH_EXPIRY =
  process.env.REFRESH_TOKEN_DEVICE_EXPIRY || process.env.REFRESH_TOKEN_EXPIRY || '90 days';
const BRGY_REFRESH_EXPIRY = process.env.REFRESH_TOKEN_BRGY_EXPIRY || '365d';
const USERNAME_MIN_LENGTH = parseInt(process.env.USERNAME_MIN_LENGTH, 10) || 3;
const USERNAME_MAX_LENGTH = parseInt(process.env.USERNAME_MAX_LENGTH, 10) || 32;

let USERNAME_ALLOWED_PATTERN = /^[a-zA-Z0-9._-]+$/;
if (process.env.USERNAME_ALLOWED_PATTERN) {
  try {
    USERNAME_ALLOWED_PATTERN = new RegExp(process.env.USERNAME_ALLOWED_PATTERN);
  } catch (err) {
    console.warn(
      `Invalid USERNAME_ALLOWED_PATTERN provided; falling back to default. ${err?.message || err}`
    );
  }
}

function getAccessTokenSecret(scope = 'web') {
  if (scope === 'device') return DEVICE_ACCESS_SECRET;
  if (scope === 'brgy') return BRGY_ACCESS_SECRET;
  return WEB_ACCESS_SECRET;
}

function getRefreshTokenSecret(scope = 'web') {
  if (scope === 'device') return DEVICE_REFRESH_SECRET;
  if (scope === 'brgy') return BRGY_REFRESH_SECRET;
  return WEB_REFRESH_SECRET;
}

function getPasswordResetSecret() {
  return PASSWORD_RESET_SECRET;
}

function generateAccessToken(payload, scope = 'web') {
  let expiresIn = WEB_ACCESS_EXPIRY;
  if (scope === 'device') {
    expiresIn = DEVICE_ACCESS_EXPIRY;
  } else if (scope === 'brgy') {
    expiresIn = BRGY_ACCESS_EXPIRY;
  }
  return jwt.sign(payload, getAccessTokenSecret(scope), {
    expiresIn, // Adds 'exp' in seconds since epoch
  });
}

function generateRefreshToken(payload, scope = 'web') {
  let expiresIn = WEB_REFRESH_EXPIRY;
  if (scope === 'device') {
    expiresIn = DEVICE_REFRESH_EXPIRY;
  } else if (scope === 'brgy') {
    expiresIn = BRGY_REFRESH_EXPIRY;
  }
  return jwt.sign(payload, getRefreshTokenSecret(scope), {
    expiresIn,
  });
}

function parseDurationToMs(input, fallbackMs = 0) {
  if (!input && input !== 0) return fallbackMs;
  if (typeof input === 'number' && Number.isFinite(input)) return input;

  const str = String(input).trim();
  const match = str.match(/^(\d+)\s*(milliseconds?|ms|seconds?|s|minutes?|mins?|m|hours?|hrs?|h|days?|day|d|weeks?|w)?$/i);
  if (!match) return fallbackMs;

  const value = parseInt(match[1], 10);
  const unit = (match[2] || 'ms').toLowerCase();
  const unitToMs = {
    ms: 1,
    millisecond: 1,
    milliseconds: 1,
    s: 1000,
    second: 1000,
    seconds: 1000,
    m: 1000 * 60,
    min: 1000 * 60,
    mins: 1000 * 60,
    minute: 1000 * 60,
    minutes: 1000 * 60,
    h: 1000 * 60 * 60,
    hr: 1000 * 60 * 60,
    hrs: 1000 * 60 * 60,
    hour: 1000 * 60 * 60,
    hours: 1000 * 60 * 60,
    d: 1000 * 60 * 60 * 24,
    day: 1000 * 60 * 60 * 24,
    days: 1000 * 60 * 60 * 24,
    w: 1000 * 60 * 60 * 24 * 7,
    week: 1000 * 60 * 60 * 24 * 7,
    weeks: 1000 * 60 * 60 * 24 * 7,
  };

  const multiplier = unitToMs[unit];
  if (!multiplier) return fallbackMs;
  return value * multiplier;
}

const ACCESS_TOKEN_MAX_AGE_MS = parseDurationToMs(WEB_ACCESS_EXPIRY, 1000 * 60 * 60 * 12);
const REFRESH_TOKEN_MAX_AGE_MS = parseDurationToMs(
  WEB_REFRESH_EXPIRY,
  1000 * 60 * 60 * 24 * 30
);

const COOKIE_BASE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

function cookieOptions(maxAgeMs) {
  return { ...COOKIE_BASE_OPTIONS, maxAge: maxAgeMs };
}

function setSessionCookies(res, payload) {
  // The CSRF value is readable by the same-site admin SPA, while its signed
  // copy stays inside the HttpOnly access token. A sibling site cannot forge
  // both values, and unsafe requests must also send it in a custom header.
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const sessionPayload = { ...payload, csrfToken };
  const accessToken = generateAccessToken(sessionPayload, 'web');
  const refreshToken = generateRefreshToken(sessionPayload, 'web');

  res.cookie('accessToken', accessToken, cookieOptions(ACCESS_TOKEN_MAX_AGE_MS));
  res.cookie('refreshToken', refreshToken, cookieOptions(REFRESH_TOKEN_MAX_AGE_MS));
  res.cookie('csrfToken', csrfToken, {
    ...cookieOptions(ACCESS_TOKEN_MAX_AGE_MS),
    httpOnly: false,
    sameSite: 'strict',
  });

  return { accessToken, refreshToken, csrfToken };
}

function clearSessionCookies(res) {
  const clearOpts = {
    path: COOKIE_BASE_OPTIONS.path,
    sameSite: COOKIE_BASE_OPTIONS.sameSite,
    secure: COOKIE_BASE_OPTIONS.secure,
    httpOnly: COOKIE_BASE_OPTIONS.httpOnly,
  };
  res.clearCookie('accessToken', clearOpts);
  res.clearCookie('refreshToken', clearOpts);
  res.clearCookie('csrfToken', { ...clearOpts, httpOnly: false, sameSite: 'strict' });
}

const blockedPasswords = new Set([
  'password',
  'password123',
  '12345678',
  '123456789',
  'qwerty',
  'letmein',
  'welcome',
  'admin',
  'earthquake',
  'upri',
  'citizen',
  'brgy',
]);

const CURRENT_PASSWORD_POLICY_VERSION = 2;
const LEGACY_PASSWORD_POLICY_VERSION = 1;

function validatePasswordStrength(value, helpers) {
  const normalized = (value || '').trim();
  const lower = normalized.toLowerCase();

  if (blockedPasswords.has(lower)) {
    return helpers.message('Choose a less common password.');
  }

  if (/^\d+$/.test(normalized)) {
    return helpers.message('Password cannot be numbers only.');
  }

  if (/^(.)\1{7,}$/.test(normalized)) {
    return helpers.message('Avoid repeating the same character.');
  }

  return value;
}

function passwordSchema(label = 'Password') {
  return Joi.string()
    .min(12)
    .max(128)
    .custom(validatePasswordStrength, 'basic password safety checks')
    .messages({
      'string.min': `${label} must be at least 12 characters.`,
      'string.max': `${label} must be 128 characters or fewer.`,
    });
}

function usernameSchema(label = 'Username') {
  return Joi.string()
    .min(USERNAME_MIN_LENGTH)
    .max(USERNAME_MAX_LENGTH)
    .pattern(USERNAME_ALLOWED_PATTERN)
    .messages({
      'string.min': `${label} must be at least ${USERNAME_MIN_LENGTH} characters.`,
      'string.max': `${label} must be ${USERNAME_MAX_LENGTH} characters or fewer.`,
      'string.pattern.base':
        `${label} can include letters, numbers, dashes, underscores, and periods only.`,
    });
}

function formatErrorMessage(errorMessage) {
  return errorMessage
    .replace(/["\\]/g, "") // Strip double quotes and backslashes
    .replace(/^\w/, (c) => c.toUpperCase()); // Uppercase the first letter
}

function generateAMStationCode(macAddress) {
  // Remove any colons from the MAC address
  const cleanMacAddress = macAddress.replace(/:/g, '').toUpperCase();

  // Extract the last 4 characters and prepend 'R'
  const stationCode = 'R' + cleanMacAddress.slice(-4);

  return stationCode;
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  getAccessTokenSecret,
  getRefreshTokenSecret,
  getPasswordResetSecret,
  parseDurationToMs,
  cookieOptions,
  setSessionCookies,
  clearSessionCookies,
  passwordSchema,
  usernameSchema,
  formatErrorMessage,
  generateAMStationCode,
  CURRENT_PASSWORD_POLICY_VERSION,
  LEGACY_PASSWORD_POLICY_VERSION,
  USERNAME_ALLOWED_PATTERN,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
}
