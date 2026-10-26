/** Minimal views of GitHub objects the loop needs. */

export interface Issue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  stateReason?: string | null;
  labels: string[];
  body: string;
}

export interface Pull {
  number: number;
  title: string;
  draft: boolean;
  headRef: string;
  labels: string[];
  body: string;
  /** `false` when GitHub reports a merge conflict; `null` while it is still computing. */
  mergeable?: boolean | null;
}

export type Job =
  | { kind: 'fix'; pr: number; branch: string; issue: number | null; reason: 'changes-requested' | 'merge-conflict' }
  | { kind: 'resume'; issue: number; branch: string; taskId: string }
  | { kind: 'build'; issue: number; branch: string; taskId: string }
  | { kind: 'none'; reason: string };

/** Labels the loop reads and writes. */
export const L = {
  ready: 'ready',
  planned: 'planned',
  inProgress: 'in-progress',
  blocked: 'blocked',
  needsHuman: 'needs-human',
  needsReview: 'needs-review',
  approved: 'claude-approved',
  changes: 'changes-requested',
  conflict: 'merge-conflict',
} as const;
