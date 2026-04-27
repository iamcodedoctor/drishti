#!/usr/bin/env bash
# DRISHTI v1 — Clean Results
# Resolves Bing URLs, deduplicates, filters junk, outputs cleaned file.
# Usage: bash scripts/clean.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

node "$PROJECT_ROOT/parser/cleaner.js"
