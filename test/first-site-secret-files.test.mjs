import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createFirstSiteClient } from '../src/first-site-client.mjs';
import { restoreEnv } from './test-helpers.mjs';

test('reads first-site credentials from files without requiring credential env vars', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'first-site-adapter-'));
  try {
    const emailFile = join(dir, 'email');
    const passwordFile = join(dir, 'password');
    await writeFile(emailFile, 'file-user@example.test\n', { mode: 0o600 });
    await writeFile(passwordFile, 'file-secret\n', { mode: 0o600 });
    const previous = setSecretFileEnv(emailFile, passwordFile);
    try {
      const calls = [];
      const client = createFirstSiteClient({
        baseUrl: 'https://first.example.test',
        fetchImpl: async (url, options) => {
          calls.push({ url, options });
          if (url.endsWith('/api/auth/sign-in/email')) {
            return jsonResponse(200, { token: 'file-token' }, {
              'set-cookie': '__Secure-better-auth.session_token=file-token; Path=/; HttpOnly; Secure'
            });
          }
          if (url.endsWith('/api/images/generate')) return jsonResponse(200, imageBody());
          if (url.endsWith('/api/storage/generated.png')) return imageResponse();
          throw new Error(`unexpected url: ${url}`);
        }
      });

      await client.generate({ prompt: 'file secret' });

      assert.equal(calls[0].options.body, JSON.stringify({
        email: 'file-user@example.test',
        password: 'file-secret',
        rememberMe: true
      }));
    } finally {
      restoreSecretFileEnv(previous);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function setSecretFileEnv(emailFile, passwordFile) {
  const previous = {
    emailFile: process.env.FIRST_SITE_EMAIL_FILE,
    passwordFile: process.env.FIRST_SITE_PASSWORD_FILE,
    email: process.env.FIRST_SITE_EMAIL,
    password: process.env.FIRST_SITE_PASSWORD
  };
  process.env.FIRST_SITE_EMAIL_FILE = emailFile;
  process.env.FIRST_SITE_PASSWORD_FILE = passwordFile;
  delete process.env.FIRST_SITE_EMAIL;
  delete process.env.FIRST_SITE_PASSWORD;
  return previous;
}

function restoreSecretFileEnv(previous) {
  restoreEnv('FIRST_SITE_EMAIL_FILE', previous.emailFile);
  restoreEnv('FIRST_SITE_PASSWORD_FILE', previous.passwordFile);
  restoreEnv('FIRST_SITE_EMAIL', previous.email);
  restoreEnv('FIRST_SITE_PASSWORD', previous.password);
}

function imageBody() {
  return {
    imageUrl: '/api/storage/generated.png',
    imageOutputs: [{ imageUrl: '/api/storage/generated.png' }]
  };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function imageResponse() {
  return new Response(Buffer.from('image-bytes'), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });
}
