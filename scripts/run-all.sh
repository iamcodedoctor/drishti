#!/usr/bin/env bash
# DRISHTI v1 — Full Pipeline
# Usage: bash scripts/run-all.sh [--output <dir>]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Pass through --output flag if provided
OUTPUT_ARGS=""
OUTPUT_DIR=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --output)
      OUTPUT_DIR="$2"
      OUTPUT_ARGS="--output $2"
      shift 2
      ;;
    *) shift ;;
  esac
done

# Determine output paths
RAW_FILE="${OUTPUT_DIR:-$PROJECT_ROOT/data}/raw_results.txt"
CLEAN_FILE="${OUTPUT_DIR:-$PROJECT_ROOT/data}/cleaned_results.txt"
LOG_FILE="${OUTPUT_DIR:-$PROJECT_ROOT/data}/logs.txt"

echo "══════════════════════════════════════"
echo "  DRISHTI v1 — FULL PIPELINE"
if [ -n "$OUTPUT_DIR" ]; then
  echo "  Output: $OUTPUT_DIR"
  mkdir -p "$OUTPUT_DIR"
fi
echo "══════════════════════════════════════"
echo ""

# Clear previous results
> "$RAW_FILE" 2>/dev/null || true
> "$LOG_FILE" 2>/dev/null || true
echo "[INFO] Cleared previous results and logs"
echo ""

# Run Bing
echo "── PHASE 1: BING ──────────────────────"
node "$PROJECT_ROOT/main.js" --engine bing $OUTPUT_ARGS
echo ""

# Run DuckDuckGo
echo "── PHASE 2: DUCKDUCKGO ────────────────"
node "$PROJECT_ROOT/main.js" --engine duckduckgo $OUTPUT_ARGS
echo ""

# Clean and resolve
echo "── PHASE 3: CLEAN & RESOLVE ───────────"
node "$PROJECT_ROOT/parser/cleaner.js" $OUTPUT_ARGS

echo ""
echo "══════════════════════════════════════"
echo "  PIPELINE COMPLETE"
echo "  Raw:     $RAW_FILE"
echo "  Cleaned: $CLEAN_FILE"
echo "══════════════════════════════════════"
