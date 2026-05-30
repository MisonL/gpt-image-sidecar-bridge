import assert from 'node:assert/strict';
import test from 'node:test';

import { AdapterError } from '../src/adapter-error.mjs';
import { createUpstreamClient } from '../src/upstream-client.mjs';

test('selects the first-site provider when configured', () => {
  const client = createUpstreamClient({
    provider: 'first-site',
    sessionCookie: '__Secure-better-auth.session_token=configured-token',
    fetchImpl: async () => {
      throw new Error('not called');
    }
  });

  assert.equal(typeof client.generate, 'function');
  assert.equal(typeof client.edit, 'function');
});

test('selects the second-site provider by default', () => {
  const client = createUpstreamClient({
    token: 'second-site-token',
    fetchImpl: async () => {
      throw new Error('not called');
    }
  });

  assert.equal(typeof client.generate, 'function');
  assert.equal(client.edit, undefined);
});

test('rejects unknown upstream providers', () => {
  assert.throws(
    () => createUpstreamClient({ provider: 'unknown' }),
    (error) => error instanceof AdapterError && error.status === 500 && error.code === 'invalid_upstream_provider'
  );
});
