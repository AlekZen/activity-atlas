export interface ActivityAtlasSettings {
  /** Comma-separated text extensions that receive line-diff statistics. */
  trackedExtensions: string;
  /** Newline-separated glob patterns excluded from activity tracking. */
  excludeGlobs: string;
  /** Text files above this size are tracked without line statistics. */
  largeFileKb: number;
  /** Maximum in-memory text retained for live line comparisons. */
  comparisonContentBudgetKb: number;
  retentionDays: number;
  retentionMaxEntries: number;
  /** Events closer than this window appear as one activity burst. */
  burstWindowMinutes: number;
}

export const DEFAULT_SETTINGS: ActivityAtlasSettings = {
  trackedExtensions: 'md, markdown, txt, canvas, json, csv, yaml, yml, toml, js, mjs, cjs, ts, py, sh, html, css, xml, base',
  excludeGlobs: '',
  largeFileKb: 512,
  comparisonContentBudgetKb: 20480,
  retentionDays: 90,
  retentionMaxEntries: 50000,
  burstWindowMinutes: 10,
};

export function parseExtensions(s: string): string[] {
  return s
    .split(',')
    .map(x => x.trim().toLowerCase().replace(/^\./, ''))
    .filter(x => x.length > 0);
}

export function parseGlobs(s: string): string[] {
  return s
    .split('\n')
    .map(x => x.trim())
    .filter(x => x.length > 0);
}
