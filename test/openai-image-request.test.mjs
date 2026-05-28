import assert from 'node:assert/strict';
import test from 'node:test';

import { AdapterError } from '../src/adapter-error.mjs';
import { normalizeGenerationRequest } from '../src/openai-image-request.mjs';

test('normalizes OpenAI image request for the second site generation endpoint', () => {
  const body = normalizeGenerationRequest(
    {
      model: 'gpt-image-2',
      prompt: 'a test image',
      n: 2,
      size: '1024x1024',
      response_format: 'b64_json'
    },
    { paymentMode: 'tier', outputFormat: 'png' }
  );

  assert.deepEqual(body, {
    model: 'gpt-image-2',
    prompt: 'a test image',
    n: 2,
    response_format: 'b64_json',
    output_format: 'png',
    payment_mode: 'tier',
    size: '1024x1024'
  });
});

test('rejects invalid OpenAI image request fields before contacting upstream', () => {
  assertAdapterError({ prompt: '   ' }, 'missing_prompt');
  assertAdapterError({ prompt: 'bad format', output_format: 'gif' }, 'invalid_output_format');
  assertAdapterError({ prompt: 'empty output format', output_format: '' }, 'invalid_output_format');
  assertAdapterError({ prompt: 'bad size', size: 'large' }, 'invalid_size');
  assertAdapterError({ prompt: 'bad size type', size: 1024 }, 'invalid_size');
  assertAdapterError({ prompt: 'zero size', size: '0x1024' }, 'invalid_size');
  assertAdapterError({ prompt: 'bad response format type', response_format: 1 }, 'invalid_response_format');
  assertAdapterError({ prompt: 'empty response format', response_format: '' }, 'invalid_response_format');
  assertAdapterError({ prompt: 'url response', response_format: 'url' }, 'unsupported_response_format');
  assertAdapterError({ prompt: 'bad stream type', stream: 'true' }, 'invalid_stream');
  assertAdapterError({ prompt: 'too many', n: 6 }, 'invalid_image_count');
  assertAdapterError({ prompt: 'bad model', model: { id: 'gpt-image-2' } }, 'invalid_model');
  assertAdapterError({ prompt: 'empty model', model: '' }, 'invalid_model');
  assertAdapterError({ prompt: 'bad payment mode', payment_mode: ['tier'] }, 'invalid_payment_mode');
  assertAdapterError({ prompt: 'empty payment mode', payment_mode: '' }, 'invalid_payment_mode');
  assertAdapterError([], 'invalid_request_body');
});

test('applies defaults and aliases for second-site image requests', () => {
  const body = normalizeGenerationRequest(
    { prompt: 'empty defaults' },
    { model: '', paymentMode: '', outputFormat: '' }
  );

  assert.equal(body.model, 'gpt-image-2');
  assert.equal(body.payment_mode, 'tier');
  assert.equal(body.output_format, 'png');
  assert.equal(normalizeGenerationRequest({ prompt: 'jpg alias', output_format: 'jpg' }).output_format, 'jpeg');
  assert.equal('size' in normalizeGenerationRequest({ prompt: 'auto size', size: 'auto' }), false);
});

function assertAdapterError(input, code) {
  assert.throws(
    () => normalizeGenerationRequest(input),
    (error) => error instanceof AdapterError && error.status === 400 && error.code === code
  );
}
