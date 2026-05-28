import { readFileSync } from 'node:fs';

import { AdapterError } from './adapter-error.mjs';
import { normalizeGenerationRequest } from './openai-image-request.mjs';
import { redactSensitiveDetails } from './redact-sensitive-details.mjs';

export { AdapterError } from './adapter-error.mjs';
export { normalizeGenerationRequest } from './openai-image-request.mjs';

export function createSecondSiteClient(options = {}) {
  const config = readConfig(options);
  let cachedToken = config.token;
  let loginPromise;

  async function login() {
    if (loginPromise) {
      return loginPromise;
    }
    loginPromise = performLogin().finally(() => {
      loginPromise = undefined;
    });
    return loginPromise;
  }

  async function performLogin() {
    if (!config.email || !config.password) {
      throw new AdapterError('Second site login credentials are not configured.', {
        status: 500,
        code: 'missing_second_site_credentials'
      });
    }

    const response = await fetchWithTimeout(config, `${config.baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ email: config.email, password: config.password })
    });
    const body = await readJson(response);
    if (!response.ok || !body.token) {
      throw upstreamError(response.status, body, 'second_site_login_failed');
    }
    cachedToken = body.token;
    return cachedToken;
  }

  async function token() {
    return cachedToken || login();
  }

  async function generate(input) {
    const body = normalizeGenerationRequest(input, config);
    const firstToken = await token();
    const first = await postGeneration(body, firstToken);
    if (first.status !== 401) {
      return handleGenerationResponse(first);
    }

    const freshToken = await login();
    const second = await postGeneration(body, freshToken);
    return handleGenerationResponse(second);
  }

  async function postGeneration(body, bearerToken) {
    const response = await fetchWithTimeout(config, `${config.baseUrl}/v1/images/generations`, {
      method: 'POST',
      headers: {
        ...jsonHeaders(),
        authorization: `Bearer ${bearerToken}`
      },
      body: JSON.stringify(body)
    });
    return { response, status: response.status, body: await readJson(response) };
  }

  return { generate, login };
}

function readConfig(options) {
  const baseUrl = normalizeBaseUrl(
    options.baseUrl || process.env.SECOND_SITE_BASE_URL || 'http://154.9.255.153:2254'
  );
  return {
    baseUrl,
    email: options.email ?? readSecretOption('SECOND_SITE_EMAIL', process.env.SECOND_SITE_EMAIL_FILE),
    password: options.password ?? readSecretOption('SECOND_SITE_PASSWORD', process.env.SECOND_SITE_PASSWORD_FILE),
    token: options.token ?? process.env.SECOND_SITE_TOKEN,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    model: options.model ?? process.env.SECOND_SITE_MODEL,
    outputFormat: options.outputFormat ?? process.env.SECOND_SITE_OUTPUT_FORMAT,
    paymentMode: options.paymentMode ?? process.env.SECOND_SITE_PAYMENT_MODE,
    timeoutMs: readTimeoutMs(options.timeoutMs ?? process.env.SECOND_SITE_TIMEOUT_MS, 240000)
  };
}

export function readSecretOption(envName, filePath) {
  if (filePath) {
    try {
      return readFileSync(filePath, 'utf8').trim();
    } catch {
      throw new AdapterError(`Unable to read secret file for ${envName}.`, {
        status: 500,
        code: 'invalid_secret_file'
      });
    }
  }
  return process.env[envName];
}

function normalizeBaseUrl(rawUrl) {
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

function invalidBaseUrlError() {
  return new AdapterError('Invalid second site base URL.', {
    status: 500,
    code: 'invalid_second_site_base_url'
  });
}

function jsonHeaders() {
  return {
    accept: 'application/json',
    'content-type': 'application/json'
  };
}

async function fetchWithTimeout(config, url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    return await config.fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AdapterError('Second site request timed out.', {
        status: 504,
        code: 'second_site_timeout'
      });
    }
    throw new AdapterError('Second site network request failed.', {
      status: 502,
      code: 'second_site_network_error'
    });
  } finally {
    clearTimeout(timeout);
  }
}

function readTimeoutMs(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new AdapterError('SECOND_SITE_TIMEOUT_MS must be a positive integer.', {
      status: 500,
      code: 'invalid_second_site_timeout_ms'
    });
  }
  return numeric;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function handleGenerationResponse(result) {
  if (!result.response.ok) {
    throw upstreamError(result.status, result.body, 'second_site_generation_failed');
  }
  return result.body;
}

function upstreamError(status, body, fallbackCode) {
  const upstream = body?.error || body || {};
  const message = upstream.message || body?.message || readDetailMessage(body) || 'Second site request failed.';
  return new AdapterError(message, {
    status: status || 502,
    code: upstream.code || fallbackCode,
    details: redactSensitiveDetails(body)
  });
}

function readDetailMessage(body) {
  if (typeof body?.detail === 'string') return body.detail;
  return '';
}
