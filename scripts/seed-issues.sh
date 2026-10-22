#!/usr/bin/env bash
# Creates labels and GitHub issues from backlog/phase-*.json.
# Usage: ./scripts/seed-issues.sh [backlog/phase-1.json ...]   (default: all phases)
# Requires: gh (authenticated) and jq. Safe to re-run: issues whose [ID] already exists are skipped.
# Only the current phase (CURRENT_PHASE, default 1) gets `ready`; later phases get `planned`
# and the planner promotes them after a human closes the previous `Gate n review` issue.
set -euo pipefail

CURRENT_PHASE="${CURRENT_PHASE:-1}"
files=("$@")
[ ${#files[@]} -eq 0 ] && files=(backlog/phase-*.json)

for label in "ready:0e8a16" "planned:c2e0c6" "in-progress:fbca04" "blocked:b60205" "needs-human:d93f0b" \
             "needs-review:0052cc" "claude-approved:1d76db" "changes-requested:e99695" "recall:b60205" \
             "phase-1:5319e7" "phase-2:5319e7" "phase-3:5319e7" "phase-4:5319e7" \
             "from-feedback:c5def5" "triage:c5def5"; do
  gh label create "${label%%:*}" --color "${label##*:}" --force >/dev/null
done

existing="$(gh issue list --state all --limit 1000 --json title --jq '.[].title')"

for file in "${files[@]}"; do
  phase="$(basename "$file" .json | sed 's/phase-//')"
  status_label="planned"; [ "$phase" = "$CURRENT_PHASE" ] && status_label="ready"
  count=$(jq length "$file")
  for i in $(seq 0 $((count - 1))); do
    id=$(jq -r ".[$i].id" "$file")
    title="[$id] $(jq -r ".[$i].title" "$file")"
    if grep -qF "[$id]" <<<"$existing"; then
      echo "skip (exists): $title"; continue
    fi
    body=$(jq -r --arg phase "$phase" ".[$i] | \"### Task ID\n\(.id)\n\n### Phase\n\(\$phase)\n\n### Goal\n\(.goal)\n\n### Acceptance criteria\n\(.acceptance | map(\"- [ ] \" + .) | join(\"\n\"))\n\n### In scope / out of scope\n\(.scope)\n\n### Blocked by\n\(if (.blockedBy | length) == 0 then \"_none_\" else (.blockedBy | join(\", \")) end)\"" "$file")
    args=(--title "$title" --body "$body" --label "$status_label" --label "phase-$phase")
    while read -r extra; do [ -n "$extra" ] && args+=(--label "$extra"); done < <(jq -r ".[$i].labels[]?" "$file")
    gh issue create "${args[@]}" >/dev/null
    echo "created: $title ($status_label)"
  done
done
