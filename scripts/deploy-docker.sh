#!/usr/bin/env sh
set -eu

CONTAINER="${GPT_IMAGE_BRIDGE_CONTAINER:-gpt-image-bridge}"
IMAGE="${GPT_IMAGE_BRIDGE_IMAGE:-gpt-image-bridge:local}"
PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CONFIG_DIR="${GPT_IMAGE_BRIDGE_CONFIG_DIR:-$HOME/.config/gpt-image-bridge}"
SECRET_DIR="$CONFIG_DIR/secrets"
EFFECTIVE_PROVIDER="${GPT_IMAGE_BRIDGE_PROVIDER:-second-site}"
EFFECTIVE_HOST_PORT="${HOST_PORT:-3099}"
EFFECTIVE_CONTAINER_PORT="${PORT:-3099}"
FIRST_SITE_EMAIL="${FIRST_SITE_EMAIL:-}"
FIRST_SITE_PASSWORD="${FIRST_SITE_PASSWORD:-}"
FIRST_SITE_SESSION_COOKIE="${FIRST_SITE_SESSION_COOKIE:-}"
FIRST_SITE_SESSION_TOKEN="${FIRST_SITE_SESSION_TOKEN:-}"
FIRST_SITE_BASE_URL="${FIRST_SITE_BASE_URL:-}"
FIRST_SITE_MODEL="${FIRST_SITE_MODEL:-}"
FIRST_SITE_OUTPUT_FORMAT="${FIRST_SITE_OUTPUT_FORMAT:-}"
FIRST_SITE_TIMEOUT_MS="${FIRST_SITE_TIMEOUT_MS:-}"
FIRST_SITE_SIZE="${FIRST_SITE_SIZE:-}"
FIRST_SITE_EDIT_SIZE="${FIRST_SITE_EDIT_SIZE:-}"
FIRST_SITE_QUALITY="${FIRST_SITE_QUALITY:-}"
FIRST_SITE_BACKGROUND="${FIRST_SITE_BACKGROUND:-}"
FIRST_SITE_THINKING="${FIRST_SITE_THINKING:-}"
FIRST_SITE_MODERATION="${FIRST_SITE_MODERATION:-}"
FIRST_SITE_MIX_WEB_FIRST="${FIRST_SITE_MIX_WEB_FIRST:-}"
FIRST_SITE_PROMPT_OPTIMIZATION="${FIRST_SITE_PROMPT_OPTIMIZATION:-}"
FIRST_SITE_EMAIL_FILE="${FIRST_SITE_EMAIL_FILE:-}"
FIRST_SITE_PASSWORD_FILE="${FIRST_SITE_PASSWORD_FILE:-}"
FIRST_SITE_SESSION_COOKIE_FILE="${FIRST_SITE_SESSION_COOKIE_FILE:-}"
FIRST_SITE_SESSION_TOKEN_FILE="${FIRST_SITE_SESSION_TOKEN_FILE:-}"
SECOND_SITE_EMAIL="${SECOND_SITE_EMAIL:-}"
SECOND_SITE_PASSWORD="${SECOND_SITE_PASSWORD:-}"
SECOND_SITE_TOKEN="${SECOND_SITE_TOKEN:-}"
SECOND_SITE_BASE_URL="${SECOND_SITE_BASE_URL:-}"
SECOND_SITE_MODEL="${SECOND_SITE_MODEL:-}"
SECOND_SITE_OUTPUT_FORMAT="${SECOND_SITE_OUTPUT_FORMAT:-}"
SECOND_SITE_TIMEOUT_MS="${SECOND_SITE_TIMEOUT_MS:-}"
SECOND_SITE_PAYMENT_MODE="${SECOND_SITE_PAYMENT_MODE:-}"
SECOND_SITE_EMAIL_FILE="${SECOND_SITE_EMAIL_FILE:-}"
SECOND_SITE_PASSWORD_FILE="${SECOND_SITE_PASSWORD_FILE:-}"
SECOND_SITE_TOKEN_FILE="${SECOND_SITE_TOKEN_FILE:-}"
UPSTREAM_AUTH_MODE=""
UPSTREAM_EMAIL="${UPSTREAM_EMAIL:-}"
UPSTREAM_PASSWORD="${UPSTREAM_PASSWORD:-}"
UPSTREAM_SESSION_COOKIE="${UPSTREAM_SESSION_COOKIE:-}"
UPSTREAM_SESSION_TOKEN="${UPSTREAM_SESSION_TOKEN:-}"
UPSTREAM_TOKEN="${UPSTREAM_TOKEN:-}"
UPSTREAM_MODEL="${UPSTREAM_MODEL:-}"
UPSTREAM_OUTPUT_FORMAT="${UPSTREAM_OUTPUT_FORMAT:-}"
UPSTREAM_TIMEOUT_MS="${UPSTREAM_TIMEOUT_MS:-}"
UPSTREAM_PAYMENT_MODE="${UPSTREAM_PAYMENT_MODE:-}"
UPSTREAM_MIX_WEB_FIRST="${UPSTREAM_MIX_WEB_FIRST:-}"
UPSTREAM_PROMPT_OPTIMIZATION="${UPSTREAM_PROMPT_OPTIMIZATION:-}"
UPSTREAM_BASE_URL="${UPSTREAM_BASE_URL:-}"
UPSTREAM_EMAIL_FILE="${UPSTREAM_EMAIL_FILE:-}"
UPSTREAM_PASSWORD_FILE="${UPSTREAM_PASSWORD_FILE:-}"
UPSTREAM_SESSION_COOKIE_FILE="${UPSTREAM_SESSION_COOKIE_FILE:-}"
UPSTREAM_SESSION_TOKEN_FILE="${UPSTREAM_SESSION_TOKEN_FILE:-}"

