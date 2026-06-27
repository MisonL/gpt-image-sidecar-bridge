import { AdapterError } from './adapter-error.mjs';
import {
  normalizeBaseUrl,
  readBooleanOption,
  readChoice,
  readDefaultString,
  readTimeoutMs,
  VALID_BACKGROUND_VALUES,
  VALID_QUALITY_VALUES
} from './first-site-config.mjs';
import {
  extractSessionCookie,
  fetchWithTimeout,
  handleEditResponse,
  handleImageResponse,
  isAuthenticationFailure,
  jsonHeaders,
  postEdit,
  postGeneration,
  readJson,
  upstreamError
} from './first-site-response.mjs';
import { buildEditBody, buildGenerationBody } from './first-site-request.mjs';
import { normalizeEditRequest, normalizeGenerationRequest } from './openai-image-request.mjs';
import { readSecretOption } from './secrets.mjs';

const DEFAULT_BASE_URL = 'https://gpt2image.superapi.buzz';
const SESSION_COOKIE_NAME = '__Secure-better-auth.session_token';

export function createFirstSiteClient(options = {}) {
  const config = readConfig(options);
  const state = { config, cachedCookie: config.sessionCookie, loginPromise: undefined };

  return {
    edit: (input) => edit(state, input),
    generate: (input) => generate(state, input),
    login: () => login(state)
  };
}

async function login(state) {
  if (state.loginPromise) return state.loginPromise;
  state.loginPromise = performLogin(state).finally(() => {
    state.loginPromise = undefined;
  });
  return state.loginPromise;
}

