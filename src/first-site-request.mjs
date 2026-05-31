import { webcrypto as crypto } from 'node:crypto';

import { AdapterError } from './adapter-error.mjs';
import { VALID_BACKGROUND_VALUES, VALID_QUALITY_VALUES } from './first-site-config.mjs';

const GENERATION_ID_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
const GENERATION_ID_LENGTH = 21;
const VALID_MODERATION_VALUES = new Set(['auto', 'low']);
const VALID_THINKING_VALUES = new Set(['low', 'medium', 'high', 'none']);

export function buildGenerationBody(input, normalized, config) {
  const body = {
    prompt: normalized.prompt,
    size: normalized.size || config.defaultSize,
    stream: true,
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
  appendFormGenerationIds(form, input.n);
  form.append('stream', 'true');
  form.append('thinking', input.thinking);
  appendFormOutputCompression(form, input);
  if (config.mixWebFirst) form.append('mix_web_first', 'true');
  if (config.promptOptimization) form.append('prompt_optimization', 'true');
  return form;
}

function appendOptionalGenerationFields(body, input, normalized, config) {
  if (shouldAppendModel(normalized.model)) body.model = normalized.model;
  appendGenerationIds(body, input, normalized.n);
  if (config.mixWebFirst || input.mix_web_first === true) body.mix_web_first = true;
  if (config.promptOptimization || input.promptOptimization === true || input.prompt_optimization === true) {
    body.promptOptimization = true;
  }
  appendOutputCompression(body, input, normalized.output_format);
}

function appendGenerationIds(body, input, count) {
  const generationIds = readGenerationIds(input, count);
  if (count === 1) {
    body.generationId = generationIds[0];
    return;
  }
  body.generationIds = generationIds;
}

function readGenerationIds(input, count) {
  const explicitIds = readExplicitGenerationIds(input);
  const ids = explicitIds.slice(0, count);
  while (ids.length < count) ids.push(createGenerationId());
  return ids;
}

function readExplicitGenerationIds(input) {
  const generationId = readRequestString(input, 'generationId') || readRequestString(input, 'generation_id');
  if (generationId) return [generationId];
  if (!Array.isArray(input?.generationIds)) return [];
  const ids = input.generationIds.filter((item) => typeof item === 'string' && item);
  return ids.length === input.generationIds.length ? ids : [];
}

function createGenerationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(GENERATION_ID_LENGTH));
  let output = '';
  for (const byte of bytes) {
    output += GENERATION_ID_ALPHABET[byte & 63];
  }
  return output;
}

function appendOutputCompression(body, input, outputFormat) {
  const value = input?.output_compression;
  if (outputFormat === 'png' || value === undefined || value === null) return;
  body.output_compression = value;
}

function appendFormGenerationIds(form, count) {
  const ids = Array.from({ length: count }, () => createGenerationId());
  if (count === 1) {
    form.append('generationId', ids[0]);
    return;
  }
  form.append('generationIds', JSON.stringify(ids));
}

function appendFormOutputCompression(form, input) {
  const value = input?.output_compression;
  if (input.output_format === 'png' || value === undefined || value === null) return;
  form.append('output_compression', String(value));
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

function shouldAppendModel(model) {
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
