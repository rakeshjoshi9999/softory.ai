#!/usr/bin/env bash
# Stop hook: Claude may not finish a turn on a work branch while lint, tests or build fail.
# Exit 2 = block the stop and send stderr back to Claude as the reason.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Nothing to check before the workspace exists (issue #1 creates it).
[ -f package.json ] && [ -f nx.json ] || exit 0

# Only enforce on Claude's work branches.
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
case "$branch" in
  claude/*) ;;
  *) exit 0 ;;
esac

# Nothing changed versus main: nothing to verify.
git fetch -q origin main 2>/dev/null || true
if git diff --quiet origin/main...HEAD 2>/dev/null && git diff --quiet 2>/dev/null; then
  exit 0
fi

# Guard: generated folders must not be hand-edited (emitters commit them with a marker message).
if git diff --name-only origin/main...HEAD 2>/dev/null | grep -q '/generated/'; then
  if ! git log --format=%s origin/main..HEAD | grep -q '^chore(generate):'; then
    echo "Files under generated/ changed without a 'chore(generate):' commit. Regenerate with the emitter instead of editing by hand." >&2
    exit 2
  fi
fi

log="$(mktemp)"
if ! pnpm nx affected -t lint test build --base=origin/main --parallel=3 >"$log" 2>&1; then
  echo "Definition of done not met: 'pnpm nx affected -t lint test build' failed. Last lines:" >&2
  tail -n 40 "$log" >&2
  exit 2
fi
exit 0
