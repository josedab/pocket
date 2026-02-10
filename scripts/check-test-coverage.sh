#!/usr/bin/env bash
# Checks that packages using --passWithNoTests actually have test files.
# Exits with code 1 if any package has no tests, printing the list.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
missing=()

for pkg_dir in "$REPO_ROOT"/packages/*/; do
  pkg_name=$(basename "$pkg_dir")

  # Check if this package uses --passWithNoTests
  if grep -q "passWithNoTests" "$pkg_dir/package.json" 2>/dev/null; then
    # Look for test files
    test_count=$(find "$pkg_dir/src" -type f \( -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.spec.ts" -o -name "*.spec.tsx" \) 2>/dev/null | wc -l | tr -d ' ')
    if [ "$test_count" -eq 0 ]; then
      missing+=("$pkg_name")
    fi
  fi
done

if [ ${#missing[@]} -eq 0 ]; then
  echo "✅ All packages with --passWithNoTests have at least one test file."
  exit 0
else
  echo "⚠️  The following packages use --passWithNoTests but have no test files:"
  echo ""
  for pkg in "${missing[@]}"; do
    echo "  - $pkg"
  done
  echo ""
  echo "Either add tests or remove --passWithNoTests from these packages."
  echo "Found ${#missing[@]} package(s) without tests."
  # Exit with warning (non-zero) so CI can surface this
  exit 1
fi
