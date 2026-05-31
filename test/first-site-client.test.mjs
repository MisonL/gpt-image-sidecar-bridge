import assert from 'node:assert/strict';
import test from 'node:test';

import { AdapterError } from '../src/adapter-error.mjs';
import { createFirstSiteClient } from '../src/first-site-client.mjs';
import {
  firstSiteFetch,
  firstSiteGenerationStream,
  imageResponse,
  jsonResponse,
  textResponse
} from './first-site-test-helpers.mjs';

test('logs in and converts first-site generation output to OpenAI b64_json', async () => {
  const calls = [];
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    email: 'user@example.test',
    password: 'secret',
    fetchImpl: async (url, options) => firstSiteFetch(url, options, calls)
  });

  const result = await client.generate({
    prompt: 'hello',
    n: 1,
    size: '1024x1024',
    response_format: 'b64_json'
  });
  const generation = calls.find((call) => call.url.endsWith('/api/images/generate'));
  const image = calls.find((call) => call.url.endsWith('/api/storage/generated.png'));

  assert.deepEqual(result, {
    created: result.created,
    data: [
      {
        b64_json: Buffer.from('image-bytes').toString('base64'),
        revised_prompt: 'revised prompt'
      }
    ]
  });
  assert.equal(calls[0].options.headers.origin, 'https://first.example.test');
  assert.equal(JSON.parse(calls[0].options.body).rememberMe, true);
  assert.equal(generation.options.headers.cookie, '__Secure-better-auth.session_token=session-token');
  assert.equal(generation.options.headers.accept, 'text/event-stream');
  const generationBody = JSON.parse(generation.options.body);
  assert.equal(generationBody.stream, true);
  assert.match(generationBody.generationId, /^[A-Za-z0-9_-]{21}$/);
  assert.equal(generationBody.promptOptimization, undefined);
  assert.equal(generationBody.mix_web_first, true);
  assert.equal(image.options.headers.cookie, '__Secure-better-auth.session_token=session-token');
});

test('sends multiple first-site generation ids like the web UI', async () => {
  const calls = [];
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    sessionCookie: '__Secure-better-auth.session_token=configured-token',
    fetchImpl: async (url, options) => firstSiteFetch(url, options, calls)
  });

  await client.generate({
    prompt: 'hello',
    n: 2,
    size: '1024x1024',
    response_format: 'b64_json'
  });
  const body = JSON.parse(calls.find((call) => call.url.endsWith('/api/images/generate')).options.body);

  assert.equal(body.generationId, undefined);
  assert.equal(body.generationIds.length, 2);
  assert.match(body.generationIds[0], /^[A-Za-z0-9_-]{21}$/);
  assert.match(body.generationIds[1], /^[A-Za-z0-9_-]{21}$/);
});

test('sends first-site edit requests and parses completed SSE events', async () => {
  const calls = [];
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    sessionCookie: '__Secure-better-auth.session_token=configured-token',
    fetchImpl: async (url, options) => firstSiteFetch(url, options, calls)
  });
  const form = new FormData();
  form.append('prompt', 'edit this');
  form.append('image', new Blob(['source'], { type: 'image/png' }), 'source.png');
  form.append('size', '1024x1024');

  const result = await client.edit(form);
  const edit = calls.find((call) => call.url.endsWith('/api/images/edit'));

  assert.equal(result.data[0].b64_json, Buffer.from('image-bytes').toString('base64'));
  assert.equal(edit.options.body.get('prompt'), 'edit this');
  assert.equal(edit.options.body.get('displaySize'), '1024x1024');
  assert.equal(edit.options.body.get('stream'), 'true');
  assert.match(edit.options.body.get('generationId'), /^[A-Za-z0-9_-]{21}$/);
  assert.equal(edit.options.body.getAll('image').length, 1);
});

test('forwards first-site edit extension fields', async () => {
  const calls = [];
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    mixWebFirst: false,
    promptOptimization: false,
    sessionCookie: '__Secure-better-auth.session_token=configured-token',
    fetchImpl: async (url, options) => firstSiteFetch(url, options, calls)
  });
  const form = new FormData();
  form.append('prompt', 'edit this');
  form.append('image', new Blob(['source'], { type: 'image/png' }), 'source.png');
  form.append('output_format', 'jpeg');
  form.append('output_compression', '80');
  form.append('mix_web_first', 'true');
  form.append('prompt_optimization', 'true');
  form.append('generationId', 'edit-generation-1');

  await client.edit(form);
  const body = calls.find((call) => call.url.endsWith('/api/images/edit')).options.body;

  assert.equal(body.get('generationId'), 'edit-generation-1');
  assert.equal(body.get('output_compression'), '80');
  assert.equal(body.get('mix_web_first'), 'true');
  assert.equal(body.get('prompt_optimization'), 'true');
});

