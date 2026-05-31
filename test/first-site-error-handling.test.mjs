import assert from 'node:assert/strict';
import test from 'node:test';

import { AdapterError } from '../src/adapter-error.mjs';
import { createFirstSiteClient } from '../src/first-site-client.mjs';
import { firstSiteGenerationStream, imageResponse, jsonResponse, textResponse } from './first-site-test-helpers.mjs';

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
