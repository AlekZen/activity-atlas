import { GitFileState, GitFileStatus } from './types';

export interface ParsedGitStatus {
  head: string | null;
  branch: string | null;
  files: Record<string, GitFileStatus>;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function stateFromXY(index: string, worktree: string): GitFileState {
  if (index === 'R' || worktree === 'R') return 'renamed';
  if (index === 'D' || worktree === 'D') return 'deleted';
  if (index !== '.' && worktree !== '.') return 'staged-modified';
  if (index !== '.') return 'staged';
  if (worktree !== '.') return 'modified';
  return 'clean';
}

function addRecord(files: Record<string, GitFileStatus>, status: GitFileStatus): void {
  files[status.path] = status;
}

/** Parses the stable, NUL-delimited porcelain v2 status format. */
export function parsePorcelainV2(output: string): ParsedGitStatus {
  const files: Record<string, GitFileStatus> = {};
  let head: string | null = null;
  let branch: string | null = null;
  const chunks = output.split('\0');

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const records = chunk.split('\n').filter(Boolean);
    for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      const record = records[recordIndex];
      if (record.startsWith('# branch.oid ')) {
        const value = record.slice('# branch.oid '.length).trim();
        head = value === '(initial)' ? null : value;
        continue;
      }
      if (record.startsWith('# branch.head ')) {
        const value = record.slice('# branch.head '.length).trim();
        branch = value === '(detached)' ? null : value;
        continue;
      }
      if (record.startsWith('? ')) {
        const path = normalizePath(record.slice(2));
        addRecord(files, { path, state: 'untracked', index: '?', worktree: '?' });
        continue;
      }
      if (record.startsWith('! ')) {
        const path = normalizePath(record.slice(2));
        addRecord(files, { path, state: 'ignored', index: '!', worktree: '!' });
        continue;
      }
      if (record.startsWith('1 ')) {
        const fields = record.split(' ');
        if (fields.length < 9) continue;
        const xy = fields[1];
        const path = normalizePath(fields.slice(8).join(' '));
        addRecord(files, {
          path,
          state: stateFromXY(xy[0] ?? '.', xy[1] ?? '.'),
          index: xy[0] ?? '.',
          worktree: xy[1] ?? '.',
        });
        continue;
      }
      if (record.startsWith('2 ')) {
        const fields = record.split(' ');
        if (fields.length < 10) continue;
        const xy = fields[1];
        const path = normalizePath(fields.slice(9).join(' '));
        const oldPath = normalizePath(chunks[index + 1] ?? '');
        if (oldPath) index += 1;
        addRecord(files, {
          path,
          ...(oldPath ? { oldPath } : {}),
          state: 'renamed',
          index: xy[0] ?? '.',
          worktree: xy[1] ?? '.',
        });
      }
    }
  }

  return { head, branch, files };
}
