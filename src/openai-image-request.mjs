import { AdapterError } from './adapter-error.mjs';

const VALID_OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp']);
const VALID_QUALITY_VALUES = new Set(['auto', 'low', 'medium', 'high']);
const VALID_BACKGROUND_VALUES = new Set(['auto', 'opaque', 'transparent']);
const VALID_MODERATION_VALUES = new Set(['auto', 'low']);
const VALID_THINKING_VALUES = new Set(['low', 'medium', 'high', 'none']);

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

export async function normalizeEditRequest(input, defaults = {}) {
  const form = await readEditForm(input);
  const prompt = readRequiredFormString(form, 'prompt');
  const images = readImageFiles(form);
  const mask = readOptionalFile(form, 'mask');
  const responseFormat = readResponseFormat(formFieldsToObject(form));
  if (responseFormat !== 'b64_json') {
    throw new AdapterError('Only b64_json response_format is supported.', {
      status: 400,
      code: 'unsupported_response_format'
    });
  }
  const n = readIntegerField(form, 'n', 1, { min: 1, max: 5, code: 'invalid_image_count' });
  const outputFormat = normalizeOutputFormat(readFormString(form, 'output_format') || defaults.outputFormat || 'png');
  return {
    prompt,
    images,
    mask,
    n,
    response_format: responseFormat,
    output_format: outputFormat,
    size: readEditSize(form),
    model: readFormString(form, 'model') || readDefaultString(defaults.model, 'gpt-image-2'),
    quality: normalizeEnum(readFormString(form, 'quality') || defaults.quality || 'auto', VALID_QUALITY_VALUES, {
      message: 'quality must be auto, low, medium, or high.',
      code: 'invalid_quality'
    }),
    moderation: normalizeEnum(readFormString(form, 'moderation') || defaults.moderation || 'auto', VALID_MODERATION_VALUES, {
      message: 'moderation must be auto or low.',
      code: 'invalid_moderation'
    }),
    background: normalizeEnum(readFormString(form, 'background') || defaults.background || 'auto', VALID_BACKGROUND_VALUES, {
      message: 'background must be auto, opaque, or transparent.',
      code: 'invalid_background'
    }),
    thinking: normalizeEnum(readFormString(form, 'thinking') || defaults.thinking || 'low', VALID_THINKING_VALUES, {
      message: 'thinking must be low, medium, high, or none.',
      code: 'invalid_thinking'
    })
  };
}

async function readEditForm(input) {
  if (input instanceof FormData) return input;
  if (input instanceof Request) {
    try {
      return await input.formData();
    } catch {
      throw new AdapterError('Request body must be multipart/form-data.', {
        status: 400,
        code: 'invalid_multipart_form'
      });
    }
  }
  throw new AdapterError('Request body must be multipart/form-data.', {
    status: 400,
    code: 'invalid_multipart_form'
  });
}

function readRequiredFormString(form, field) {
  const value = readFormString(form, field).trim();
  if (!value) {
    throw new AdapterError(`${field} is required.`, { status: 400, code: `missing_${field}` });
  }
  return value;
}

function readFormString(form, field) {
  const value = form.get(field);
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') {
    throw new AdapterError(`${field} must be a string.`, { status: 400, code: `invalid_${field}` });
  }
  return value;
}

function readImageFiles(form) {
  const files = [...form.getAll('image'), ...form.getAll('image[]')].filter((item) => isFileLike(item));
  if (files.length === 0) {
    throw new AdapterError('image is required.', { status: 400, code: 'missing_image' });
  }
  if (files.length > 16) {
    throw new AdapterError('image supports at most 16 files.', { status: 400, code: 'invalid_image_count' });
  }
  for (const file of files) {
    validateImageFile(file, 'image');
  }
  return files;
}

function readOptionalFile(form, field) {
  const value = form.get(field);
  if (value === null || value === undefined || value === '') return null;
  if (!isFileLike(value)) {
    throw new AdapterError(`${field} must be a file.`, { status: 400, code: `invalid_${field}` });
  }
  validateImageFile(value, field);
  return value;
}

function isFileLike(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.arrayBuffer === 'function' &&
    typeof value.name === 'string' &&
    typeof value.size === 'number' &&
    typeof value.type === 'string'
  );
}

function validateImageFile(file, field) {
  if (file.size <= 0) {
    throw new AdapterError(`${field} file must not be empty.`, { status: 400, code: `invalid_${field}` });
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new AdapterError(`${field} must be PNG, JPEG, or WebP.`, { status: 400, code: `invalid_${field}` });
  }
}

function readIntegerField(form, field, fallback, options) {
  const raw = readFormString(form, field);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < options.min || value > options.max) {
    throw new AdapterError(`${field} must be an integer from ${options.min} to ${options.max}.`, {
      status: 400,
      code: options.code
    });
  }
  return value;
}

function readEditSize(form) {
  const value = readFormString(form, 'size');
  if (!value || value === 'auto') return 'auto';
  if (!parseSize(value)) {
    throw new AdapterError('size must be auto or WxH.', { status: 400, code: 'invalid_size' });
  }
  return value;
}

function formFieldsToObject(form) {
  const output = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') output[key] = value;
  }
  return output;
}

function normalizeEnum(value, allowed, options) {
  if (typeof value !== 'string') {
    throw new AdapterError(options.message, { status: 400, code: options.code });
  }
  const normalized = value.toLowerCase();
  if (!allowed.has(normalized)) {
    throw new AdapterError(options.message, { status: 400, code: options.code });
  }
  return normalized;
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
