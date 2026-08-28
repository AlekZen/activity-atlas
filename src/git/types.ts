import { GitCommitInfo } from '../core/types';

export type GitFileState =
  | 'clean'
  | 'modified'
  | 'staged'
  | 'staged-modified'
  | 'untracked'
  | 'ignored'
  | 'deleted'
  | 'renamed';

export interface GitFileStatus {
  path: string;
  oldPath?: string;
  state: GitFileState;
  index: string;
  worktree: string;
}

export interface GitSnapshot {
  available: boolean;
  head: string | null;
  branch: string | null;
  files: Record<string, GitFileStatus>;
  latestCommit: GitCommitInfo | null;
  error?: string;
}
