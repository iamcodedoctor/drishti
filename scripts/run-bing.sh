#!/usr/bin/env bash
# DRISHTI v1 — Bing Engine Runner (5-page pagination)
# Usage: bash scripts/run-bing.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "══════════════════════════════════════"
echo "  DRISHTI v1 — BING ENGINE"
echo "  (5-page pagination per keyword)"
echo "══════════════════════════════════════"
echo ""

if [ ! -f "$PROJECT_ROOT/data/keywords.txt" ]; then
  echo "[ERROR] Keywords file not found: $PROJECT_ROOT/data/keywords.txt"
  exit 1
fi

KEYWORD_COUNT=$(grep -c '[^[:space:]]' "$PROJECT_ROOT/data/keywords.txt" || true)
echo "[INFO] Keywords loaded: $KEYWORD_COUNT"
echo "[INFO] Output file: $PROJECT_ROOT/data/raw_results.txt"
echo ""

node "$PROJECT_ROOT/main.js" --engine bing

echo ""
echo "[DONE] Bing engine completed."
echo "[TIP]  Run 'node parser/cleaner.js' to resolve URLs and generate cleaned output."
