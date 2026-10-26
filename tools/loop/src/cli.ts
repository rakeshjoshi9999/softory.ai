#!/usr/bin/env node
/**
 * Factory loop: the deterministic half of the build loop. It decides what to do, prepares a
 * small prompt, and handles git/PR/label bookkeeping, so Claude is only called for real work.
 *
 *   loop mark-conflicts         label conflicted claude/ PRs `merge-conflict`
 *   loop decide                 pick one job (fix | resume | build | none)
 *   loop prepare                claim the task, write .loop/prompt.md
 *   loop finish                 open/update the PR, set labels, report the run
 *   loop review-prepare <pr>    write the review prompt (removes `needs-review` first)
 *   loop review-finish <pr>     post the review from .loop/review.json, set labels
 *   loop plan                   open gate reviews and promote the next phase (no model call)
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decide, issueOfPull, needsHuman } from './decide.js';
import {
  addLabels,
  comment,
  createGh,
  getIssue,
  getPull,
  type Gh,
  listBranches,
  listIssues,
  listMergedPulls,
  listOpenPulls,
  removeLabel,
} from './github.js';
import { gateBody, gateCriterion, plan } from './plan.js';
import { CONFLICT_NOTE, RESUME_NOTE, cap, fill, previousReview, template } from './prompt.js';
import { INTERRUPTED, MAX_INTERRUPTS, formatStats, parseExecution, parseStatus, readResult, resultBody } from './result.js';
import { REVIEW_MARKER, latestChangesRequest, parseReview, renderReview, reviewLabels } from './review.js';
import { type Job, L } from './types.js';

const env = process.env;
const repo = env['GITHUB_REPOSITORY'] ?? '';
const MAX_REVIEW_ROUNDS = 3;

function gh(): Gh {
  const token = env['GH_TOKEN'] ?? env['GITHUB_TOKEN'];
  if (!token || !repo) throw new Error('GH_TOKEN and GITHUB_REPOSITORY are required');
  return createGh(token, repo);
}

function output(name: string, value: string): void {
  const file = env['GITHUB_OUTPUT'];
  if (!file) return void console.log(`${name}=${value}`);
  const delim = `EOF_${Math.random().toString(36).slice(2)}`;
  appendFileSync(file, `${name}<<${delim}\n${value}\n${delim}\n`);
}

function writeLoop(name: string, text: string): void {
  mkdirSync('.loop', { recursive: true });
  writeFileSync(`.loop/${name}`, text);
}

function readMaybe(path: string | undefined): string | null {
  return path && existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function job(): Job {
  return JSON.parse(env['JOB'] ?? '{"kind":"none","reason":"no JOB"}') as Job;
}

function model(j: Job): string {
  if (j.kind === 'fix') return env['FACTORY_FIX_MODEL'] || 'claude-sonnet-5-5';
  return env['FACTORY_BUILD_MODEL'] || 'claude-opus-5-5';
}

function runLink(): string {
  const id = env['GITHUB_RUN_ID'];
  return id ? `[run](${env['GITHUB_SERVER_URL'] ?? 'https://github.com'}/${repo}/actions/runs/${id})` : '';
}

function stats(j: Job): string {
  const s = parseExecution(readMaybe(env['EXEC_FILE']));
  return [formatStats(j.kind, model(j), s), runLink()].filter(Boolean).join(' · ');
}

async function comments(g: Gh, n: number) {
  return g.paginate<{ body: string; created_at: string }>(`/issues/${n}/comments`);
}

async function interruptions(g: Gh, n: number): Promise<number> {
  return (await comments(g, n)).filter((c) => c.body.includes(INTERRUPTED)).length;
}

function verifyTail(): string {
  const log = readMaybe('.loop/verify.log');
  if (!log) return '';
  return `\n\n<details><summary>Failing checks (last 40 lines)</summary>\n\n\`\`\`\n${log.trim().split('\n').slice(-40).join('\n')}\n\`\`\`\n</details>`;
}

// ---------------------------------------------------------------------------

async function markConflicts(): Promise<void> {
  const g = gh();
  for (const p of (await listOpenPulls(g)).filter((x) => x.headRef.startsWith('claude/'))) {
    const pr = await getPull(g, p.number); // single-PR GET computes `mergeable`
    if (pr.mergeable === false && !pr.labels.includes(L.conflict)) await addLabels(g, pr.number, [L.conflict]);
    if (pr.mergeable === true && pr.labels.includes(L.conflict)) await removeLabel(g, pr.number, L.conflict);
  }
}

async function decideCmd(): Promise<void> {
  const g = gh();
  const [issues, pulls, branches, merged] = await Promise.all([listIssues(g, 'open'), listOpenPulls(g), listBranches(g), listMergedPulls(g, issueOfPull)]);
  const j = decide({ issues, pulls, branches, merged: merged.map((m) => m.issue).filter((n): n is number => n !== null) });
  console.log(JSON.stringify(j));
  output('job', JSON.stringify(j));
  output('kind', j.kind);
  output('branch', j.kind === 'none' ? '' : j.branch);
  output('model', j.kind === 'none' ? '' : model(j));
}

async function prepare(): Promise<void> {
  const g = gh();
  const j = job();
  let prompt: string;
  if (j.kind === 'build' || j.kind === 'resume') {
    const issue = await getIssue(g, j.issue);
    if (j.kind === 'build') {
      await addLabels(g, j.issue, [L.inProgress]);
      await comment(g, j.issue, `Claimed by the factory loop on \`${j.branch}\`. ${runLink()}`);
    }
    prompt = fill(template('build'), {
      issue: j.issue,
      title: issue.title,
      branch: j.branch,
      resume: j.kind === 'resume' ? RESUME_NOTE : '',
      body: cap(issue.body),
    });
  } else if (j.kind === 'fix') {
    const pr = await getPull(g, j.pr);
    const issue = j.issue ? await getIssue(g, j.issue).catch(() => null) : null;
    const findings =
      j.reason === 'merge-conflict'
        ? 'No review findings. Only resolve the merge with `main` (see above) and make the checks pass.'
        : (latestChangesRequest(await comments(g, j.pr)) ?? 'No review comment was found. Fix the open problems the PR description lists, and make the checks pass.');
    prompt = fill(template('fix'), {
      pr: j.pr,
      title: pr.title,
      branch: j.branch,
      conflict: env['CONFLICT'] === '1' ? CONFLICT_NOTE : '',
      findings: cap(findings, 8_000),
      body: cap(issue?.body ?? pr.body, 6_000),
      issueRef: j.issue ?? j.pr,
    });
  } else {
    throw new Error(`nothing to prepare for job ${j.kind}`);
  }
  writeLoop('prompt.md', prompt);
  output('prompt', prompt);
  console.log(`prompt: ${prompt.length} characters`);
}

async function finishTask(g: Gh, j: Extract<Job, { kind: 'build' | 'resume' }>): Promise<void> {
  const result = readResult();
  let status = parseStatus(result);
  const ahead = Number(env['AHEAD'] ?? '0');
  const verifyOk = env['VERIFY'] === 'success';
  const s = stats(j);

  if (status.kind === 'missing') {
    const seen = await interruptions(g, j.issue);
    if (seen + 1 < MAX_INTERRUPTS) {
      await comment(g, j.issue, `${INTERRUPTED}\nThe run ended before finishing (usage limit, turn limit or timeout). ${ahead ? `${ahead} commit(s) are on \`${j.branch}\`; the next run resumes them.` : 'Nothing was committed; the next run starts it again.'}\n\n<sub>${s}</sub>`);
      if (!ahead) await removeLabel(g, j.issue, L.inProgress);
      return;
    }
    status = { kind: 'blocked', reason: `interrupted ${MAX_INTERRUPTS} times without finishing; the task is probably too big for one run` };
  }

  if (!ahead) {
    const reason = status.kind === 'blocked' ? status.reason : 'the run made no changes';
    await comment(g, j.issue, `The factory loop could not complete this task: ${reason}.\n\n${resultBody(result)}\n\n<sub>${s}</sub>`);
    await addLabels(g, j.issue, [L.blocked]);
    await removeLabel(g, j.issue, L.inProgress);
    return;
  }

  const issue = await getIssue(g, j.issue);
  const ok = status.kind === 'done' && verifyOk;
  const problem = status.kind === 'blocked' ? `Blocked: ${status.reason}` : !verifyOk ? 'Checks failed after the run.' : '';
  const body = [`Closes #${j.issue}`, '', resultBody(result), problem ? `\n**${problem}**${verifyTail()}` : '', '', `<sub>${s}</sub>`].join('\n');
  const owner = repo.split('/')[0];
  const existing = await g.request<{ number: number }[]>('GET', `/pulls?state=open&head=${owner}:${encodeURIComponent(j.branch)}`);
  const prNumber = existing[0]
    ? (await g.request<{ number: number }>('PATCH', `/pulls/${existing[0].number}`, { body })).number
    : (await g.request<{ number: number }>('POST', '/pulls', { title: issue.title, head: j.branch, base: 'main', body, draft: !ok })).number;

  await removeLabel(g, j.issue, L.inProgress);
  if (ok) {
    const files = git('diff', '--name-only', 'origin/main...HEAD').split('\n').filter(Boolean);
    const human = needsHuman(files, issue.labels);
    await addLabels(g, prNumber, human ? [L.needsHuman, L.needsReview] : [L.needsReview]);
  } else {
    await addLabels(g, j.issue, [L.blocked]);
    await comment(g, j.issue, `Draft PR #${prNumber} needs a human: ${problem || 'see the PR'}`);
  }
  console.log(`PR #${prNumber} ${ok ? 'ready for review' : 'opened as draft'}`);
}

async function finishFix(g: Gh, j: Extract<Job, { kind: 'fix' }>): Promise<void> {
  const result = readResult();
  let status = parseStatus(result);
  const verifyOk = env['VERIFY'] === 'success';
  const s = stats(j);

  if (status.kind === 'missing') {
    const seen = await interruptions(g, j.pr);
    if (seen + 1 < MAX_INTERRUPTS) {
      await comment(g, j.pr, `${INTERRUPTED}\nThe fix run ended before finishing; the next run retries it.\n\n<sub>${s}</sub>`);
      return;
    }
    status = { kind: 'blocked', reason: `interrupted ${MAX_INTERRUPTS} times without finishing` };
  }
  await removeLabel(g, j.pr, L.changes);
  await removeLabel(g, j.pr, L.conflict);
  if (status.kind === 'done' && verifyOk) {
    await comment(g, j.pr, `**Fixes pushed.**\n\n${resultBody(result)}\n\n<sub>${s}</sub>`);
    await addLabels(g, j.pr, [L.needsReview]);
  } else {
    const why = status.kind === 'blocked' ? status.reason : 'checks still fail after the fix';
    await comment(g, j.pr, `**The fix run could not finish: ${why}.** A human needs to look.\n\n${resultBody(result)}${verifyTail()}\n\n<sub>${s}</sub>`);
    await addLabels(g, j.pr, [L.blocked]);
  }
}

async function finish(): Promise<void> {
  const g = gh();
  const j = job();
  if (j.kind === 'fix') return finishFix(g, j);
  if (j.kind === 'build' || j.kind === 'resume') return finishTask(g, j);
}

async function reviewPrepare(prArg: string | undefined): Promise<void> {
  const g = gh();
  const n = Number(prArg);
  await removeLabel(g, n, L.needsReview);
  const pr = await getPull(g, n);
  const issueNo = /\b(?:closes|fixes|resolves)\s+#(\d+)/i.exec(pr.body)?.[1];
  const issue = issueNo ? await getIssue(g, Number(issueNo)).catch(() => null) : null;
  const earlier = (await comments(g, n)).filter((c) => c.body.includes(REVIEW_MARKER) || /^\*\*Review/.test(c.body)).map((c) => c.body.replace(REVIEW_MARKER, '').trim());
  const prompt = fill(template('review'), {
    pr: n,
    title: pr.title,
    body: cap(issue?.body ?? pr.body, 8_000),
    previous: previousReview(earlier.slice(-2)),
  });
  writeLoop('prompt.md', prompt);
  output('prompt', prompt);
}

async function reviewFinish(prArg: string | undefined): Promise<void> {
  const g = gh();
  const n = Number(prArg);
  let review;
  try {
    const text = readMaybe('.loop/review.json');
    if (!text) throw new Error('the reviewer wrote no .loop/review.json');
    review = parseReview(text);
  } catch (e) {
    await comment(g, n, `The automated review did not produce a usable result (${e instanceof Error ? e.message : String(e)}). Add the \`needs-review\` label to retry. ${runLink()}`);
    throw e;
  }
  const pr = await getPull(g, n);
  const files = (await g.paginate<{ filename: string }>(`/pulls/${n}/files`)).map((f) => f.filename);
  const issueNo = /\b(?:closes|fixes|resolves)\s+#(\d+)/i.exec(pr.body)?.[1];
  const issueLabels = issueNo ? (await getIssue(g, Number(issueNo)).catch(() => null))?.labels ?? [] : [];
  const human = needsHuman(files, issueLabels);
  const s = [formatStats('review', env['FACTORY_REVIEW_MODEL'] || 'claude-sonnet-5-5', parseExecution(readMaybe(env['EXEC_FILE']))), runLink()].filter(Boolean).join(' · ');

  const rounds = (await comments(g, n)).filter((c) => /review:\s*changes requested/i.test(c.body)).length;
  await comment(g, n, renderReview(review, { needsHuman: human, stats: s }));
  if (review.verdict === 'changes' && rounds + 1 >= MAX_REVIEW_ROUNDS) {
    await removeLabel(g, n, L.approved);
    await addLabels(g, n, [L.blocked, L.needsHuman]);
    await comment(g, n, `Stopping the fix/review loop after ${MAX_REVIEW_ROUNDS} rounds of requested changes. A human needs to decide.`);
    return;
  }
  const { add, remove } = reviewLabels(review, human);
  for (const l of remove) await removeLabel(g, n, l);
  await addLabels(g, n, add);
}

async function planCmd(): Promise<void> {
  const g = gh();
  const issues = await listIssues(g, 'all');
  const actions = plan(issues, await listMergedPulls(g, issueOfPull));
  for (const c of actions.close) {
    await comment(g, c.issue, `Closing: PR #${c.pr} implemented this and is merged.`);
    await removeLabel(g, c.issue, L.inProgress);
    await g.request('PATCH', `/issues/${c.issue}`, { state: 'closed', state_reason: 'completed' });
    console.log(`closed #${c.issue} (merged in PR #${c.pr})`);
  }
  const arch = readMaybe('docs/architecture.md') ?? '';
  for (const p of actions.promote) {
    for (const i of p.issues) {
      await removeLabel(g, i, L.planned);
      await addLabels(g, i, [L.ready]);
    }
    console.log(`phase ${p.phase}: promoted ${p.issues.length} tasks to ready`);
  }
  for (const gate of actions.openGates) {
    await g.request('POST', '/issues', {
      title: `Gate ${gate.phase} review`,
      body: gateBody(gate.phase, gate.tasks, gateCriterion(arch, gate.phase)),
      labels: [L.needsHuman],
    });
    console.log(`opened Gate ${gate.phase} review`);
  }
  if (!actions.promote.length && !actions.openGates.length && !actions.close.length) console.log('nothing to plan');
}

const commands: Record<string, (arg?: string) => Promise<void>> = {
  'mark-conflicts': markConflicts,
  decide: decideCmd,
  prepare,
  finish,
  'review-prepare': reviewPrepare,
  'review-finish': reviewFinish,
  plan: planCmd,
};

const [cmd, arg] = process.argv.slice(2);
const run = cmd ? commands[cmd] : undefined;
if (!run) {
  console.error(`usage: loop <${Object.keys(commands).join('|')}> [pr]`);
  process.exit(2);
}
run(arg).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

