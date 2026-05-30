import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('docker deploy script runs a standalone bridge service', async () => {
  const script = await readFile('scripts/deploy-docker.sh', 'utf8');

  assert.match(script, /CONTAINER="\$\{GPT_IMAGE_BRIDGE_CONTAINER:-gpt-image-bridge\}"/);
  assert.match(script, /IMAGE="\$\{GPT_IMAGE_BRIDGE_IMAGE:-gpt-image-bridge:local\}"/);
  assert.match(script, /EFFECTIVE_PROVIDER="\$\{GPT_IMAGE_BRIDGE_PROVIDER:-second-site\}"/);
  assert.match(script, /docker build -t "\$IMAGE" "\$PROJECT_DIR"/);
  assert.match(script, /--restart unless-stopped/);
  assert.match(script, /-p "127\.0\.0\.1:\$EFFECTIVE_HOST_PORT:\$EFFECTIVE_CONTAINER_PORT"/);
  assert.doesNotMatch(script, /GPT_IMAGE_BRIDGE_NETWORK_CONTAINER/);
  assert.doesNotMatch(script, /--network container:/);
});

test('docker deploy script keeps credentials out of image and env values', async () => {
  const script = await readFile('scripts/deploy-docker.sh', 'utf8');

  assert.match(script, /CONFIG_DIR="\$\{GPT_IMAGE_BRIDGE_CONFIG_DIR:-\$HOME\/\.config\/gpt-image-bridge\}"/);
  assert.match(script, /SECRET_DIR="\$CONFIG_DIR\/secrets"/);
  assert.match(script, /source="\$SECRET_DIR\/adapter-api-key",target=\/run\/gpt-image-bridge\/adapter-api-key,readonly/);
  assert.match(script, /source="\$SECRET_DIR\/second-site-email",target=\/run\/gpt-image-bridge\/second-site-email,readonly/);
  assert.match(script, /source="\$SECRET_DIR\/second-site-password",target=\/run\/gpt-image-bridge\/second-site-password,readonly/);
  assert.match(script, /source="\$SECRET_DIR\/first-site-email",target=\/run\/gpt-image-bridge\/first-site-email,readonly/);
  assert.match(script, /source="\$SECRET_DIR\/first-site-password",target=\/run\/gpt-image-bridge\/first-site-password,readonly/);
  assert.match(script, /ADAPTER_API_KEY_FILE=\/run\/gpt-image-bridge\/adapter-api-key/);
  assert.match(script, /SECOND_SITE_EMAIL_FILE=\/run\/gpt-image-bridge\/second-site-email/);
  assert.match(script, /SECOND_SITE_PASSWORD_FILE=\/run\/gpt-image-bridge\/second-site-password/);
  assert.match(script, /FIRST_SITE_EMAIL_FILE=\/run\/gpt-image-bridge\/first-site-email/);
  assert.match(script, /FIRST_SITE_PASSWORD_FILE=\/run\/gpt-image-bridge\/first-site-password/);
  assert.doesNotMatch(script, /-e ADAPTER_API_KEY=/);
  assert.doesNotMatch(script, /-e SECOND_SITE_EMAIL=/);
  assert.doesNotMatch(script, /-e SECOND_SITE_PASSWORD=/);
  assert.doesNotMatch(script, /-e FIRST_SITE_EMAIL=/);
  assert.doesNotMatch(script, /-e FIRST_SITE_PASSWORD=/);
});

test('standalone deployment check documents container boundary', async () => {
  const script = await readFile('scripts/check-standalone-deployment.sh', 'utf8');

  assert.match(script, /HostConfig\.NetworkMode/);
  assert.match(script, /running bridge/);
  assert.match(script, /DOWNSTREAM_CONTAINER="\$\{GPT_IMAGE_BRIDGE_DOWNSTREAM_CONTAINER:-\}"/);
  assert.match(script, /host\.docker\.internal:\$HOST_PORT\/health/);
  assert.match(script, /127\.0\.0\.1:\$HOST_PORT\/health/);
  assert.match(script, /Standalone bridge deployment is healthy/);
  assert.doesNotMatch(script, /--network container:/);
  assert.doesNotMatch(script, /docker run/);
});
