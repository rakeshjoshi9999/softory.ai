import { type Issue, type Job, type Pull, L } from './types.js';

const TASK_ID = /^\[(P(\d+)-(\d+))\]/;

/** `[P2-13] Fix ...` -> `P2-13`. */
export function taskId(title: string): string | null {
  return TASK_ID.exec(title)?.[1] ?? null;
}

/** Orders task IDs by phase, then number: P1-11 < P2-2 < P2-13. */
export function compareTaskIds(a: string, b: string): number {
  const pa = a.slice(1).split('-').map(Number);
  const pb = b.slice(1).split('-').map(Number);
  return (pa[0] ?? 0) - (pb[0] ?? 0) || (pa[1] ?? 0) - (pb[1] ?? 0);
}

/** Task IDs listed under the issue body's `### Blocked by` heading. */
export function blockedBy(body: string): string[] {
  const m = /###\s*Blocked by\s*\n([\s\S]*?)(?:\n###\s|$)/i.exec(body);
  if (!m?.[1]) return [];
  return [...m[1].matchAll(/P\d+-\d+/g)].map((x) => x[0]);
}

/** `claude/<issue>-<slug>`, the branch convention from CLAUDE.md. */
export function branchFor(issue: Issue): string {
  const slug = issue.title
    .replace(TASK_ID, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `claude/${issue.number}-${slug || 'task'}`;
}

/** Issue number a PR closes, from `Closes #n` in its body or a `claude/<n>-` branch. */
export function issueOfPull(pr: Pull): number | null {
  const m = /\b(?:closes|fixes|resolves)\s+#(\d+)/i.exec(pr.body);
  if (m?.[1]) return Number(m[1]);
  const b = /^claude\/(\d+)-/.exec(pr.headRef);
  return b?.[1] ? Number(b[1]) : null;
}

const isClaude = (pr: Pull) => pr.headRef.startsWith('claude/');

/**
 * Picks the one job this run should do, without calling a model.
 * Order: fix a reviewed or conflicted PR, resume an interrupted task, build the next ready task.
 */
export function decide(input: { issues: Issue[]; pulls: Pull[]; branches: string[]; merged?: number[] }): Job {
  const openIssues = input.issues.filter((i) => i.state === 'open');
  const claudePulls = input.pulls.filter(isClaude).sort((a, b) => a.number - b.number);

  // 1. Fix: reviewer asked for changes, or the PR conflicts with main.
  for (const pr of claudePulls) {
    const reason = pr.labels.includes(L.changes)
      ? 'changes-requested'
      : pr.labels.includes(L.conflict)
        ? 'merge-conflict'
        : null;
    if (reason) return { kind: 'fix', pr: pr.number, branch: pr.headRef, issue: issueOfPull(pr), reason };
  }

  // Open PRs and merged PRs both mean the task is taken; never build it again.
  const issuesWithPr = new Set([...input.pulls.map(issueOfPull).filter((n): n is number => n !== null), ...(input.merged ?? [])]);
  const openIds = new Set(openIssues.map((i) => taskId(i.title)).filter((t): t is string => t !== null));
  const tasks = openIssues
    .map((i) => ({ issue: i, id: taskId(i.title) }))
    .filter((t): t is { issue: Issue; id: string } => t.id !== null && !issuesWithPr.has(t.issue.number))
    .sort((a, b) => compareTaskIds(a.id, b.id));

  // 2. Resume: claimed, has a branch, no PR yet (an earlier run was cut off).
  for (const { issue, id } of tasks) {
    if (!issue.labels.includes(L.inProgress)) continue;
    const branch = input.branches.find((b) => b.startsWith(`claude/${issue.number}-`));
    if (branch) return { kind: 'resume', issue: issue.number, branch, taskId: id };
  }

  // 3. Build: lowest ready task whose blockers are all closed. A claim with no branch and no PR
  //    is stale (the run that claimed it pushed nothing), so it is built again.
  for (const { issue, id } of tasks) {
    const l = issue.labels;
    if (!l.includes(L.ready) || l.includes(L.planned) || l.includes(L.blocked)) continue;
    if (blockedBy(issue.body).some((b) => openIds.has(b))) continue;
    return { kind: 'build', issue: issue.number, branch: branchFor(issue), taskId: id };
  }

  return { kind: 'none', reason: 'no PR to fix, no interrupted task, no unblocked ready task' };
}

/** Paths whose changes always need a human to merge. */
const HUMAN_PATHS = [/^\.github\//, /^\.claude\//, /^CODEOWNERS$/, /^\.github\/CODEOWNERS$/, /^prompts\//, /^deploy\//, /(^|\/)auth\//, /^CLAUDE\.md$/];

export function needsHuman(changedFiles: string[], issueLabels: string[] = []): boolean {
  return issueLabels.includes(L.needsHuman) || changedFiles.some((f) => HUMAN_PATHS.some((re) => re.test(f)));
}
