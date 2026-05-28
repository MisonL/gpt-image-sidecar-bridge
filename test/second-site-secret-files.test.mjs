import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createSecondSiteClient } from '../src/second-site-client.mjs';
import { jsonResponse, restoreEnv } from './test-helpers.mjs';

test('reads second-site credentials from files without requiring credential env vars', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'second-site-adapter-'));
  try {
    const { emailFile, passwordFile } = await writeSecretFiles(dir);
    const previous = setSecretFileEnv(emailFile, passwordFile);
    try {
      const calls = [];
      const client = createSecondSiteClient({
        baseUrl: 'http://example.test',
        fetchImpl: async (url, options) => secretFileFetch(url, options, calls)
      });

      await client.generate({ prompt: 'file secret' });

      assert.equal(calls[0].options.body, JSON.stringify(secretBody()));
    } finally {
      restoreSecretFileEnv(previous);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('keeps file credentials in memory for token refresh after files are removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'second-site-adapter-'));
  try {
    const { emailFile, passwordFile } = await writeSecretFiles(dir);
    const previous = setSecretFileEnv(emailFile, passwordFile, { clearPlainEnv: false });
    try {
      let loginCalls = 0;
      let generationCalls = 0;
      const client = createSecondSiteClient({
        baseUrl: 'http://example.test',
        token: 'stale-token',
        fetchImpl: async (url, options) => {
          if (url.endsWith('/v1/auth/login')) {
            loginCalls += 1;
            assert.equal(options.body, JSON.stringify(secretBody()));
            return jsonResponse(200, { token: 'fresh-token' });
          }
          if (url.endsWith('/v1/images/generations')) {
            generationCalls += 1;
            if (generationCalls === 1) {
              await rm(dir, { recursive: true, force: true });
              return jsonResponse(401, { error: { message: 'expired' } });
            }
            assert.equal(options.headers.authorization, 'Bearer fresh-token');
            return jsonResponse(200, { created: 1, data: [{ b64_json: 'ok' }] });
          }
          throw new Error(`unexpected url: ${url}`);
        }
      });

      const result = await client.generate({ prompt: 'refresh after file removal' });

      assert.equal(loginCalls, 1);
      assert.deepEqual(result, { created: 1, data: [{ b64_json: 'ok' }] });
    } finally {
      restoreSecretFileEnv(previous);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function writeSecretFiles(dir) {
  const emailFile = join(dir, 'email');
  const passwordFile = join(dir, 'password');
  await writeFile(emailFile, `${secretBody().email}\n`, { mode: 0o600 });
  await writeFile(passwordFile, `${secretBody().password}\n`, { mode: 0o600 });
  return { emailFile, passwordFile };
}

function setSecretFileEnv(emailFile, passwordFile, options = {}) {
  const previous = {
    emailFile: process.env.SECOND_SITE_EMAIL_FILE,
    passwordFile: process.env.SECOND_SITE_PASSWORD_FILE,
    email: process.env.SECOND_SITE_EMAIL,
    password: process.env.SECOND_SITE_PASSWORD
  };
  process.env.SECOND_SITE_EMAIL_FILE = emailFile;
  process.env.SECOND_SITE_PASSWORD_FILE = passwordFile;
  if (options.clearPlainEnv !== false) {
    delete process.env.SECOND_SITE_EMAIL;
    delete process.env.SECOND_SITE_PASSWORD;
  }
  return previous;
}

function restoreSecretFileEnv(previous) {
  restoreEnv('SECOND_SITE_EMAIL_FILE', previous.emailFile);
  restoreEnv('SECOND_SITE_PASSWORD_FILE', previous.passwordFile);
  restoreEnv('SECOND_SITE_EMAIL', previous.email);
  restoreEnv('SECOND_SITE_PASSWORD', previous.password);
}

function secretBody() {
  return { email: 'file-user@example.test', password: 'file-secret' };
}

function secretFileFetch(url, options, calls) {
  calls.push({ url, options });
  if (url.endsWith('/v1/auth/login')) return jsonResponse(200, { token: 'file-token' });
  if (url.endsWith('/v1/images/generations')) return jsonResponse(200, { created: 1, data: [{ b64_json: 'abc' }] });
  throw new Error(`unexpected url: ${url}`);
}
