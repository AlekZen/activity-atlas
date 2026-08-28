import { execFile } from 'node:child_process';
import { GitCommitInfo } from '../core/types';
import { parsePorcelainV2 } from './parser';
import { GitSnapshot } from './types';

const TIMEOUT_MS = 3000;
const MAX_BUFFER_BYTES = 5 * 1024 * 1024;
const READ_ONLY_COMMANDS = new Set(['status', 'rev-parse', 'log', 'diff-tree']);

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

export class GitStatusService {
  constructor(private readonly cwd: string) {}

  private run(args: string[]): Promise<string> {
    if (!args[0] || !READ_ONLY_COMMANDS.has(args[0])) {
      return Promise.reject(new Error('Activity Atlas refused a non-read-only Git command.'));
    }
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        ['--no-optional-locks', ...args],
        {
          cwd: this.cwd,
          encoding: 'utf8',
          env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
          timeout: TIMEOUT_MS,
          maxBuffer: MAX_BUFFER_BYTES,
          windowsHide: true,
        },
        (error, stdout) => {
          if (error) reject(new Error(error.message));
          else resolve(stdout);
        },
      );
    });
  }

  private async readLatestCommit(head: string | null): Promise<GitCommitInfo | null> {
    if (!head) return null;
    const [metadata, changedPaths] = await Promise.all([
      this.run(['log', '-1', '--format=%H%x00%h%x00%ct%x00%an%x00%s', head]),
      this.run(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', head]),
    ]);
    const [oid, shortOid, unixSeconds, author, subject] = metadata.trim().split('\0');
    if (!oid || !shortOid) return null;
    return {
      oid,
      shortOid,
      subject: subject ?? '',
      author: author ?? '',
      ts: Number(unixSeconds) * 1000,
      paths: changedPaths.split('\0').filter(Boolean).map(normalizePath),
    };
  }

  async refresh(): Promise<GitSnapshot> {
    try {
      const statusOutput = await this.run([
        'status',
        '--porcelain=v2',
        '-z',
        '--branch',
        '--untracked-files=all',
        '--ignored=matching',
      ]);
      const parsed = parsePorcelainV2(statusOutput);
      let head = parsed.head;
      if (!head) {
        try {
          head = (await this.run(['rev-parse', 'HEAD'])).trim() || null;
        } catch {
          head = null;
        }
      }
      let latestCommit: GitCommitInfo | null = null;
      try {
        latestCommit = await this.readLatestCommit(head);
      } catch {
        latestCommit = null;
      }
      return {
        available: true,
        head,
        branch: parsed.branch,
        files: parsed.files,
        latestCommit,
      };
    } catch (error) {
      return {
        available: false,
        head: null,
        branch: null,
        files: {},
        latestCommit: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
