import { AdapterError } from './adapter-error.mjs';
import { VALID_BACKGROUND_VALUES, VALID_QUALITY_VALUES } from './first-site-config.mjs';
import { redactSensitiveDetails } from './redact-sensitive-details.mjs';

const IMAGE_FETCH_MAX_ATTEMPTS = 4;
const IMAGE_FETCH_RETRY_DELAY_MS = 1000;
const IMAGE_FETCH_RETRY_STATUSES = new Set([400, 404, 409, 425, 429, 500, 502, 503, 504]);

export function buildGenerationBody(input, normalized, config) {
  const body = {
    prompt: normalized.prompt,
    size: normalized.size || config.defaultSize,
    stream: false,
    count: normalized.n,
    quality: readGenerationChoice(input, 'quality', config.quality, VALID_QUALITY_VALUES, 'invalid_quality'),
    moderation: readGenerationChoice(input, 'moderation', config.moderation, VALID_MODERATION_VALUES, 'invalid_moderation'),
    output_format: normalized.output_format,
    background: readGenerationChoice(input, 'background', config.background, VALID_BACKGROUND_VALUES, 'invalid_background'),
    thinking: readGenerationChoice(input, 'thinking', config.thinking, VALID_THINKING_VALUES, 'invalid_thinking')
  };
  appendOptionalGenerationFields(body, input, normalized, config);
  return body;
}

export function buildEditBody(input, config) {
  const form = new FormData();
  form.append('prompt', input.prompt);
  form.append('quality', input.quality);
  form.append('moderation', input.moderation);
  form.append('output_format', input.output_format);
  form.append('background', input.background);
  appendEditSize(form, input, config);
  appendEditModel(form, input);
  appendEditFiles(form, input);
  form.append('count', String(input.n));
  form.append('stream', 'true');
  form.append('thinking', input.thinking);
  if (config.mixWebFirst) form.append('mix_web_first', 'true');
  if (config.promptOptimization) form.append('prompt_optimization', 'true');
  return form;
}

export async function postGeneration(config, cookie, body) {
  const response = await fetchWithTimeout(config, `${config.baseUrl}/api/images/generate`, {
    method: 'POST',
    headers: jsonHeaders(config, cookie),
    body: JSON.stringify(body)
  });
  return { response, status: response.status, body: await readJson(response) };
}

export async function postEdit(config, cookie, body) {
  const response = await fetchWithTimeout(config, `${config.baseUrl}/api/images/edit`, {
    method: 'POST',
    headers: formHeaders(config, cookie),
    body
  });
  return { response, status: response.status, text: await response.text() };
}

export async function handleImageResponse(config, result, cookie, fallbackCode) {
  if (!result.response.ok || result.body?.error) {
    throw upstreamError(result.status, result.body, fallbackCode);
  }
  return toOpenAIImagesResponse(config, result.body, cookie);
}

export async function handleEditResponse(config, result, cookie) {
  if (!result.response.ok) {
    throw upstreamError(result.status, parseJsonText(result.text), 'first_site_edit_failed');
  }
  const body = parseSseCompletion(result.text);
  if (body?.error) {
    throw upstreamError(502, body, 'first_site_edit_failed');
  }
  return toOpenAIImagesResponse(config, body, cookie);
}

function appendOptionalGenerationFields(body, input, normalized, config) {
  if (shouldAppendModel(normalized.model)) body.model = normalized.model;
  const generationId = readRequestString(input, 'generationId') || readRequestString(input, 'generation_id');
  if (generationId && normalized.n === 1) body.generationId = generationId;
  if (config.mixWebFirst || input.mix_web_first === true) body.mix_web_first = true;
  if (config.promptOptimization || input.promptOptimization === true || input.prompt_optimization === true) {
    body.promptOptimization = true;
  }
}

function appendEditSize(form, input, config) {
  const size = input.size === 'auto' ? config.editSize : input.size;
  form.append('displaySize', size);
}

function appendEditModel(form, input) {
  if (shouldAppendModel(input.model)) form.append('model', input.model);
}

function appendEditFiles(form, input) {
  for (const image of input.images) {
    form.append(input.images.length === 1 ? 'image' : 'image[]', image, image.name || 'image.png');
  }
  if (input.mask) form.append('mask', input.mask, input.mask.name || 'mask.png');
}

export function shouldAppendModel(model) {
  return typeof model === 'string' && model && model !== 'default' && model !== 'gpt-image-2';
}

function readGenerationChoice(input, field, fallback, allowed, code) {
  const value = (readRequestString(input, field) || fallback).toLowerCase();
  if (!allowed.has(value)) {
    throw new AdapterError(`${field} is invalid.`, { status: 400, code });
  }
  return value;
}

function readRequestString(input, field) {
  return typeof input?.[field] === 'string' && input[field] ? input[field] : '';
}

