import { describe, expect, it } from 'vitest';
import { parsePorcelainV2 } from '../src/git/parser';

describe('parsePorcelainV2', () => {
  it('parses branch metadata and ordinary staged states', () => {
    const output = [
      '# branch.oid abcdef123456\n# branch.head pulse-lab\n',
      '1 .M N... 100644 100644 100644 aaa bbb notes/live note.md',
      '1 M. N... 100644 100644 100644 aaa bbb staged.md',
      '1 MM N... 100644 100644 100644 aaa bbb both.md',
      '',
    ].join('\0');
    const parsed = parsePorcelainV2(output);
    expect(parsed.head).toBe('abcdef123456');
    expect(parsed.branch).toBe('pulse-lab');
    expect(parsed.files['notes/live note.md'].state).toBe('modified');
    expect(parsed.files['staged.md'].state).toBe('staged');
    expect(parsed.files['both.md'].state).toBe('staged-modified');
  });

  it('parses untracked, ignored, deleted, and renamed records', () => {
    const output = [
      '? new file.json',
      '! cache/output.bin',
      '1 .D N... 100644 100644 000000 aaa bbb removed.md',
      '2 R. N... 100644 100644 100644 aaa bbb R100 renamed.md',
      'old name.md',
      '',
    ].join('\0');
    const parsed = parsePorcelainV2(output);
    expect(parsed.files['new file.json'].state).toBe('untracked');
    expect(parsed.files['cache/output.bin'].state).toBe('ignored');
    expect(parsed.files['removed.md'].state).toBe('deleted');
    expect(parsed.files['renamed.md']).toMatchObject({ state: 'renamed', oldPath: 'old name.md' });
  });
});