write_secret() {
  target="$1"
  value="$2"
  source_file="$3"
  label="$4"
  if [ -n "$source_file" ]; then
    if [ ! -s "$source_file" ]; then
      echo "$label file must exist and must not be empty" >&2
      exit 1
    fi
    cp "$source_file" "$target"
  else
    printf '%s' "$value" > "$target"
  fi
}

if [ -z "${ADAPTER_API_KEY:-}" ]; then
  echo "ADAPTER_API_KEY is required" >&2
  exit 1
fi

case "$EFFECTIVE_PROVIDER" in
  first-site)
    if [ -n "${UPSTREAM_EMAIL:-}" ] || [ -n "${UPSTREAM_EMAIL_FILE:-}" ] || [ -n "${FIRST_SITE_EMAIL:-}" ] || [ -n "${FIRST_SITE_EMAIL_FILE:-}" ] || [ -n "${UPSTREAM_PASSWORD:-}" ] || [ -n "${UPSTREAM_PASSWORD_FILE:-}" ] || [ -n "${FIRST_SITE_PASSWORD:-}" ] || [ -n "${FIRST_SITE_PASSWORD_FILE:-}" ]; then
      if { [ -z "${UPSTREAM_EMAIL:-}" ] && [ -z "${UPSTREAM_EMAIL_FILE:-}" ] && [ -z "${FIRST_SITE_EMAIL:-}" ] && [ -z "${FIRST_SITE_EMAIL_FILE:-}" ]; } || { [ -z "${UPSTREAM_PASSWORD:-}" ] && [ -z "${UPSTREAM_PASSWORD_FILE:-}" ] && [ -z "${FIRST_SITE_PASSWORD:-}" ] && [ -z "${FIRST_SITE_PASSWORD_FILE:-}" ]; }; then
        echo "UPSTREAM_EMAIL/FIRST_SITE_EMAIL and UPSTREAM_PASSWORD/FIRST_SITE_PASSWORD must be configured together" >&2
        exit 1
      fi
      UPSTREAM_AUTH_MODE="credentials"
    fi
    if [ -n "${UPSTREAM_SESSION_COOKIE:-}" ] || [ -n "${UPSTREAM_SESSION_COOKIE_FILE:-}" ] || [ -n "${FIRST_SITE_SESSION_COOKIE:-}" ] || [ -n "${FIRST_SITE_SESSION_COOKIE_FILE:-}" ]; then
      if [ -n "$UPSTREAM_AUTH_MODE" ]; then
        echo "Configure only one upstream authentication method" >&2
        exit 1
      fi
      UPSTREAM_AUTH_MODE="session-cookie"
    fi
    if [ -n "${UPSTREAM_SESSION_TOKEN:-}" ] || [ -n "${UPSTREAM_SESSION_TOKEN_FILE:-}" ] || [ -n "${FIRST_SITE_SESSION_TOKEN:-}" ] || [ -n "${FIRST_SITE_SESSION_TOKEN_FILE:-}" ]; then
      if [ -n "$UPSTREAM_AUTH_MODE" ]; then
        echo "Configure only one upstream authentication method" >&2
        exit 1
      fi
      UPSTREAM_AUTH_MODE="session-token"
    fi
    if [ -z "$UPSTREAM_AUTH_MODE" ]; then
      echo "Upstream deployment requires credentials, a session cookie, or a session token" >&2
      exit 1
    fi
    ;;
  second-site)
    SECOND_SITE_HAS_EMAIL=false
    SECOND_SITE_HAS_PASSWORD=false
    SECOND_SITE_HAS_TOKEN=false
    if [ -n "${UPSTREAM_EMAIL:-}" ] || [ -n "${UPSTREAM_EMAIL_FILE:-}" ] || [ -n "${SECOND_SITE_EMAIL:-}" ] || [ -n "${SECOND_SITE_EMAIL_FILE:-}" ]; then
      SECOND_SITE_HAS_EMAIL=true
    fi
    if [ -n "${UPSTREAM_PASSWORD:-}" ] || [ -n "${UPSTREAM_PASSWORD_FILE:-}" ] || [ -n "${SECOND_SITE_PASSWORD:-}" ] || [ -n "${SECOND_SITE_PASSWORD_FILE:-}" ]; then
      SECOND_SITE_HAS_PASSWORD=true
    fi
    if [ -n "${UPSTREAM_TOKEN:-}" ] || [ -n "${UPSTREAM_TOKEN_FILE:-}" ] || [ -n "${SECOND_SITE_TOKEN:-}" ] || [ -n "${SECOND_SITE_TOKEN_FILE:-}" ]; then
      SECOND_SITE_HAS_TOKEN=true
    fi
    if [ "$SECOND_SITE_HAS_EMAIL" != "$SECOND_SITE_HAS_PASSWORD" ]; then
      echo "UPSTREAM_EMAIL/SECOND_SITE_EMAIL and UPSTREAM_PASSWORD/SECOND_SITE_PASSWORD must be configured together" >&2
      exit 1
    fi
    if [ "$SECOND_SITE_HAS_TOKEN" = false ] && [ "$SECOND_SITE_HAS_EMAIL" = false ]; then
      echo "Second-site deployment requires credentials or UPSTREAM_TOKEN/SECOND_SITE_TOKEN" >&2
      exit 1
    fi
    ;;
  *)
    echo "GPT_IMAGE_BRIDGE_PROVIDER must be first-site or second-site" >&2
    exit 1
    ;;
