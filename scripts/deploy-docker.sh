#!/usr/bin/env sh
set -eu

CONTAINER="${GPT_IMAGE_BRIDGE_CONTAINER:-gpt-image-bridge}"
IMAGE="${GPT_IMAGE_BRIDGE_IMAGE:-gpt-image-bridge:local}"
PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CONFIG_DIR="${GPT_IMAGE_BRIDGE_CONFIG_DIR:-$HOME/.config/gpt-image-bridge}"
SECRET_DIR="$CONFIG_DIR/secrets"
EFFECTIVE_PROVIDER="${GPT_IMAGE_BRIDGE_PROVIDER:-second-site}"
EFFECTIVE_SECOND_SITE_BASE_URL="${SECOND_SITE_BASE_URL:-http://154.9.255.153:2254}"
EFFECTIVE_FIRST_SITE_BASE_URL="${FIRST_SITE_BASE_URL:-https://gpt2image.superapi.buzz}"
EFFECTIVE_HOST_PORT="${HOST_PORT:-3099}"
EFFECTIVE_CONTAINER_PORT="${PORT:-3099}"

if [ -z "${ADAPTER_API_KEY:-}" ]; then
  echo "ADAPTER_API_KEY is required" >&2
  exit 1
fi

case "$EFFECTIVE_PROVIDER" in
  first-site)
    if [ -z "${FIRST_SITE_EMAIL:-}" ]; then
      echo "FIRST_SITE_EMAIL is required" >&2
      exit 1
    fi
    if [ -z "${FIRST_SITE_PASSWORD:-}" ]; then
      echo "FIRST_SITE_PASSWORD is required" >&2
      exit 1
    fi
    ;;
  second-site)
    if [ -z "${SECOND_SITE_EMAIL:-}" ]; then
      echo "SECOND_SITE_EMAIL is required" >&2
      exit 1
    fi
    if [ -z "${SECOND_SITE_PASSWORD:-}" ]; then
      echo "SECOND_SITE_PASSWORD is required" >&2
      exit 1
    fi
    ;;
  *)
    echo "GPT_IMAGE_BRIDGE_PROVIDER must be first-site or second-site" >&2
    exit 1
    ;;
esac

