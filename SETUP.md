# Setting up the autonomous build

About 45 minutes once. After that, Claude builds Phase 1 on its own and you review gates.

## 1. Create the repo (5 min)
1. Create a new GitHub repo, for example `software-factory`.
2. Copy everything from this kit into it, replace `@YOUR_GITHUB_USERNAME` in
   `.github/CODEOWNERS`, then:
   ```bash
   chmod +x .claude/hooks/check-done.sh scripts/seed-issues.sh
   git add -A && git commit -m "chore: factory starter kit" && git push -u origin main
   ```
3. Seed labels and the whole backlog, Phases 1–4 (needs `gh` logged in, and `jq`):
   ```bash
   ./scripts/seed-issues.sh
   ```
   Phase 1 issues get `ready`; Phases 2–4 get `planned`. Each issue title starts with a task
   ID like `[P2-04]`, and dependencies use those IDs. The script skips IDs that already exist,
   so re-running it after you add tasks to a JSON file is safe.
   When the planner opens `Gate n review` and you close it as completed, the planner moves
   the next phase from `planned` to `ready` on its next run.

## 2. Connect Claude to the repo (5 min)
1. Install the Claude GitHub App on the repo: https://github.com/apps/claude
   (needed for GitHub-event triggers).
2. At claude.ai/code, connect GitHub and check that the repo appears.

## 3. Protect `main` (5 min)
In GitHub → Settings → Branches (or Rulesets) for `main`:
- Require a pull request, require the `ci / verify` status check, block force pushes.
- Require review from Code Owners (this makes `.github/`, `.claude/`, `prompts/`, auth and
  infra changes wait for you).
- Turn on "Allow auto-merge" in Settings → General.

## 4. Cloud environment (5 min)
At claude.ai/code/routines → New task → Advanced settings → Cloud environment, create an
environment `factory-node` with:
- Network access: **Trusted** (the default allowlist covers npm, GitHub and container registries).
- Setup script:
  ```bash
  corepack enable && corepack prepare pnpm@9 --activate
  [ -f pnpm-lock.yaml ] && pnpm install --frozen-lockfile || true
  ```

## 5. Create the scheduled tasks (15 min)
Create each at claude.ai/code/routines (or `/schedule` in the Claude Code CLI for the
schedule-only ones). Repo: `software-factory`. Environment: `factory-node`.
Remove connectors a task does not need.

| Name | Trigger | Prompt |
| --- | --- | --- |
| Factory builder | Schedule: hourly, at :07 | `Read prompts/builder.md in this repository and follow it exactly.` |
| Factory reviewer | GitHub: Pull request → **labeled**; filters: Labels includes `needs-review`, Base branch equals `main`, Is draft equals false. The builder adds `needs-review` when a PR is ready and again after fixes; the reviewer removes it first thing, so it never re-triggers itself | `Read prompts/reviewer.md in this repository and follow it exactly for the pull request that triggered this run.` |
| Factory docs | GitHub: pull_request closed, is merged true; plus Schedule weekly | `Read prompts/docs.md in this repository and follow it exactly.` |
| Factory QA | Schedule: daily 01:13 | `Read prompts/qa.md in this repository and follow it exactly.` |
| Factory planner | Schedule: daily 02:17 | `Read prompts/planner.md in this repository and follow it exactly.` |
| Factory retro | Schedule: weekly, Sunday 03:23 | `Read prompts/retro.md in this repository and follow it exactly.` |
| Factory fixer (Phase 2) | API | `Read prompts/fixer.md in this repository and follow it exactly. Investigate the failure described in the routine-fire-payload block.` |
| Factory triage (Phase 3) | Schedule: daily 00:43 | `Read prompts/triage.md in this repository and follow it exactly.` |

Because each prompt points at a file in the repo, improving a loop is just a PR to `prompts/`.

For the fixer, generate its API token and add two GitHub Actions secrets: `FIXER_URL`
(the task's fire URL) and `FIXER_TOKEN`. CI then hands every failure to it.

## 6. Auto-merge (5 min)
`.github/workflows/auto-merge.yml` turns on GitHub auto-merge for a `claude/*` PR when it has
`claude-approved` and neither `needs-human` nor `changes-requested`. GitHub then merges it
once `verify` passes. New commits remove `claude-approved`, so the reviewer must approve again.

- Requires **Settings → General → Allow auto-merge** to be on, and the `protect-main`
  ruleset requiring the `verify` check (with 0 required approvals: Claude's PRs are opened
  under your own account, and GitHub never lets you approve your own PR).
- **First week:** keep it off. Go to **Actions → auto-merge → ⋯ → Disable workflow** and
  merge PRs yourself after reading the reviewer's comments. Enable it again when the reviews
  look trustworthy.
- Optional: add a fine-grained token as secret `AUTOMERGE_TOKEN` (contents and pull
  requests: write) so that merges also start the CI run on `main`.

## 7. Start and watch
1. Open "Factory builder" and click **Run now**. It should pick issue #1.
2. Open the run session and read it end to end. A green run status only means the session
   ran; the transcript shows whether the work succeeded.
3. Check each morning: open PRs, the `needs-human` label, and the run log in PROGRESS.md.

## Usage limits: stop when usage runs out, resume after the reset
Scheduled runs draw on your Claude plan's usage like any session. When the limit is reached
and usage credits are **off**, further runs are rejected until the usage window resets, and
the schedules pick up again by themselves. With usage credits **on**, runs continue on
metered overage instead.

1. Keep usage credits off at claude.ai/settings/usage (on Team or Enterprise, ask the admin
   to keep them off at claude.ai/admin-settings/usage). This is the switch that makes the
   loops stop at your limit instead of spending more.
2. Nothing else is needed for the restart: the next hourly builder run after the reset
   starts normally.
3. A run that was cut off mid-task is safe: the builder pushes `wip(#n):` checkpoints and
   "Resume notes", and the next run resumes the `in-progress` issue before starting a new one.
4. To leave room for your own interactive use, give the loops less of the window: run the
   builder every 2 hours (`7 */2 * * *`) instead of hourly, or pause QA and docs on busy days.

## Kill switch and budget
- Pause any task with its on/off switch; pausing the builder stops all new work.
- Start with builder + reviewer only for the first two or three days, then add QA, docs and
  planner.
- Scheduled tasks are a research preview; check the docs if behaviour changes:
  https://code.claude.com/docs/en/routines