esac

case "$EFFECTIVE_PROVIDER" in
  first-site)
    UPSTREAM_BASE_URL="${UPSTREAM_BASE_URL:-${FIRST_SITE_BASE_URL:-}}"
    EFFECTIVE_UPSTREAM_BASE_URL="${UPSTREAM_BASE_URL:-https://gpt2image.superapi.buzz}"
    ;;
  second-site)
    UPSTREAM_BASE_URL="${UPSTREAM_BASE_URL:-${SECOND_SITE_BASE_URL:-}}"
    EFFECTIVE_UPSTREAM_BASE_URL="${UPSTREAM_BASE_URL:-http://154.9.255.153:2254}"
    ;;
esac

case "$EFFECTIVE_PROVIDER" in
  first-site)
    UPSTREAM_EMAIL="${UPSTREAM_EMAIL:-${FIRST_SITE_EMAIL:-}}"
    UPSTREAM_EMAIL_FILE="${UPSTREAM_EMAIL_FILE:-${FIRST_SITE_EMAIL_FILE:-}}"
    UPSTREAM_PASSWORD="${UPSTREAM_PASSWORD:-${FIRST_SITE_PASSWORD:-}}"
    UPSTREAM_PASSWORD_FILE="${UPSTREAM_PASSWORD_FILE:-${FIRST_SITE_PASSWORD_FILE:-}}"
    UPSTREAM_SESSION_COOKIE="${UPSTREAM_SESSION_COOKIE:-${FIRST_SITE_SESSION_COOKIE:-}}"
    UPSTREAM_SESSION_COOKIE_FILE="${UPSTREAM_SESSION_COOKIE_FILE:-${FIRST_SITE_SESSION_COOKIE_FILE:-}}"
    UPSTREAM_SESSION_TOKEN="${UPSTREAM_SESSION_TOKEN:-${FIRST_SITE_SESSION_TOKEN:-}}"
    UPSTREAM_SESSION_TOKEN_FILE="${UPSTREAM_SESSION_TOKEN_FILE:-${FIRST_SITE_SESSION_TOKEN_FILE:-}}"
    UPSTREAM_MODEL="${UPSTREAM_MODEL:-${FIRST_SITE_MODEL:-gpt-image-2}}"
    UPSTREAM_OUTPUT_FORMAT="${UPSTREAM_OUTPUT_FORMAT:-${FIRST_SITE_OUTPUT_FORMAT:-png}}"
    UPSTREAM_TIMEOUT_MS="${UPSTREAM_TIMEOUT_MS:-${FIRST_SITE_TIMEOUT_MS:-240000}}"
    UPSTREAM_SIZE="${UPSTREAM_SIZE:-${FIRST_SITE_SIZE:-1024x1024}}"
    UPSTREAM_EDIT_SIZE="${UPSTREAM_EDIT_SIZE:-${FIRST_SITE_EDIT_SIZE:-1024x1024}}"
    UPSTREAM_QUALITY="${UPSTREAM_QUALITY:-${FIRST_SITE_QUALITY:-auto}}"
    UPSTREAM_BACKGROUND="${UPSTREAM_BACKGROUND:-${FIRST_SITE_BACKGROUND:-auto}}"
    UPSTREAM_THINKING="${UPSTREAM_THINKING:-${FIRST_SITE_THINKING:-low}}"
    UPSTREAM_MODERATION="${UPSTREAM_MODERATION:-${FIRST_SITE_MODERATION:-auto}}"
    UPSTREAM_MIX_WEB_FIRST="${UPSTREAM_MIX_WEB_FIRST:-${FIRST_SITE_MIX_WEB_FIRST:-true}}"
    UPSTREAM_PROMPT_OPTIMIZATION="${UPSTREAM_PROMPT_OPTIMIZATION:-${FIRST_SITE_PROMPT_OPTIMIZATION:-false}}"
    ;;
  second-site)
    UPSTREAM_EMAIL="${UPSTREAM_EMAIL:-${SECOND_SITE_EMAIL:-}}"
    UPSTREAM_EMAIL_FILE="${UPSTREAM_EMAIL_FILE:-${SECOND_SITE_EMAIL_FILE:-}}"
    UPSTREAM_PASSWORD="${UPSTREAM_PASSWORD:-${SECOND_SITE_PASSWORD:-}}"
    UPSTREAM_PASSWORD_FILE="${UPSTREAM_PASSWORD_FILE:-${SECOND_SITE_PASSWORD_FILE:-}}"
    UPSTREAM_TOKEN="${UPSTREAM_TOKEN:-${SECOND_SITE_TOKEN:-}}"
    UPSTREAM_TOKEN_FILE="${UPSTREAM_TOKEN_FILE:-${SECOND_SITE_TOKEN_FILE:-}}"
    UPSTREAM_MODEL="${UPSTREAM_MODEL:-${SECOND_SITE_MODEL:-gpt-image-2}}"
    UPSTREAM_OUTPUT_FORMAT="${UPSTREAM_OUTPUT_FORMAT:-${SECOND_SITE_OUTPUT_FORMAT:-png}}"
    UPSTREAM_TIMEOUT_MS="${UPSTREAM_TIMEOUT_MS:-${SECOND_SITE_TIMEOUT_MS:-240000}}"
    UPSTREAM_PAYMENT_MODE="${UPSTREAM_PAYMENT_MODE:-${SECOND_SITE_PAYMENT_MODE:-tier}}"
    ;;
