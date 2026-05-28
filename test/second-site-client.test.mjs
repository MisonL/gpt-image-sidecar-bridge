import assert from 'node:assert/strict';
import test from 'node:test';

import { AdapterError, createSecondSiteClient } from '../src/second-site-client.mjs';
import { jsonResponse } from './test-helpers.mjs';

test('normalizes streaming requests before contacting the second site', async () => {
  const calls = [];
  const client = createSecondSiteClient({
    baseUrl: 'http://example.test',
    email: 'user@example.test',
    password: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v1/auth/login')) {
        return jsonResponse(200, { token: 'site-token' });
      }
      if (url.endsWith('/v1/images/generations')) {
        return jsonResponse(200, { data: [{ b64_json: 'ok' }] });
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  await client.generate({ prompt: 'streaming', stream: true });

  const generation = calls.find((call) => call.url.endsWith('/v1/images/generations'));
  assert.ok(generation);
  assert.equal(JSON.parse(generation.options.body).stream, undefined);
});

test('validates image count before contacting the second site', async () => {
  const client = createSecondSiteClient({
    baseUrl: 'http://example.test',
    email: 'user@example.test',
    password: 'secret',
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    }
  });

  await assert.rejects(
    client.generate({ prompt: 'too many', n: 6 }),
    (error) =>
      error instanceof AdapterError &&
      error.status === 400 &&
      error.code === 'invalid_image_count'
  );
});

test('rejects invalid requests before contacting the second site', async () => {
  const client = createSecondSiteClient({
    baseUrl: 'http://example.test',
    email: 'user@example.test',
    password: 'secret',
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    }
  });

  await assert.rejects(
    client.generate({ prompt: '   ' }),
    (error) => error instanceof AdapterError && error.status === 400 && error.code === 'missing_prompt'
  );
  await assert.rejects(
    client.generate([]),
    (error) => error instanceof AdapterError && error.status === 400 && error.code === 'invalid_request_body'
  );
});

test('rejects unsafe second-site base URLs during client creation', () => {
  assert.throws(
    () => createSecondSiteClient({ baseUrl: 'http://user:pass@example.test' }),
    (error) =>
      error instanceof AdapterError &&
      error.status === 500 &&
      error.code === 'invalid_second_site_base_url'
  );

  assert.throws(
    () => createSecondSiteClient({ baseUrl: 'ftp://example.test' }),
    (error) =>
      error instanceof AdapterError &&
      error.status === 500 &&
      error.code === 'invalid_second_site_base_url'
  );
});

test('shares one login request across concurrent generations', async () => {
  let loginCalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/v1/auth/login')) {
      loginCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse(200, { token: 'shared-token' });
    }
    if (url.endsWith('/v1/images/generations')) {
      return jsonResponse(200, { created: 3, data: [{ b64_json: 'ok' }] });
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const client = createSecondSiteClient({
    baseUrl: 'http://example.test',
    email: 'user@example.test',
    password: 'secret',
    fetchImpl
  });

  await Promise.all([
    client.generate({ prompt: 'first' }),
    client.generate({ prompt: 'second' })
  ]);

  assert.equal(loginCalls, 1);
});

test('logs in and sends Bearer token to the second site generation endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/v1/auth/login')) {
      return jsonResponse(200, { token: 'site-token' });
    }
    if (url.endsWith('/v1/images/generations')) {
      assert.equal(options.headers.authorization, 'Bearer site-token');
      return jsonResponse(200, { created: 1, data: [{ b64_json: 'abc' }] });
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const client = createSecondSiteClient({
    baseUrl: 'http://example.test',
    email: 'user@example.test',
    password: 'secret',
    fetchImpl
  });

  const result = await client.generate({
    model: 'gpt-image-2',
    prompt: 'hello',
    size: '1024x1024'
  });

  assert.deepEqual(result, { created: 1, data: [{ b64_json: 'abc' }] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.body, JSON.stringify({
    email: 'user@example.test',
    password: 'secret'
  }));
});

test('refreshes login once when the cached token is rejected', async () => {
  let generationAttempts = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/v1/auth/login')) {
      return jsonResponse(200, { token: 'fresh-token' });
    }
    if (url.endsWith('/v1/images/generations')) {
      generationAttempts += 1;
      if (generationAttempts === 1) {
        assert.equal(options.headers.authorization, 'Bearer stale-token');
        return jsonResponse(401, { error: { message: 'expired' } });
      }
      assert.equal(options.headers.authorization, 'Bearer fresh-token');
      return jsonResponse(200, { created: 2, data: [{ b64_json: 'ok' }] });
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const client = createSecondSiteClient({
    baseUrl: 'http://example.test',
    email: 'user@example.test',
    password: 'secret',
    token: 'stale-token',
    fetchImpl
  });

  const result = await client.generate({
    model: 'gpt-image-2',
    prompt: 'hello',
    size: '1024x1024'
  });

  assert.equal(generationAttempts, 2);
  assert.deepEqual(result, { created: 2, data: [{ b64_json: 'ok' }] });
});

test('wraps upstream network failures as gateway errors', async () => {
  const client = createSecondSiteClient({
    baseUrl: 'http://example.test',
    token: 'site-token',
    fetchImpl: async () => {
      throw new Error('socket hang up');
    }
  });

  await assert.rejects(
    client.generate({ prompt: 'network fail' }),
    (error) =>
      error instanceof AdapterError &&
      error.status === 502 &&
      error.code === 'second_site_network_error'
  );
});

test('uses upstream detail text when generation fails without a message', async () => {
  const client = createSecondSiteClient({
    baseUrl: 'http://example.test',
    token: 'site-token',
    fetchImpl: async (url) => {
      if (url.endsWith('/v1/images/generations')) {
        return jsonResponse(503, { detail: 'upstream overloaded' });
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  await assert.rejects(
    client.generate({ prompt: 'upstream detail' }),
    (error) =>
      error instanceof AdapterError &&
      error.status === 503 &&
      error.code === 'second_site_generation_failed' &&
      error.message === 'upstream overloaded'
  );
});

test('aborts generation requests after the configured timeout', async () => {
  const client = createSecondSiteClient({
    baseUrl: 'http://example.test',
    token: 'site-token',
    timeoutMs: 1,
    fetchImpl: async (_url, options) => {
      await new Promise((resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          { once: true }
        );
      });
    }
  });

  await assert.rejects(
    client.generate({ prompt: 'timeout' }),
    (error) =>
      error instanceof AdapterError &&
      error.status === 504 &&
      error.code === 'second_site_timeout'
  );
});

test('rejects invalid timeout configuration instead of silently using a fallback', () => {
  assert.throws(
    () =>
      createSecondSiteClient({
        baseUrl: 'http://example.test',
        token: 'site-token',
        timeoutMs: 'not-a-number'
      }),
    (error) =>
      error instanceof AdapterError &&
      error.status === 500 &&
      error.code === 'invalid_second_site_timeout_ms'
  );
});
