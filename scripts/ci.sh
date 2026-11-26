#!/usr/bin/env bash
# CI: unit tests, a full build (downloads the toolchain and docs), then the
# end-to-end test in headless Chromium, which compiles and runs programs
# online and offline.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
npm test
scripts/build.sh
# On GitHub's runners, fetch the Chromium that this Playwright version expects.
if [ -n "${GITHUB_ACTIONS:-}" ]; then npx playwright install --with-deps chromium; fi
node tests/e2e.mjs