test('honors first-site per-request extension opt-outs', async () => {
  const calls = [];
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    mixWebFirst: true,
    promptOptimization: true,
    sessionCookie: '__Secure-better-auth.session_token=configured-token',
    fetchImpl: async (url, options) => firstSiteFetch(url, options, calls)
  });
  await client.generate({ prompt: 'hello', mix_web_first: false, prompt_optimization: false });
  const generation = JSON.parse(calls.find((call) => call.url.endsWith('/api/images/generate')).options.body);

  const form = new FormData();
  form.append('prompt', 'edit this');
  form.append('image', new Blob(['source'], { type: 'image/png' }), 'source.png');
  form.append('mix_web_first', 'false');
  form.append('prompt_optimization', 'false');
  await client.edit(form);
  const edit = calls.find((call) => call.url.endsWith('/api/images/edit')).options.body;

  assert.equal(generation.mix_web_first, undefined);
  assert.equal(generation.promptOptimization, undefined);
  assert.equal(edit.get('mix_web_first'), null);
  assert.equal(edit.get('prompt_optimization'), null);
});

test('retries first-site image downloads while storage is becoming ready', async () => {
  const calls = [];
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    sessionCookie: '__Secure-better-auth.session_token=configured-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/images/generate')) {
        return textResponse(200, firstSiteGenerationStream(), 'text/event-stream');
      }
      if (url.endsWith('/api/storage/generated.png')) {
        const attempts = calls.filter((call) => call.url.endsWith('/api/storage/generated.png')).length;
        if (attempts === 1) return jsonResponse(400, { message: 'not ready' });
        return imageResponse('image-bytes');
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  const result = await client.generate({ prompt: 'hello' });
  const downloads = calls.filter((call) => call.url.endsWith('/api/storage/generated.png'));

  assert.equal(result.data[0].b64_json, Buffer.from('image-bytes').toString('base64'));
  assert.equal(downloads.length, 2);
});

test('rejects cross-origin first-site image URLs before downloading', async () => {
  const calls = [];
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    sessionCookie: '__Secure-better-auth.session_token=configured-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/images/generate')) {
        return textResponse(200, firstSiteGenerationStream('https://evil.example.test/leak.png'), 'text/event-stream');
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  await assert.rejects(
    client.generate({ prompt: 'hello' }),
    (error) => error instanceof AdapterError && error.status === 502 && error.code === 'first_site_image_fetch_failed'
  );
  assert.equal(calls.length, 1);
});

test('rejects invalid first-site image URLs before downloading', async () => {
  const calls = [];
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    sessionCookie: '__Secure-better-auth.session_token=configured-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/images/generate')) {
        return textResponse(200, firstSiteGenerationStream('https://[invalid'), 'text/event-stream');
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  await assert.rejects(
    client.generate({ prompt: 'hello' }),
    (error) => error instanceof AdapterError && error.status === 502 && error.code === 'first_site_image_fetch_failed'
  );
  assert.equal(calls.length, 1);
});

test('truncates non-JSON first-site gateway errors', async () => {
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    sessionCookie: '__Secure-better-auth.session_token=configured-token',
    fetchImpl: async (url) => {
      if (url.endsWith('/api/images/generate')) {
        return textResponse(502, `<html>${'x'.repeat(1000)}</html>`, 'text/html');
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  await assert.rejects(
    client.generate({ prompt: 'hello' }),
    (error) =>
      error instanceof AdapterError &&
      error.status === 502 &&
      error.code === 'first_site_generation_failed' &&
      error.message.length <= 203
  );
});

test('reports expired fixed first-site sessions as authentication errors', async () => {
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    sessionCookie: '__Secure-better-auth.session_token=expired-token',
    fetchImpl: async (url) => {
      if (url.endsWith('/api/images/generate')) return jsonResponse(401, { message: 'expired' });
      throw new Error(`unexpected url: ${url}`);
    }
  });

  await assert.rejects(
    client.generate({ prompt: 'hello' }),
    (error) => error instanceof AdapterError && error.status === 401 && error.code === 'first_site_session_expired'
  );
});

test('rejects image edits without a source image before contacting the first site', async () => {
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    sessionCookie: '__Secure-better-auth.session_token=configured-token',
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    }
  });
  const form = new FormData();
  form.append('prompt', 'edit this');

  await assert.rejects(
    client.edit(form),
    (error) => error instanceof AdapterError && error.status === 400 && error.code === 'missing_image'
  );
});

test('wraps first-site network failures as gateway errors', async () => {
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    sessionCookie: '__Secure-better-auth.session_token=configured-token',
    fetchImpl: async () => {
      throw new Error('socket hang up');
    }
  });

  await assert.rejects(
    client.generate({ prompt: 'network fail' }),
    (error) => error instanceof AdapterError && error.status === 502 && error.code === 'first_site_network_error'
  );
});

test('rejects unsafe first-site base URLs during client creation', () => {
  assert.throws(
    () => createFirstSiteClient({ baseUrl: 'https://user:pass@example.test' }),
    (error) => error instanceof AdapterError && error.status === 500 && error.code === 'invalid_first_site_base_url'
  );
});