esac

node -e "
const baseUrl = process.argv[1];
const hostPort = Number(process.argv[2]);
const containerPort = Number(process.argv[3]);
const timeout = process.argv[4];
const outputFormat = process.argv[5];
try {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('UPSTREAM_BASE_URL must be an http(s) URL without credentials, query, or fragment');
  }
  for (const [name, value] of [['HOST_PORT', hostPort], ['PORT', containerPort]]) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(name + ' must be an integer from 1 to 65535');
    }
  }
  if (timeout) {
    const timeoutMs = Number(timeout);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('UPSTREAM_TIMEOUT_MS must be a positive integer');
    }
  }
  const normalizedOutputFormat = (outputFormat || 'png').toLowerCase() === 'jpg'
    ? 'jpeg'
    : (outputFormat || 'png').toLowerCase();
  if (!['png', 'jpeg', 'webp'].includes(normalizedOutputFormat)) {
    throw new Error('UPSTREAM_OUTPUT_FORMAT must be png, jpeg, jpg, or webp');
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
" "$EFFECTIVE_UPSTREAM_BASE_URL" "$EFFECTIVE_HOST_PORT" "$EFFECTIVE_CONTAINER_PORT" "${UPSTREAM_TIMEOUT_MS:-}" "${UPSTREAM_OUTPUT_FORMAT:-png}"

docker build -t "$IMAGE" "$PROJECT_DIR"

if docker ps -a --format '{{.Names}}' | grep -Fx "$CONTAINER" >/dev/null; then
  docker rm -f "$CONTAINER" >/dev/null
fi

mkdir -p "$SECRET_DIR"
chmod 700 "$CONFIG_DIR" "$SECRET_DIR"
if [ "$EFFECTIVE_PROVIDER" = "first-site" ]; then
  case "$UPSTREAM_AUTH_MODE" in
    session-cookie)
      if [ -n "${UPSTREAM_SESSION_COOKIE_FILE:-}" ]; then
        if [ ! -s "$UPSTREAM_SESSION_COOKIE_FILE" ]; then
          echo "UPSTREAM_SESSION_COOKIE_FILE must exist and must not be empty" >&2
          exit 1
        fi
        UPSTREAM_SESSION_COOKIE="$(cat "$UPSTREAM_SESSION_COOKIE_FILE")"
        UPSTREAM_SESSION_COOKIE_FILE=""
      fi
      ;;
    session-token)
      if [ -n "${UPSTREAM_SESSION_TOKEN_FILE:-}" ]; then
        if [ ! -s "$UPSTREAM_SESSION_TOKEN_FILE" ]; then
          echo "UPSTREAM_SESSION_TOKEN_FILE must exist and must not be empty" >&2
          exit 1
        fi
        UPSTREAM_SESSION_TOKEN="$(cat "$UPSTREAM_SESSION_TOKEN_FILE")"
        UPSTREAM_SESSION_TOKEN_FILE=""
      fi
      ;;
  esac
