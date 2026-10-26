# Factory loop

The build loop runs in GitHub Actions. Plain code (`tools/loop`) makes every decision that does
not need a model: what to work on, claiming, branches, pushing, PRs, labels, phase gates. Claude
is started only when there is real work, with a prompt that holds just that task.

```
factory-build   (hourly :07, on push to main, on `changes-requested` / `merge-conflict` labels)
  loop plan            close issues whose PR merged; open/advance phase gates          no model
  loop mark-conflicts  label conflicted claude/ PRs `merge-conflict`                     no model
  loop decide          fix a PR > resume a task > build the next ready task > nothing   no model
  (nothing to do -> job ends, Claude never starts)
  checkout branch, merge main for fixes, pnpm install
  loop prepare         claim the issue, write a prompt from the issue body only          no model
  Claude               write code and tests, commit (Stop hook enforces nx affected)    MODEL
  verify               nx affected lint/test/build                                       no model
  loop finish          push, open/update PR, labels, result + token stats on the PR     no model

factory-review  (when a PR gets `needs-review`)
  loop review-prepare  remove `needs-review`, write diff + prompt                        no model
  Claude               read the diff, write .loop/review.json                            MODEL
  loop review-finish   post the review, set `claude-approved` or `changes-requested`    no model

factory-plan    (every 6 hours and when an issue closes)
  loop plan            same as above                                                     no model
```

## The full cycle
1. A task is `ready` and unblocked, so `factory-build` claims it and Claude builds it.
2. `finish` opens the PR with `needs-review`, which starts `factory-review`.
3. The review adds `changes-requested`, which starts `factory-build` again as a fix job, or adds
   `claude-approved`, and `auto-merge.yml` merges it when CI is green (not for `needs-human`).
4. The merge pushes to `main`, which starts `factory-build` for the next task.

## Safeguards
- **One build at a time** (`concurrency: factory-build`).
- **Interrupted runs** (usage limit, turn limit, timeout): commits are still pushed, the next run
  resumes. After 2 interruptions the task is marked `blocked` with a draft PR.
- **Review rounds:** after 3 rounds of requested changes the PR gets `blocked` + `needs-human`.
- **Failing checks** after a run: draft PR and `blocked`, with the failing lines in the PR.
- **Human paths:** changes to `.github/`, `.claude/`, `prompts/`, `deploy/`, auth or `CLAUDE.md`
  always get `needs-human`, so auto-merge skips them.

## Setup (once)
1. **Secrets** (Settings → Secrets and variables → Actions → Secrets):
   - `CLAUDE_CODE_OAUTH_TOKEN`: run `claude setup-token` locally; runs then use your Claude
     subscription.
   - `FACTORY_GH_TOKEN`: a fine-grained personal access token for this repository with
     Contents, Issues, Pull requests and Workflows set to read and write. A personal token is
     needed because pushes and labels made with the default `GITHUB_TOKEN` do not start other
     workflows, so CI and the reviewer would never run.
2. **Variables** (same page → Variables):
   - `FACTORY_LOOP_ENABLED` = `true` (the switch; set to anything else to pause the loop)
   - optional: `FACTORY_BUILD_MODEL` (default `claude-opus-5-5`), `FACTORY_FIX_MODEL` and
     `FACTORY_REVIEW_MODEL` (default `claude-sonnet-5-5`), `FACTORY_MAX_TURNS` (default 80)
3. **Pause the old scheduled tasks** (Factory builder, reviewer, planner at
   claude.ai/code/routines), so two loops never work at once.
4. Actions → factory-build → **Run workflow** to start immediately.

## Where to see what happened
- Each PR body and fix/review comment ends with the run's turns, tokens and an API-equivalent
  cost, plus a link to the workflow run.
- Actions → factory-build: one run per trigger; "Nothing to do" runs take seconds and use no
  model.
- Issues/PRs labelled `blocked` or `needs-human` need you.

## Editing the prompts
`prompts/loop/build.md`, `fix.md` and `review.md` are the only prompts the loop sends. Keep them
short: they are sent on every run. `prompts/builder.md` etc. are for the old scheduled tasks.
