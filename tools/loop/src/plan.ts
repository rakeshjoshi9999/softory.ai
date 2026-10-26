import { taskId } from './decide.js';
import { type Issue, L } from './types.js';

export interface PlanActions {
  /** Phase n+1 issues to move from `planned` to `ready`, because `Gate n review` was closed as completed. */
  promote: { phase: number; issues: number[] }[];
  /** Phases whose tasks are all closed and which have no `Gate n review` issue yet. */
  openGates: { phase: number; tasks: { number: number; title: string }[] }[];
  /** Open issues whose PR already merged (the `Closes #n` did not close them). */
  close: { issue: number; pr: number }[];
}

const GATE = /^Gate (\d+) review$/i;
const phaseOf = (i: Issue) => {
  const l = i.labels.find((x) => /^phase-\d+$/.test(x));
  return l ? Number(l.slice(6)) : null;
};

/** Deterministic planner: phase gates only. No model call. */
export function plan(issues: Issue[], mergedPulls: { number: number; issue: number | null }[] = []): PlanActions {
  const openNumbers = new Set(issues.filter((i) => i.state === 'open').map((i) => i.number));
  const close = mergedPulls
    .filter((p): p is { number: number; issue: number } => p.issue !== null && openNumbers.has(p.issue))
    .map((p) => ({ issue: p.issue, pr: p.number }));
  const closing = new Set(close.map((c) => c.issue));
  issues = issues.map((i) => (closing.has(i.number) ? { ...i, state: 'closed', stateReason: 'completed' } : i));

  const gates = new Map<number, Issue>();
  for (const i of issues) {
    const m = GATE.exec(i.title.trim());
    if (m?.[1]) gates.set(Number(m[1]), i);
  }
  const tasks = issues.filter((i) => taskId(i.title) !== null);
  const phases = [...new Set(tasks.map(phaseOf).filter((p): p is number => p !== null))].sort((a, b) => a - b);

  const promote: PlanActions['promote'] = [];
  const openGates: PlanActions['openGates'] = [];
  for (const n of phases) {
    const gate = gates.get(n);
    if (gate && gate.state === 'closed' && gate.stateReason !== 'not_planned') {
      const next = tasks.filter((t) => phaseOf(t) === n + 1 && t.state === 'open' && t.labels.includes(L.planned));
      if (next.length) promote.push({ phase: n + 1, issues: next.map((t) => t.number) });
    }
    const inPhase = tasks.filter((t) => phaseOf(t) === n);
    if (!gate && inPhase.length && inPhase.every((t) => t.state === 'closed')) {
      openGates.push({ phase: n, tasks: inPhase.map((t) => ({ number: t.number, title: t.title })) });
    }
  }
  return { promote, openGates, close };
}

/** The gate criterion for phase n from the roadmap table in docs/architecture.md, if found. */
export function gateCriterion(architectureMd: string, n: number): string | null {
  const row = architectureMd.split('\n').find((l) => new RegExp(`^\\|\\s*${n}\\s`).test(l));
  const cells = row?.split('|').map((c) => c.trim()).filter(Boolean);
  return cells?.at(-1) ?? null;
}

export function gateBody(phase: number, tasks: { number: number; title: string }[], criterion: string | null): string {
  return [
    `All \`phase-${phase}\` tasks are closed. Close this issue as **completed** to let the factory loop start Phase ${phase + 1}.`,
    '',
    '### Gate criterion',
    criterion ? `**${criterion}**` : '_See the build roadmap in docs/architecture.md._',
    '',
    '### Before closing',
    `- [ ] Run the phase's demo script yourself and check it passes`,
    '- [ ] Skim the merged PRs below for anything that should block the next phase',
    '',
    '### Tasks in this phase',
    ...tasks.sort((a, b) => a.number - b.number).map((t) => `- #${t.number} ${t.title}`),
  ].join('\n');
}
