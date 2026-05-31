#!/usr/bin/env sh
set -eu

for file in src/*.mjs test/*.mjs; do
  node --check "$file" >/dev/null
done

sh -n scripts/deploy-docker.sh
sh -n scripts/check-standalone-deployment.sh
git diff --check
git diff --cached --check
npm test
