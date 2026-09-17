#!/bin/sh
# capability-review.sh — the AGENTS.md "Auto Code Review" first step.
#
# Lists every capability touched by the working tree (or a commit range) by
# diffing docs/capabilities.md rows against the changed files, then prints
# the exact "Where" file list per capability for the reviewer to read
# end-to-end.
#
# Usage:
#   npm run capability-review                 # uncommitted changes vs HEAD
#   sh scripts/capability-review.sh HEAD~1    # a commit/range vs working tree

set -eu

BASE="${1:-HEAD}"
CAPS_FILE="docs/capabilities.md"

if [ ! -f "$CAPS_FILE" ]; then
  echo "error: $CAPS_FILE not found" >&2
  exit 1
fi

changed=$(git diff --name-only "$BASE" 2>/dev/null || git diff --name-only HEAD)
if [ -z "$changed" ]; then
  echo "No changed files vs $BASE — nothing to review."
  exit 0
fi

echo "Changed files vs $BASE:"
echo "$changed" | sed 's/^/  /'
echo

# Walk capability rows: | Name | Where | — match each backticked file/dir
# reference in the Where column against the changed list.
grep '^|' "$CAPS_FILE" | grep -v '^| :--' | grep -v '^| Capability' | while IFS='|' read -r _ name where; do
  name=$(printf '%s' "$name" | sed 's/^ *//;s/ *$//')
  where=$(printf '%s' "$where" | sed 's/^ *//;s/ *$//')
  [ -z "$name" ] && continue

  hits=""
  for path in $(printf '%s' "$where" | grep -o '`[^`]*`' | tr -d '`' | tr '|' ' '); do
    case "$path" in
      /*|-*) continue ;;            # routes like /api/... are not files
      *.*.*|*.*)
        # Looks like a file (has an extension) — exact suffix match.
        if printf '%s\n' "$changed" | grep -q "/${path}$\\|^${path}$"; then
          hits="$hits $path"
        fi
        ;;
      *)
        # Directory reference — prefix match.
        if printf '%s\n' "$changed" | grep -q "^${path}/\\|/${path}/"; then
          hits="$hits $path/"
        fi
        ;;
    esac
  done

  if [ -n "$hits" ]; then
    echo "== $name"
    printf '%s\n' "$hits" | tr ' ' '\n' | sort -u | sed 's/^/   touched: /'
    echo "   review:  $where"
    echo
  fi
done

echo "Read each listed capability's files end-to-end (correctness, security,"
echo "PromQL laws, { error, details? } shape, test coverage), fix findings in"
echo "this run, and record outcomes in the commit message (AGENTS.md rule)."