fi
umask 077
rm -f \
  "$SECRET_DIR/adapter-api-key" \
  "$SECRET_DIR/upstream-email" \
  "$SECRET_DIR/upstream-password" \
  "$SECRET_DIR/upstream-session-cookie" \
  "$SECRET_DIR/upstream-session-token" \
  "$SECRET_DIR/upstream-token"
printf '%s' "$ADAPTER_API_KEY" > "$SECRET_DIR/adapter-api-key"
if [ "$EFFECTIVE_PROVIDER" = "first-site" ]; then
  case "$UPSTREAM_AUTH_MODE" in
    credentials)
      write_secret "$SECRET_DIR/upstream-email" "$UPSTREAM_EMAIL" "$UPSTREAM_EMAIL_FILE" "UPSTREAM_EMAIL"
      write_secret "$SECRET_DIR/upstream-password" "$UPSTREAM_PASSWORD" "$UPSTREAM_PASSWORD_FILE" "UPSTREAM_PASSWORD"
      ;;
    session-cookie)
      write_secret "$SECRET_DIR/upstream-session-cookie" "$UPSTREAM_SESSION_COOKIE" "$UPSTREAM_SESSION_COOKIE_FILE" "UPSTREAM_SESSION_COOKIE"
      ;;
    session-token)
      write_secret "$SECRET_DIR/upstream-session-token" "$UPSTREAM_SESSION_TOKEN" "$UPSTREAM_SESSION_TOKEN_FILE" "UPSTREAM_SESSION_TOKEN"
      ;;
  esac
