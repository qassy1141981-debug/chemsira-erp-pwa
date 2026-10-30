#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
npm test