node -e "
const provider = process.argv[1];
const baseUrl = process.argv[2];
const hostPort = Number(process.argv[3]);
const containerPort = Number(process.argv[4]);
const timeout = process.argv[5];
const outputFormat = process.argv[6];
try {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(provider.toUpperCase().replace('-', '_') + '_BASE_URL must be an http(s) URL without credentials, query, or fragment');
  }
  for (const [name, value] of [['HOST_PORT', hostPort], ['PORT', containerPort]]) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(name + ' must be an integer from 1 to 65535');
    }
  }
  if (timeout) {
    const timeoutMs = Number(timeout);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error(provider.toUpperCase().replace('-', '_') + '_TIMEOUT_MS must be a positive integer');
    }
  }
  const normalizedOutputFormat = (outputFormat || 'png').toLowerCase() === 'jpg'
    ? 'jpeg'
    : (outputFormat || 'png').toLowerCase();
  if (!['png', 'jpeg', 'webp'].includes(normalizedOutputFormat)) {
    throw new Error(provider.toUpperCase().replace('-', '_') + '_OUTPUT_FORMAT must be png, jpeg, jpg, or webp');
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
" "$EFFECTIVE_PROVIDER" "$(if [ "$EFFECTIVE_PROVIDER" = "first-site" ]; then printf '%s' "$EFFECTIVE_FIRST_SITE_BASE_URL"; else printf '%s' "$EFFECTIVE_SECOND_SITE_BASE_URL"; fi)" "$EFFECTIVE_HOST_PORT" "$EFFECTIVE_CONTAINER_PORT" "$(if [ "$EFFECTIVE_PROVIDER" = "first-site" ]; then printf '%s' "${FIRST_SITE_TIMEOUT_MS:-}"; else printf '%s' "${SECOND_SITE_TIMEOUT_MS:-}"; fi)" "$(if [ "$EFFECTIVE_PROVIDER" = "first-site" ]; then printf '%s' "${FIRST_SITE_OUTPUT_FORMAT:-png}"; else printf '%s' "${SECOND_SITE_OUTPUT_FORMAT:-png}"; fi)"

docker build -t "$IMAGE" "$PROJECT_DIR"

for name in "$CONTAINER" gpt-image-sidecar-bridge; do
  if docker ps -a --format '{{.Names}}' | grep -Fx "$name" >/dev/null; then
    docker rm -f "$name" >/dev/null
  fi
done

mkdir -p "$SECRET_DIR"
chmod 700 "$CONFIG_DIR" "$SECRET_DIR"
umask 077
rm -f "$SECRET_DIR/adapter-api-key" "$SECRET_DIR/second-site-email" "$SECRET_DIR/second-site-password" "$SECRET_DIR/first-site-email" "$SECRET_DIR/first-site-password"
printf '%s' "$ADAPTER_API_KEY" > "$SECRET_DIR/adapter-api-key"
if [ "$EFFECTIVE_PROVIDER" = "first-site" ]; then
  printf '%s' "$FIRST_SITE_EMAIL" > "$SECRET_DIR/first-site-email"
  printf '%s' "$FIRST_SITE_PASSWORD" > "$SECRET_DIR/first-site-password"
else
  printf '%s' "$SECOND_SITE_EMAIL" > "$SECRET_DIR/second-site-email"
  printf '%s' "$SECOND_SITE_PASSWORD" > "$SECRET_DIR/second-site-password"
fi
umask 022
chmod 400 "$SECRET_DIR/adapter-api-key"
if [ "$EFFECTIVE_PROVIDER" = "first-site" ]; then
  chmod 400 "$SECRET_DIR/first-site-email" "$SECRET_DIR/first-site-password"
else
  chmod 400 "$SECRET_DIR/second-site-email" "$SECRET_DIR/second-site-password"
fi

if [ "$EFFECTIVE_PROVIDER" = "first-site" ]; then
  docker run -d \
    --name "$CONTAINER" \
    --restart unless-stopped \
    -p "127.0.0.1:$EFFECTIVE_HOST_PORT:$EFFECTIVE_CONTAINER_PORT" \
    --mount type=bind,source="$SECRET_DIR/adapter-api-key",target=/run/gpt-image-bridge/adapter-api-key,readonly \
    --mount type=bind,source="$SECRET_DIR/first-site-email",target=/run/gpt-image-bridge/first-site-email,readonly \
    --mount type=bind,source="$SECRET_DIR/first-site-password",target=/run/gpt-image-bridge/first-site-password,readonly \
    -e ADAPTER_API_KEY_FILE=/run/gpt-image-bridge/adapter-api-key \
    -e GPT_IMAGE_BRIDGE_PROVIDER=first-site \
    -e FIRST_SITE_EMAIL_FILE=/run/gpt-image-bridge/first-site-email \
    -e FIRST_SITE_PASSWORD_FILE=/run/gpt-image-bridge/first-site-password \
    -e FIRST_SITE_BASE_URL="$EFFECTIVE_FIRST_SITE_BASE_URL" \
    -e FIRST_SITE_MODEL="${FIRST_SITE_MODEL:-}" \
    -e FIRST_SITE_TIMEOUT_MS="${FIRST_SITE_TIMEOUT_MS:-}" \
    -e FIRST_SITE_OUTPUT_FORMAT="${FIRST_SITE_OUTPUT_FORMAT:-png}" \
    -e FIRST_SITE_MIX_WEB_FIRST="${FIRST_SITE_MIX_WEB_FIRST:-true}" \
    -e FIRST_SITE_PROMPT_OPTIMIZATION="${FIRST_SITE_PROMPT_OPTIMIZATION:-false}" \
    -e HOST=0.0.0.0 \
    -e PORT="$EFFECTIVE_CONTAINER_PORT" \
    "$IMAGE" >/dev/null
else
  docker run -d \
    --name "$CONTAINER" \
    --restart unless-stopped \
    -p "127.0.0.1:$EFFECTIVE_HOST_PORT:$EFFECTIVE_CONTAINER_PORT" \
    --mount type=bind,source="$SECRET_DIR/adapter-api-key",target=/run/gpt-image-bridge/adapter-api-key,readonly \
    --mount type=bind,source="$SECRET_DIR/second-site-email",target=/run/gpt-image-bridge/second-site-email,readonly \
    --mount type=bind,source="$SECRET_DIR/second-site-password",target=/run/gpt-image-bridge/second-site-password,readonly \
    -e ADAPTER_API_KEY_FILE=/run/gpt-image-bridge/adapter-api-key \
    -e GPT_IMAGE_BRIDGE_PROVIDER=second-site \
    -e SECOND_SITE_EMAIL_FILE=/run/gpt-image-bridge/second-site-email \
    -e SECOND_SITE_PASSWORD_FILE=/run/gpt-image-bridge/second-site-password \
    -e SECOND_SITE_BASE_URL="$EFFECTIVE_SECOND_SITE_BASE_URL" \
    -e SECOND_SITE_MODEL="${SECOND_SITE_MODEL:-}" \
    -e SECOND_SITE_TIMEOUT_MS="${SECOND_SITE_TIMEOUT_MS:-}" \
    -e SECOND_SITE_PAYMENT_MODE="${SECOND_SITE_PAYMENT_MODE:-tier}" \
    -e SECOND_SITE_OUTPUT_FORMAT="${SECOND_SITE_OUTPUT_FORMAT:-png}" \
    -e HOST=0.0.0.0 \
    -e PORT="$EFFECTIVE_CONTAINER_PORT" \
    "$IMAGE" >/dev/null
fi

sleep 1
if ! node -e "fetch('http://127.0.0.1:$EFFECTIVE_HOST_PORT/health').then((response) => { if (!response.ok) throw new Error('status ' + response.status); }).catch((error) => { console.error(error.message); process.exit(1); })"; then
  docker logs "$CONTAINER" --tail 50 >&2 || true
  exit 1
fi

if ! printf '%s' "$ADAPTER_API_KEY" | node -e "let key = ''; process.stdin.on('data', (chunk) => { key += chunk; }); process.stdin.on('end', () => { fetch('http://127.0.0.1:$EFFECTIVE_HOST_PORT/v1/models', { headers: { authorization: 'Bearer ' + key } }).then((response) => { if (!response.ok) throw new Error('status ' + response.status); }).catch((error) => { console.error(error.message); process.exit(1); }); });"; then
  docker logs "$CONTAINER" --tail 50 >&2 || true
  exit 1
fi

echo "Adapter container $CONTAINER is listening at http://127.0.0.1:$EFFECTIVE_HOST_PORT/v1"
