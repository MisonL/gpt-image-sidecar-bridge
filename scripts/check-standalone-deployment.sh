#!/usr/bin/env sh
set -eu

HOST_PORT="${HOST_PORT:-3099}"
CONTAINER="${GPT_IMAGE_BRIDGE_CONTAINER:-gpt-image-bridge}"
DOWNSTREAM_CONTAINER="${GPT_IMAGE_BRIDGE_DOWNSTREAM_CONTAINER:-}"
API_KEY_FILE="${ADAPTER_API_KEY_FILE:-$HOME/.config/gpt-image-bridge/secrets/adapter-api-key}"

if [ ! -s "$API_KEY_FILE" ]; then
  echo "Adapter API key file not found: $API_KEY_FILE" >&2
  exit 1
fi

docker inspect -f '{{.State.Status}} {{.HostConfig.NetworkMode}}' "$CONTAINER" | grep -Fx "running bridge" >/dev/null

node -e "fetch('http://127.0.0.1:$HOST_PORT/health').then((response) => { if (!response.ok) throw new Error('status ' + response.status); }).catch((error) => { console.error(error.message); process.exit(1); })"

printf '%s' "$(cat "$API_KEY_FILE")" | node -e "let key = ''; process.stdin.on('data', (chunk) => { key += chunk; }); process.stdin.on('end', () => { fetch('http://127.0.0.1:$HOST_PORT/v1/models', { headers: { authorization: 'Bearer ' + key } }).then((response) => { if (!response.ok) throw new Error('status ' + response.status); }).catch((error) => { console.error(error.message); process.exit(1); }); });"

if [ -n "$DOWNSTREAM_CONTAINER" ] && docker inspect "$DOWNSTREAM_CONTAINER" >/dev/null 2>&1; then
  docker exec -i "$DOWNSTREAM_CONTAINER" node -e "
async function main() {
const hostUrl = 'http://host.docker.internal:$HOST_PORT/health';
const localUrl = 'http://127.0.0.1:$HOST_PORT/health';
const result = {};
try {
  const localResponse = await fetch(localUrl);
  result.localhost = localResponse.status;
} catch (error) {
  result.localhost = 'unreachable';
}
try {
  const hostResponse = await fetch(hostUrl);
  result.hostDockerInternal = hostResponse.status;
} catch (error) {
  result.hostDockerInternal = 'unreachable';
}
if (result.localhost !== 'unreachable' || result.hostDockerInternal !== 200) {
  console.error(JSON.stringify(result));
  process.exit(1);
}
}
main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
" >/dev/null
fi

echo "Standalone bridge deployment is healthy at http://127.0.0.1:$HOST_PORT/v1"
