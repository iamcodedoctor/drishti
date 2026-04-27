#!/usr/bin/env bash
# DRISHTI & INSPECTOR-GENERAL
# Runs the Inspector General to audit parsed domains.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "══════════════════════════════════════"
echo "  INSPECTOR-GENERAL v1"
echo "══════════════════════════════════════"
echo ""

if [ ! -f "$PROJECT_ROOT/data/cleaned_results.txt" ]; then
  echo "[ERROR] Input file not found: $PROJECT_ROOT/data/cleaned_results.txt"
  echo "Please run the Drishti scraper and cleaner first."
  exit 1
fi

node "$PROJECT_ROOT/inspector/main.js"

echo ""
echo "[DONE] Inspection complete. Check data/recon/ for reports."