else
  write_secret "$SECRET_DIR/upstream-email" "$UPSTREAM_EMAIL" "$UPSTREAM_EMAIL_FILE" "UPSTREAM_EMAIL"
  write_secret "$SECRET_DIR/upstream-password" "$UPSTREAM_PASSWORD" "$UPSTREAM_PASSWORD_FILE" "UPSTREAM_PASSWORD"
  write_secret "$SECRET_DIR/upstream-token" "$UPSTREAM_TOKEN" "$UPSTREAM_TOKEN_FILE" "UPSTREAM_TOKEN"
fi
umask 022
chmod 400 "$SECRET_DIR/adapter-api-key"
if [ "$EFFECTIVE_PROVIDER" = "first-site" ]; then
  case "$UPSTREAM_AUTH_MODE" in
    credentials)
      chmod 400 "$SECRET_DIR/upstream-email" "$SECRET_DIR/upstream-password"
      ;;
    session-cookie)
      chmod 400 "$SECRET_DIR/upstream-session-cookie"
      ;;
    session-token)
      chmod 400 "$SECRET_DIR/upstream-session-token"
      ;;
  esac
else
  chmod 400 "$SECRET_DIR/upstream-email" "$SECRET_DIR/upstream-password" "$SECRET_DIR/upstream-token"
fi

if [ "$EFFECTIVE_PROVIDER" = "first-site" ]; then
  set -- docker run -d \
    --name "$CONTAINER" \
    --restart unless-stopped \
    -p "127.0.0.1:$EFFECTIVE_HOST_PORT:$EFFECTIVE_CONTAINER_PORT" \
    --mount type=bind,source="$SECRET_DIR/adapter-api-key",target=/run/gpt-image-bridge/adapter-api-key,readonly \
    -e ADAPTER_API_KEY_FILE=/run/gpt-image-bridge/adapter-api-key \
    -e GPT_IMAGE_BRIDGE_PROVIDER=first-site
  case "$UPSTREAM_AUTH_MODE" in
    credentials)
      set -- "$@" \
        --mount type=bind,source="$SECRET_DIR/upstream-email",target=/run/gpt-image-bridge/upstream-email,readonly \
        --mount type=bind,source="$SECRET_DIR/upstream-password",target=/run/gpt-image-bridge/upstream-password,readonly \
        -e UPSTREAM_EMAIL_FILE=/run/gpt-image-bridge/upstream-email \
        -e UPSTREAM_PASSWORD_FILE=/run/gpt-image-bridge/upstream-password \
        -e FIRST_SITE_EMAIL_FILE=/run/gpt-image-bridge/upstream-email \
        -e FIRST_SITE_PASSWORD_FILE=/run/gpt-image-bridge/upstream-password
      ;;
    session-cookie)
      set -- "$@" \
        --mount type=bind,source="$SECRET_DIR/upstream-session-cookie",target=/run/gpt-image-bridge/upstream-session-cookie,readonly \
        -e UPSTREAM_SESSION_COOKIE_FILE=/run/gpt-image-bridge/upstream-session-cookie \
        -e FIRST_SITE_SESSION_COOKIE_FILE=/run/gpt-image-bridge/upstream-session-cookie
      ;;
    session-token)
      set -- "$@" \
        --mount type=bind,source="$SECRET_DIR/upstream-session-token",target=/run/gpt-image-bridge/upstream-session-token,readonly \
        -e UPSTREAM_SESSION_TOKEN_FILE=/run/gpt-image-bridge/upstream-session-token \
        -e FIRST_SITE_SESSION_TOKEN_FILE=/run/gpt-image-bridge/upstream-session-token
      ;;
  esac
  set -- "$@" \
    -e UPSTREAM_BASE_URL="$EFFECTIVE_UPSTREAM_BASE_URL" \
    -e UPSTREAM_MODEL="$UPSTREAM_MODEL" \
    -e UPSTREAM_TIMEOUT_MS="$UPSTREAM_TIMEOUT_MS" \
    -e UPSTREAM_OUTPUT_FORMAT="${UPSTREAM_OUTPUT_FORMAT:-png}" \
    -e UPSTREAM_SIZE="${UPSTREAM_SIZE:-1024x1024}" \
    -e UPSTREAM_EDIT_SIZE="${UPSTREAM_EDIT_SIZE:-1024x1024}" \
    -e UPSTREAM_QUALITY="${UPSTREAM_QUALITY:-auto}" \
    -e UPSTREAM_BACKGROUND="${UPSTREAM_BACKGROUND:-auto}" \
    -e UPSTREAM_THINKING="${UPSTREAM_THINKING:-low}" \
    -e UPSTREAM_MODERATION="${UPSTREAM_MODERATION:-auto}" \
    -e UPSTREAM_MIX_WEB_FIRST="${UPSTREAM_MIX_WEB_FIRST:-true}" \
    -e UPSTREAM_PROMPT_OPTIMIZATION="${UPSTREAM_PROMPT_OPTIMIZATION:-false}" \
    -e HOST=0.0.0.0 \
    -e PORT="$EFFECTIVE_CONTAINER_PORT" \
    "$IMAGE"
  "$@" >/dev/null
