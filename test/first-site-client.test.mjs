import assert from 'node:assert/strict';
import test from 'node:test';

import { AdapterError } from '../src/adapter-error.mjs';
import { createFirstSiteClient } from '../src/first-site-client.mjs';

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
  assert.equal(JSON.parse(generation.options.body).promptOptimization, undefined);
  assert.equal(JSON.parse(generation.options.body).mix_web_first, true);
  assert.equal(image.options.headers.cookie, '__Secure-better-auth.session_token=session-token');
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
  assert.equal(edit.options.body.getAll('image').length, 1);
});

test('retries first-site image downloads while storage is becoming ready', async () => {
  const calls = [];
  const client = createFirstSiteClient({
    baseUrl: 'https://first.example.test',
    sessionCookie: '__Secure-better-auth.session_token=configured-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/images/generate')) {
        return jsonResponse(200, firstSiteImageBody());
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

function firstSiteFetch(url, options, calls) {
  calls.push({ url, options });
  if (url.endsWith('/api/auth/sign-in/email')) {
    return jsonResponse(200, { token: 'session-token' }, {
      'set-cookie': '__Secure-better-auth.session_token=session-token; Path=/; HttpOnly; Secure'
    });
  }
  if (url.endsWith('/api/images/generate')) {
    return jsonResponse(200, firstSiteImageBody());
  }
  if (url.endsWith('/api/images/edit')) {
    return textResponse(200, firstSiteEditStream(), 'text/event-stream');
  }
  if (url.endsWith('/api/storage/generated.png')) {
    return imageResponse('image-bytes');
  }
  throw new Error(`unexpected url: ${url}`);
}

function firstSiteImageBody() {
  return {
    generationId: 'generation-1',
    imageUrl: '/api/storage/generated.png',
    imageOutputs: [
      {
        generationId: 'generation-1',
        imageUrl: '/api/storage/generated.png',
        revisedPrompt: 'revised prompt'
      }
    ]
  };
}

function firstSiteEditStream() {
  return [
    'data: {"type":"partial_image","b64_json":"preview"}\n\n',
    `data: ${JSON.stringify({ type: 'completed', ...firstSiteImageBody() })}\n\n`,
    'data: {"type":"done"}\n\n'
  ].join('');
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function textResponse(status, body, contentType) {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType }
  });
}

function imageResponse(body) {
  return new Response(Buffer.from(body), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });
}
