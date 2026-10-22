# Documentation — runs on every merged PR and weekly

1. Read the merged PR (or, on the weekly run, all PRs merged in the last 7 days).
2. Update, only where they no longer match the code:
   - `docs/architecture.md` (sections for materials, emitters, recipes, CLI),
   - `README.md` quick start and commands,
   - `PROGRESS.md` Done / Next up,
   - generated reference docs from specs (OpenAPI → API reference).
3. Open a docs-only PR on `claude/docs-<date>`. Never change code. If code and docs disagree
   and you cannot tell which is right, open an issue labelled `needs-human` instead.