else
  docker run -d \
    --name "$CONTAINER" \
    --restart unless-stopped \
    -p "127.0.0.1:$EFFECTIVE_HOST_PORT:$EFFECTIVE_CONTAINER_PORT" \
    --mount type=bind,source="$SECRET_DIR/adapter-api-key",target=/run/gpt-image-bridge/adapter-api-key,readonly \
    --mount type=bind,source="$SECRET_DIR/upstream-email",target=/run/gpt-image-bridge/upstream-email,readonly \
    --mount type=bind,source="$SECRET_DIR/upstream-password",target=/run/gpt-image-bridge/upstream-password,readonly \
    --mount type=bind,source="$SECRET_DIR/upstream-token",target=/run/gpt-image-bridge/upstream-token,readonly \
    -e ADAPTER_API_KEY_FILE=/run/gpt-image-bridge/adapter-api-key \
    -e GPT_IMAGE_BRIDGE_PROVIDER=second-site \
    -e UPSTREAM_EMAIL_FILE=/run/gpt-image-bridge/upstream-email \
    -e UPSTREAM_PASSWORD_FILE=/run/gpt-image-bridge/upstream-password \
    -e UPSTREAM_TOKEN_FILE=/run/gpt-image-bridge/upstream-token \
    -e SECOND_SITE_EMAIL_FILE=/run/gpt-image-bridge/upstream-email \
    -e SECOND_SITE_PASSWORD_FILE=/run/gpt-image-bridge/upstream-password \
    -e SECOND_SITE_TOKEN_FILE=/run/gpt-image-bridge/upstream-token \
    -e UPSTREAM_BASE_URL="$EFFECTIVE_UPSTREAM_BASE_URL" \
    -e UPSTREAM_MODEL="$UPSTREAM_MODEL" \
    -e UPSTREAM_TIMEOUT_MS="$UPSTREAM_TIMEOUT_MS" \
    -e UPSTREAM_PAYMENT_MODE="${UPSTREAM_PAYMENT_MODE:-tier}" \
    -e UPSTREAM_OUTPUT_FORMAT="${UPSTREAM_OUTPUT_FORMAT:-png}" \
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