async function toOpenAIImagesResponse(config, body, cookie) {
  const outputs = collectImageOutputs(body);
  const data = [];
  for (const output of outputs) {
    data.push(await outputToOpenAIImage(config, output, cookie));
  }
  return { created: Math.floor(Date.now() / 1000), data };
}

function collectImageOutputs(body) {
  const records = Array.isArray(body?.results) ? body.results : [body];
  return records.flatMap((record) => {
    if (Array.isArray(record?.imageOutputs) && record.imageOutputs.length > 0) {
      return record.imageOutputs.map((item) => ({ ...record, ...item }));
    }
    return record?.imageUrl ? [record] : [];
  });
}

async function outputToOpenAIImage(config, output, cookie) {
  const b64Json = await fetchImageBase64(config, output.imageUrl, cookie);
  const item = { b64_json: b64Json };
  const revisedPrompt = output.revisedPrompt || output.upstreamRevisedPrompt;
  if (revisedPrompt) item.revised_prompt = revisedPrompt;
  return item;
}

async function fetchImageBase64(config, imageUrl, cookie) {
  const url = new URL(imageUrl, config.baseUrl).toString();
  const response = await fetchImageWithRetry(config, url, cookie);
  if (!response.ok) {
    throw upstreamError(response.status, { message: 'First site image download failed.' }, 'first_site_image_fetch_failed');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw upstreamError(502, { message: 'First site image download returned non-image content.' }, 'first_site_image_fetch_failed');
  }
  return Buffer.from(await response.arrayBuffer()).toString('base64');
}

async function fetchImageWithRetry(config, url, cookie) {
  let response;
  for (let attempt = 1; attempt <= IMAGE_FETCH_MAX_ATTEMPTS; attempt += 1) {
    response = await fetchWithTimeout(config, url, {
      method: 'GET',
      headers: imageHeaders(config, cookie)
    });
    if (!shouldRetryImageFetch(response.status, attempt)) {
      return response;
    }
    await delay(IMAGE_FETCH_RETRY_DELAY_MS);
  }
  return response;
}

function shouldRetryImageFetch(status, attempt) {
  return attempt < IMAGE_FETCH_MAX_ATTEMPTS && IMAGE_FETCH_RETRY_STATUSES.has(status);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jsonHeaders(config, cookie) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    ...siteHeaders(config, cookie)
  };
}

export function formHeaders(config, cookie) {
  return {
    accept: 'text/event-stream',
    ...siteHeaders(config, cookie)
  };
}

export function imageHeaders(config, cookie) {
  return {
    accept: 'image/*',
    ...siteHeaders(config, cookie)
  };
}

export function siteHeaders(config, cookie) {
  const headers = {
    origin: config.baseUrl,
    referer: `${config.baseUrl}/zh/dashboard/create`
  };
  if (cookie) headers.cookie = cookie;
  return headers;
}

function parseSseCompletion(text) {
  const completed = [];
  let error;
  for (const chunk of text.split(/\r?\n\r?\n/)) {
    const body = readSseData(chunk);
    if (!body || body === '[DONE]') continue;
    const event = parseJsonText(body);
    if (event.type === 'completed') completed.push(event);
    if (event.type === 'error') error = event;
  }
  if (completed.length === 1) return completed[0];
  if (completed.length > 1) return { results: completed };
  return error || { error: 'First site returned no completed image event.' };
}

function readSseData(chunk) {
  return chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim();
}

export function readSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }
  const cookie = response.headers.get('set-cookie');
  return cookie ? [cookie] : [];
}

export function extractSessionCookie(response, body) {
  const cookies = readSetCookieHeaders(response);
  const session = cookies.find((cookie) => cookie.includes('better-auth.session_token='));
  if (session) return session.split(';')[0];
  return typeof body?.token === 'string' ? `__Secure-better-auth.session_token=${body.token}` : '';
}

export async function fetchWithTimeout(config, url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    return await config.fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AdapterError('First site request timed out.', { status: 504, code: 'first_site_timeout' });
    }
    throw new AdapterError('First site network request failed.', { status: 502, code: 'first_site_network_error' });
  } finally {
    clearTimeout(timeout);
  }
}

export async function readJson(response) {
  return parseJsonText(await response.text());
}

function parseJsonText(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function upstreamError(status, body, fallbackCode) {
  const message = body?.error?.message || body?.error || body?.message || body?.raw || 'First site request failed.';
  const code = body?.error?.code || body?.code || fallbackCode;
  return new AdapterError(String(message), {
    status: status && status >= 400 ? status : 502,
    code,
    details: redactSensitiveDetails(body)
  });
}

export function isAuthenticationFailure(status) {
  return status === 401 || status === 403;
}

const VALID_MODERATION_VALUES = new Set(['auto', 'low']);
const VALID_THINKING_VALUES = new Set(['low', 'medium', 'high', 'none']);
