import { AdapterError } from './adapter-error.mjs';

export const VALID_BACKGROUND_VALUES = new Set(['auto', 'opaque', 'transparent']);
export const VALID_QUALITY_VALUES = new Set(['auto', 'low', 'medium', 'high']);

export function normalizeBaseUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalidBaseUrlError();
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw invalidBaseUrlError();
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function readDefaultString(value, fallback) {
  return typeof value === 'string' && value ? value : fallback;
}

export function readChoice(value, allowed, options) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (!allowed.has(normalized)) {
    throw new AdapterError(`${options.name} is invalid.`, {
      status: 500,
      code: options.code
    });
  }
  return normalized;
}

export function readBooleanOption(value, fallback, options) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  if (['true', '1'].includes(normalized)) return true;
  if (['false', '0'].includes(normalized)) return false;
  throw new AdapterError(`${options.name} must be true or false.`, {
    status: 500,
    code: options.code
  });
}

export function readTimeoutMs(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new AdapterError('FIRST_SITE_TIMEOUT_MS must be a positive integer.', {
      status: 500,
      code: 'invalid_first_site_timeout_ms'
    });
  }
  return numeric;
}

function invalidBaseUrlError() {
  return new AdapterError('Invalid first site base URL.', {
    status: 500,
    code: 'invalid_first_site_base_url'
  });
}
