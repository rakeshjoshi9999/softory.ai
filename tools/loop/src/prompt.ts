import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Replaces `{{name}}` placeholders. Unknown placeholders become empty strings. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(values[k] ?? ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function template(name: 'build' | 'fix' | 'review', root = '.'): string {
  return readFileSync(join(root, 'prompts', 'loop', `${name}.md`), 'utf8');
}

/** Caps text so a huge issue body or comment cannot blow up the prompt. */
export function cap(text: string, max = 12_000): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n\n[... truncated ${text.length - max} characters]`;
}

export const RESUME_NOTE =
  '## This is a resumed task\nAn earlier run was cut off. Run `git log --oneline origin/main..HEAD` and `git diff origin/main...HEAD --stat` to see what is done, then continue from there.';

export const CONFLICT_NOTE =
  '## First: resolve the merge with main\n`git merge origin/main` stopped with conflicts (see `git status`). Resolve them: `package.json`, `docs/DECISIONS.md` -> keep both sides; `pnpm-lock.yaml` -> take main\'s, then `pnpm install --no-frozen-lockfile`; `generated/` -> regenerate with the repo tooling; same logic changed on both sides -> keep the behaviour both sides need. Then `git commit --no-edit`.';

/** A previous-review section for re-reviews; empty when there is none. */
export function previousReview(comments: string[]): string {
  if (!comments.length) return '';
  return `## Earlier review on this PR\n${cap(comments.join('\n\n---\n\n'), 6_000)}`;
}
