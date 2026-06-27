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
  assert.doesNotMatch(script, /gpt-image-sidecar-bridge/);
});

test('docker deploy script keeps credentials out of image and env values', async () => {
  const script = await readFile('scripts/deploy-docker.sh', 'utf8');

  assert.match(script, /CONFIG_DIR="\$\{GPT_IMAGE_BRIDGE_CONFIG_DIR:-\$HOME\/\.config\/gpt-image-bridge\}"/);
  assert.match(script, /SECRET_DIR="\$CONFIG_DIR\/secrets"/);
  assert.match(script, /source="\$SECRET_DIR\/adapter-api-key",target=\/run\/gpt-image-bridge\/adapter-api-key,readonly/);
  assert.match(script, /source="\$SECRET_DIR\/upstream-email",target=\/run\/gpt-image-bridge\/upstream-email,readonly/);
  assert.match(script, /source="\$SECRET_DIR\/upstream-password",target=\/run\/gpt-image-bridge\/upstream-password,readonly/);
  assert.match(script, /source="\$SECRET_DIR\/upstream-session-cookie",target=\/run\/gpt-image-bridge\/upstream-session-cookie,readonly/);
  assert.match(script, /source="\$SECRET_DIR\/upstream-session-token",target=\/run\/gpt-image-bridge\/upstream-session-token,readonly/);
  assert.match(script, /ADAPTER_API_KEY_FILE=\/run\/gpt-image-bridge\/adapter-api-key/);
  assert.match(script, /UPSTREAM_EMAIL_FILE=\/run\/gpt-image-bridge\/upstream-email/);
  assert.match(script, /UPSTREAM_PASSWORD_FILE=\/run\/gpt-image-bridge\/upstream-password/);
  assert.match(script, /UPSTREAM_SESSION_COOKIE_FILE=\/run\/gpt-image-bridge\/upstream-session-cookie/);
  assert.match(script, /UPSTREAM_SESSION_TOKEN_FILE=\/run\/gpt-image-bridge\/upstream-session-token/);
  assert.match(script, /--mount type=bind,source="\$SECRET_DIR\/upstream-token",target=\/run\/gpt-image-bridge\/upstream-token,readonly/);
  assert.match(script, /UPSTREAM_TOKEN_FILE=\/run\/gpt-image-bridge\/upstream-token/);
  assert.doesNotMatch(script, /-e ADAPTER_API_KEY=/);
  assert.doesNotMatch(script, /-e UPSTREAM_EMAIL=/);
  assert.doesNotMatch(script, /-e UPSTREAM_PASSWORD=/);
  assert.doesNotMatch(script, /-e UPSTREAM_SESSION_COOKIE=/);
  assert.doesNotMatch(script, /-e UPSTREAM_SESSION_TOKEN=/);
});

test('docker deploy script supports one first-site authentication method', async () => {
  const script = await readFile('scripts/deploy-docker.sh', 'utf8');

  assert.match(script, /UPSTREAM_AUTH_MODE=""/);
  assert.match(script, /UPSTREAM_EMAIL\/FIRST_SITE_EMAIL and UPSTREAM_PASSWORD\/FIRST_SITE_PASSWORD must be configured together/);
  assert.match(script, /Configure only one upstream authentication method/);
  assert.match(script, /Upstream deployment requires credentials, a session cookie, or a session token/);
});

test('docker deploy script supports second-site credential files', async () => {
  const script = await readFile('scripts/deploy-docker.sh', 'utf8');

  assert.match(script, /write_secret "\$SECRET_DIR\/upstream-email" "\$UPSTREAM_EMAIL" "\$UPSTREAM_EMAIL_FILE" "UPSTREAM_EMAIL"/);
  assert.match(script, /write_secret "\$SECRET_DIR\/upstream-password" "\$UPSTREAM_PASSWORD" "\$UPSTREAM_PASSWORD_FILE" "UPSTREAM_PASSWORD"/);
  assert.match(script, /SECOND_SITE_HAS_TOKEN=false/);
  assert.match(script, /Second-site deployment requires credentials or UPSTREAM_TOKEN\/SECOND_SITE_TOKEN/);
  assert.match(script, /SECOND_SITE_EMAIL_FILE=\/run\/gpt-image-bridge\/upstream-email/);
  assert.match(script, /SECOND_SITE_PASSWORD_FILE=\/run\/gpt-image-bridge\/upstream-password/);
});

