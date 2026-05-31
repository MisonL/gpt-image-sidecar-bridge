import { AdapterError } from './adapter-error.mjs';

export function readEditOptions(form) {
  return {
    ...readEditGenerationIds(form),
    ...readOptionalStringOption(form, 'output_compression'),
    ...readMixWebFirst(form),
    ...readPromptOptimization(form)
  };
}

function readEditGenerationIds(form) {
  const generationId = readOptionalStringAlias(form, ['generationId', 'generation_id'], 'invalid_generation_id');
  if (generationId) return { generationId };
  const generationIds = readGenerationIdArray(form);
  return generationIds ? { generationIds } : {};
}

function readGenerationIdArray(form) {
  const values = [
    ...readAllStrings(form, 'generationIds', 'invalid_generation_ids'),
    ...readAllStrings(form, 'generationIds[]', 'invalid_generation_ids'),
    ...readAllStrings(form, 'generation_ids', 'invalid_generation_ids')
  ];
  if (values.length === 0) return null;
  if (values.length === 1) {
    const parsed = parseGenerationIdsJson(values[0]);
    return Array.isArray(parsed) ? validateGenerationIds(parsed) : validateGenerationIds(values);
  }
  return validateGenerationIds(values);
}

function parseGenerationIdsJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function validateGenerationIds(values) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== 'string' || !value)) {
    throw invalidOption('generationIds must contain non-empty strings.', 'invalid_generation_ids');
  }
  return values;
}

function readPromptOptimization(form) {
  const value = readOptionalBooleanAlias(form, ['prompt_optimization', 'promptOptimization'], 'invalid_prompt_optimization');
  return value === undefined ? {} : { prompt_optimization: value };
}

function readMixWebFirst(form) {
  const value = readOptionalBooleanAlias(form, ['mix_web_first', 'mixWebFirst'], 'invalid_mix_web_first');
  return value === undefined ? {} : { mix_web_first: value };
}

function readOptionalBooleanAlias(form, fields, code) {
  const value = readOptionalStringAlias(form, fields, code);
  if (value === '') return undefined;
  const normalized = value.toLowerCase();
  if (['true', '1'].includes(normalized)) return true;
  if (['false', '0'].includes(normalized)) return false;
  throw invalidOption(`${fields[0]} must be true or false.`, code);
}

function readOptionalStringOption(form, field) {
  const value = readOptionalStringAlias(form, [field], `invalid_${field}`);
  return value ? { [field]: value } : {};
}

function readOptionalStringAlias(form, fields, code) {
  for (const field of fields) {
    if (!form.has(field)) continue;
    const value = readFormString(form, field, code);
    if (!value) throw invalidOption(`${field} must not be empty.`, code);
    return value;
  }
  return '';
}

function readAllStrings(form, field, code) {
  return form.getAll(field).map((value) => {
    if (typeof value !== 'string') throw invalidOption(`${field} must be a string.`, code);
    if (!value) throw invalidOption(`${field} must not be empty.`, code);
    return value;
  });
}

function readFormString(form, field, code) {
  const value = form.get(field);
  if (typeof value !== 'string') throw invalidOption(`${field} must be a string.`, code);
  return value;
}

function invalidOption(message, code) {
  return new AdapterError(message, { status: 400, code });
}
