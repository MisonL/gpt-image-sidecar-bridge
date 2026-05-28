import { AdapterError } from './adapter-error.mjs';

const VALID_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);

export function normalizeGenerationRequest(input, defaults = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AdapterError('Request body must be a JSON object.', {
      status: 400,
      code: 'invalid_request_body'
    });
  }
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) {
    throw new AdapterError('prompt is required.', { status: 400, code: 'missing_prompt' });
  }
  validateStream(input);
  const n = input.n ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new AdapterError('n must be an integer from 1 to 5.', {
      status: 400,
      code: 'invalid_image_count'
    });
  }
  const responseFormat = readResponseFormat(input);
  if (responseFormat !== 'b64_json') {
    throw new AdapterError('Only b64_json response_format is supported.', {
      status: 400,
      code: 'unsupported_response_format'
    });
  }
  return buildGenerationBody(input, defaults, { prompt, n, responseFormat });
}

function validateStream(input) {
  if (Object.hasOwn(input, 'stream') && input.stream !== undefined && typeof input.stream !== 'boolean') {
    throw new AdapterError('stream must be a boolean.', { status: 400, code: 'invalid_stream' });
  }
  if (input.stream === true) {
    return;
  }
}

function buildGenerationBody(input, defaults, parsed) {
  const model = readOptionalRequestString(input, 'model') || readDefaultString(defaults.model, 'gpt-image-2');
  const paymentMode = readOptionalRequestString(input, 'payment_mode') || readDefaultString(defaults.paymentMode, 'tier');
  const body = {
    model,
    prompt: parsed.prompt,
    n: parsed.n,
    response_format: parsed.responseFormat,
    output_format: normalizeOutputFormat(readOutputFormat(input, defaults)),
    payment_mode: paymentMode
  };
  if (Object.hasOwn(input, 'size') && input.size !== undefined && input.size !== null) {
    if (input.size === 'auto') return body;
    if (!parseSize(input.size)) {
      throw new AdapterError('size must be auto or WxH.', { status: 400, code: 'invalid_size' });
    }
    body.size = input.size;
  }
  return body;
}

function readResponseFormat(input) {
  if (!Object.hasOwn(input, 'response_format') || input.response_format === undefined || input.response_format === null) {
    return 'b64_json';
  }
  if (typeof input.response_format !== 'string') {
    throw new AdapterError('response_format must be a string.', { status: 400, code: 'invalid_response_format' });
  }
  if (!input.response_format) {
    throw new AdapterError('response_format must not be empty.', { status: 400, code: 'invalid_response_format' });
  }
  return input.response_format;
}

function readOutputFormat(input, defaults) {
  if (!Object.hasOwn(input, 'output_format') || input.output_format === undefined || input.output_format === null) {
    return defaults.outputFormat || 'png';
  }
  if (typeof input.output_format !== 'string' || !input.output_format) {
    throw new AdapterError('output_format must be a non-empty string.', { status: 400, code: 'invalid_output_format' });
  }
  return input.output_format;
}

function readOptionalRequestString(input, field) {
  if (!Object.hasOwn(input, field) || input[field] === undefined || input[field] === null) return '';
  if (typeof input[field] !== 'string') {
    throw new AdapterError(`${field} must be a string.`, { status: 400, code: `invalid_${field}` });
  }
  if (!input[field]) {
    throw new AdapterError(`${field} must not be empty.`, { status: 400, code: `invalid_${field}` });
  }
  return input[field];
}

function readDefaultString(value, fallback) {
  return typeof value === 'string' && value ? value : fallback;
}

function parseSize(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return null;
  return { width, height };
}

function normalizeOutputFormat(value) {
  if (typeof value !== 'string') {
    throw new AdapterError('output_format must be a string.', { status: 400, code: 'invalid_output_format' });
  }
  const normalized = value.toLowerCase() === 'jpg' ? 'jpeg' : value.toLowerCase();
  if (!VALID_OUTPUT_FORMATS.has(normalized)) {
    throw new AdapterError('output_format must be png, jpeg, or webp.', { status: 400, code: 'invalid_output_format' });
  }
  return normalized;
}