test('docker deploy script keeps legacy provider variables compatible', async () => {
  const script = await readFile('scripts/deploy-docker.sh', 'utf8');

  assert.match(script, /FIRST_SITE_EMAIL="\$\{FIRST_SITE_EMAIL:-\}"/);
  assert.match(script, /SECOND_SITE_EMAIL="\$\{SECOND_SITE_EMAIL:-\}"/);
  assert.match(script, /FIRST_SITE_EMAIL_FILE="\$\{FIRST_SITE_EMAIL_FILE:-\}"/);
  assert.match(script, /SECOND_SITE_EMAIL_FILE="\$\{SECOND_SITE_EMAIL_FILE:-\}"/);
  assert.match(script, /UPSTREAM_BASE_URL="\$\{UPSTREAM_BASE_URL:-\$\{FIRST_SITE_BASE_URL:-\}\}"/);
  assert.match(script, /UPSTREAM_BASE_URL="\$\{UPSTREAM_BASE_URL:-\$\{SECOND_SITE_BASE_URL:-\}\}"/);
});

test('docker deploy script prefers provider-specific base URLs before defaults', async () => {
  const script = await readFile('scripts/deploy-docker.sh', 'utf8');

  assert.match(script, /first-site[\s\S]*UPSTREAM_BASE_URL="\$\{UPSTREAM_BASE_URL:-\$\{FIRST_SITE_BASE_URL:-\}\}"/);
  assert.match(script, /second-site[\s\S]*UPSTREAM_BASE_URL="\$\{UPSTREAM_BASE_URL:-\$\{SECOND_SITE_BASE_URL:-\}\}"/);
  assert.match(script, /UPSTREAM_BASE_URL must be an http\(s\) URL without credentials, query, or fragment/);
  assert.match(script, /UPSTREAM_TIMEOUT_MS must be a positive integer/);
  assert.match(script, /UPSTREAM_OUTPUT_FORMAT must be png, jpeg, jpg, or webp/);
});

test('gitignore covers unified secret filenames', async () => {
  const gitignore = await readFile('.gitignore', 'utf8');

  assert.match(gitignore, /^upstream-email$/m);
  assert.match(gitignore, /^upstream-password$/m);
  assert.match(gitignore, /^upstream-session-cookie$/m);
  assert.match(gitignore, /^upstream-session-token$/m);
  assert.match(gitignore, /^upstream-token$/m);
});

test('dockerignore keeps build context and secrets out of the image build', async () => {
  const dockerignore = await readFile('.dockerignore', 'utf8');

  assert.match(dockerignore, /^\.git$/m);
  assert.match(dockerignore, /^node_modules$/m);
  assert.match(dockerignore, /^test$/m);
  assert.match(dockerignore, /^scripts$/m);
  assert.match(dockerignore, /^upstream-email$/m);
  assert.match(dockerignore, /^upstream-password$/m);
  assert.match(dockerignore, /^upstream-session-cookie$/m);
  assert.match(dockerignore, /^upstream-session-token$/m);
  assert.match(dockerignore, /^upstream-token$/m);
});

test('dockerfile keeps runtime image inputs minimal', async () => {
  const dockerfile = await readFile('Dockerfile', 'utf8');

  assert.match(dockerfile, /COPY package\.json \.\/$/m);
  assert.doesNotMatch(dockerfile, /README\.md/);
  assert.match(dockerfile, /COPY src \.\/src/);
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
