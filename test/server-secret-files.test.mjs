import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../src/server.mjs';
import { fakeClient, restoreEnv } from './test-helpers.mjs';

test('reads adapter API key from file for request authentication', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'second-site-adapter-'));
  try {
    const apiKeyFile = join(dir, 'adapter-key');
    await writeFile(apiKeyFile, 'file-adapter-key\n', { mode: 0o600 });
    const previousApiKeyFile = process.env.ADAPTER_API_KEY_FILE;
    const previousApiKey = process.env.ADAPTER_API_KEY;
    process.env.ADAPTER_API_KEY_FILE = apiKeyFile;
    delete process.env.ADAPTER_API_KEY;

    try {
      const app = createApp({ client: fakeClient() });
      const response = await app.handle(
        new Request('http://adapter.test/v1/models', { headers: { authorization: 'Bearer file-adapter-key' } })
      );

      assert.equal(response.status, 200);
    } finally {
      restoreEnv('ADAPTER_API_KEY_FILE', previousApiKeyFile);
      restoreEnv('ADAPTER_API_KEY', previousApiKey);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
