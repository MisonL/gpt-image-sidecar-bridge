import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { AdapterError } from '../src/second-site-client.mjs';
import { createApp, startServer } from '../src/server.mjs';
import { fakeClient, restoreEnv } from './test-helpers.mjs';

test('serves OpenAI-compatible models response', async () => {
  const app = createApp({
    client: fakeClient(),
    apiKey: ''
  });

  const response = await app.handle(new Request('http://adapter.test/v1/models'));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.object, 'list');
  assert.equal(body.data[0].id, 'gpt-image-2');
  assert.equal(body.data[0].object, 'model');
  assert.equal(typeof body.data[0].created, 'number');
  assert.equal(body.data[0].owned_by, 'second-site');
});

test('serves CORS preflight without requiring adapter authentication', async () => {
  const app = createApp({
    client: fakeClient(),
    apiKey: 'adapter-key'
  });

  const response = await app.handle(new Request('http://adapter.test/v1/images/generations', { method: 'OPTIONS' }));

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('access-control-allow-methods') || '', /POST/);
});

test('protects adapter endpoints when ADAPTER_API_KEY is configured', async () => {
  const app = createApp({
    client: fakeClient(),
    apiKey: 'adapter-key'
  });

  const response = await app.handle(
    new Request('http://adapter.test/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' })
    })
  );

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, 'invalid_adapter_api_key');
  assert.equal(body.error.param, null);
  assert.equal(body.error.type, 'authentication_error');
});

test('forwards image generation requests through the configured client', async () => {
  const seen = [];
  const app = createApp({
    client: fakeClient({
      async generate(body) {
        seen.push(body);
        return { created: 3, data: [{ b64_json: 'image' }] };
      }
    }),
    apiKey: 'adapter-key'
  });

  const response = await app.handle(
    new Request('http://adapter.test/v1/images/generations', {
      method: 'POST',
      headers: {
        authorization: 'Bearer adapter-key',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: 'gpt-image-2', prompt: 'hello' })
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    created: 3,
    data: [{ b64_json: 'image' }]
  });
  assert.deepEqual(seen, [{ model: 'gpt-image-2', prompt: 'hello' }]);
});

test('serves streaming image requests as OpenAI-compatible SSE', async () => {
  const seen = [];
  const app = createApp({
    client: fakeClient({
      async generate(body) {
        seen.push(body);
        return {
          created: 5,
          data: [{ b64_json: 'stream-image', revised_prompt: 'revised' }],
          usage: { total_tokens: 1 }
        };
      }
    }),
    apiKey: 'adapter-key'
  });

  const response = await app.handle(
    new Request('http://adapter.test/v1/images/generations', {
      method: 'POST',
      headers: {
        authorization: 'Bearer adapter-key',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model: 'gpt-image-2', prompt: 'hello', stream: true })
    })
  );
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.match(text, /event: image_generation.completed/);
  assert.match(text, /"b64_json":"stream-image"/);
  assert.match(text, /data: \[DONE\]/);
  assert.deepEqual(seen, [{ model: 'gpt-image-2', prompt: 'hello', stream: false }]);
});

test('returns explicit errors for unsupported image endpoints', async () => {
  const app = createApp({
    client: fakeClient(),
    apiKey: 'adapter-key'
  });

  for (const path of ['/v1/images/edits', '/v1/images/variations']) {
    const response = await app.handle(
      new Request(`http://adapter.test${path}`, {
        method: 'POST',
        headers: { authorization: 'Bearer adapter-key' },
        body: new FormData()
      })
    );
    const body = await response.json();

    assert.equal(response.status, 501);
    assert.equal(body.error.code, 'unsupported_image_endpoint');
    assert.equal(body.error.type, 'api_error');
  }
});

test('rejects successful upstream generation responses without b64 image data', async () => {
  const app = createApp({
    client: fakeClient({
      async generate() {
        return { data: [{}] };
      }
    }),
    apiKey: ''
  });

  const response = await app.handle(
    new Request('http://adapter.test/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' })
    })
  );
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.error.code, 'invalid_second_site_generation_response');
  assert.equal(body.error.type, 'api_error');
});

test('accepts POST JSON through the Node HTTP server', async () => {
  const server = startServer({
    host: '127.0.0.1',
    port: 0,
    apiKey: '',
    client: fakeClient({
      async generate(body) {
        assert.deepEqual(body, { prompt: 'server path' });
        return { created: 4, data: [{ b64_json: 'server-image' }] };
      }
    }),
    silent: true
  });
  await once(server, 'listening');
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'server path' })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      created: 4,
      data: [{ b64_json: 'server-image' }]
    });
  } finally {
    server.close();
  }
});

test('returns adapter errors without crashing the Node HTTP server', async () => {
  const server = startServer({
    host: '127.0.0.1',
    port: 0,
    apiKey: '',
    client: fakeClient({
      async generate() {
        const error = new Error('upstream down');
        error.status = 502;
        error.code = 'upstream_down';
        throw error;
      }
    }),
    silent: true
  });
  await once(server, 'listening');
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'server path' })
    });

    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.code, 'internal_error');
    assert.equal(body.error.type, 'api_error');

    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(health.status, 200);
  } finally {
    server.close();
  }
});

test('preserves AdapterError status and code in HTTP responses', async () => {
  const app = createApp({
    client: fakeClient({
      async generate() {
        throw new AdapterError('bad request from adapter', {
          status: 400,
          code: 'adapter_bad_request',
          details: { email: 'user@example.test', nested: { token: 'secret-token' } }
        });
      }
    }),
    apiKey: ''
  });

  const response = await app.handle(
    new Request('http://adapter.test/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' })
    })
  );

  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'adapter_bad_request');
  assert.equal(body.error.type, 'invalid_request_error');
  assert.equal(body.error.details, undefined);
});

test('redacts debug error details before returning them to callers', async () => {
  const previous = process.env.ADAPTER_DEBUG_ERRORS;
  process.env.ADAPTER_DEBUG_ERRORS = 'true';
  try {
    const app = createApp({
      client: fakeClient({
        async generate() {
          throw new AdapterError('debug error', {
            status: 502,
            code: 'debug_error',
            details: {
              api_key: 'raw-key',
              message: 'Authorization: Bearer raw-token',
              password: 'raw-password',
              nested: { accessToken: 'raw-token' }
            }
          });
        }
      }),
      apiKey: ''
    });

    const response = await app.handle(
      new Request('http://adapter.test/v1/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' })
      })
    );
    const body = await response.json();

    assert.equal(body.error.details.api_key, '[redacted]');
    assert.equal(body.error.details.message, 'Authorization: Bearer [redacted]');
    assert.equal(body.error.details.password, '[redacted]');
    assert.equal(body.error.details.nested.accessToken, '[redacted]');
  } finally {
    restoreEnv('ADAPTER_DEBUG_ERRORS', previous);
  }
});

test('refuses to start a public listener without adapter authentication', () => {
  assert.throws(
    () =>
      startServer({
        host: '0.0.0.0',
        port: 0,
        apiKey: '',
        client: fakeClient(),
        silent: true
      }),
    /ADAPTER_API_KEY is required/
  );
});

test('rejects invalid listen ports before starting the HTTP server', () => {
  assert.throws(
    () =>
      startServer({
        host: '127.0.0.1',
        port: 'not-a-port',
        apiKey: '',
        client: fakeClient(),
        silent: true
      }),
    /PORT must be an integer/
  );
});