async function performLogin(state) {
  if (!state.config.email || !state.config.password) {
    throw new AdapterError('First site login credentials are not configured.', {
      status: 500,
      code: 'missing_first_site_credentials'
    });
  }
  const response = await fetchWithTimeout(state.config, `${state.config.baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: jsonHeaders(state.config),
    body: JSON.stringify({ email: state.config.email, password: state.config.password, rememberMe: true })
  });
  const body = await readJson(response);
  const cookie = extractSessionCookie(response, body);
  if (!response.ok || !cookie) {
    throw upstreamError(response.status, body, 'first_site_login_failed');
  }
  state.cachedCookie = cookie;
  return state.cachedCookie;
}

async function sessionCookie(state) {
  return state.cachedCookie || login(state);
}

async function generate(state, input) {
  const normalized = normalizeGenerationRequest(input, state.config);
  const body = buildGenerationBody(input, normalized, state.config);
  return withSessionRetry(state, {
    request: (cookie) => postGeneration(state.config, cookie, body),
    handle: (result, cookie) => handleImageResponse(state.config, result, cookie, 'first_site_generation_failed')
  });
}

async function edit(state, input) {
  const normalized = await normalizeEditRequest(input, state.config);
  const body = buildEditBody(normalized, state.config);
  return withSessionRetry(state, {
    request: (cookie) => postEdit(state.config, cookie, body),
    handle: (result, cookie) => handleEditResponse(state.config, result, cookie)
  });
}

async function withSessionRetry(state, args) {
  const firstCookie = await sessionCookie(state);
  const first = await args.request(firstCookie);
  if (!isAuthenticationFailure(first.status)) {
    return args.handle(first, firstCookie);
  }
  if (!canRefreshSession(state.config)) {
    throw new AdapterError('First site session expired.', { status: 401, code: 'first_site_session_expired' });
  }
  const freshCookie = await login(state);
  const second = await args.request(freshCookie);
  return args.handle(second, freshCookie);
}

function canRefreshSession(config) {
  return Boolean(config.email && config.password);
}

function readConfig(options) {
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ||
      process.env.UPSTREAM_BASE_URL ||
      process.env.FIRST_SITE_BASE_URL ||
      DEFAULT_BASE_URL,
    { name: 'UPSTREAM_BASE_URL', code: 'invalid_upstream_base_url' }
  );
  return {
    baseUrl,
    baseOrigin: new URL(baseUrl).origin,
    email:
      options.email ??
      readSecretOption('UPSTREAM_EMAIL', process.env.UPSTREAM_EMAIL_FILE) ??
      readSecretOption('FIRST_SITE_EMAIL', process.env.FIRST_SITE_EMAIL_FILE),
    password:
      options.password ??
      readSecretOption('UPSTREAM_PASSWORD', process.env.UPSTREAM_PASSWORD_FILE) ??
      readSecretOption('FIRST_SITE_PASSWORD', process.env.FIRST_SITE_PASSWORD_FILE),
    sessionCookie: readConfiguredCookie(options),
    fetchImpl: options.fetchImpl || globalThis.fetch,
    model: options.model ?? process.env.UPSTREAM_MODEL ?? process.env.FIRST_SITE_MODEL,
    outputFormat: options.outputFormat ?? process.env.UPSTREAM_OUTPUT_FORMAT ?? process.env.FIRST_SITE_OUTPUT_FORMAT,
    quality: readChoice(options.quality ?? process.env.UPSTREAM_QUALITY ?? process.env.FIRST_SITE_QUALITY ?? 'auto', VALID_QUALITY_VALUES, {
      name: 'UPSTREAM_QUALITY',
      code: 'invalid_upstream_quality'
    }),
    background: readChoice(options.background ?? process.env.UPSTREAM_BACKGROUND ?? process.env.FIRST_SITE_BACKGROUND ?? 'auto', VALID_BACKGROUND_VALUES, {
      name: 'UPSTREAM_BACKGROUND',
      code: 'invalid_upstream_background'
    }),
    thinking: readDefaultString(options.thinking ?? process.env.UPSTREAM_THINKING ?? process.env.FIRST_SITE_THINKING, 'low'),
    moderation: readDefaultString(options.moderation ?? process.env.UPSTREAM_MODERATION ?? process.env.FIRST_SITE_MODERATION, 'auto'),
    defaultSize: readDefaultString(options.defaultSize ?? process.env.UPSTREAM_SIZE ?? process.env.FIRST_SITE_SIZE, '1024x1024'),
    editSize: readDefaultString(options.editSize ?? process.env.UPSTREAM_EDIT_SIZE ?? process.env.FIRST_SITE_EDIT_SIZE, '1024x1024'),
    mixWebFirst: readBooleanOption(options.mixWebFirst ?? process.env.UPSTREAM_MIX_WEB_FIRST ?? process.env.FIRST_SITE_MIX_WEB_FIRST, true, {
      name: 'UPSTREAM_MIX_WEB_FIRST',
      code: 'invalid_upstream_mix_web_first'
    }),
    promptOptimization: readBooleanOption(
      options.promptOptimization ?? process.env.UPSTREAM_PROMPT_OPTIMIZATION ?? process.env.FIRST_SITE_PROMPT_OPTIMIZATION,
      false,
      {
        name: 'UPSTREAM_PROMPT_OPTIMIZATION',
        code: 'invalid_upstream_prompt_optimization'
      }
    ),
    timeoutMs: readTimeoutMs(options.timeoutMs ?? process.env.UPSTREAM_TIMEOUT_MS ?? process.env.FIRST_SITE_TIMEOUT_MS, 240000, {
      name: 'UPSTREAM_TIMEOUT_MS',
      code: 'invalid_upstream_timeout_ms'
    })
  };
}

function readConfiguredCookie(options) {
  const cookie =
    options.sessionCookie ??
    readSecretOption('UPSTREAM_SESSION_COOKIE', process.env.UPSTREAM_SESSION_COOKIE_FILE) ??
    readSecretOption('FIRST_SITE_SESSION_COOKIE', process.env.FIRST_SITE_SESSION_COOKIE_FILE);
  if (cookie) return cookie;
  const token =
    options.sessionToken ??
    readSecretOption('UPSTREAM_SESSION_TOKEN', process.env.UPSTREAM_SESSION_TOKEN_FILE) ??
    readSecretOption('FIRST_SITE_SESSION_TOKEN', process.env.FIRST_SITE_SESSION_TOKEN_FILE);
  return token ? `${SESSION_COOKIE_NAME}=${token}` : '';
}
