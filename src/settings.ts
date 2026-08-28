export interface VaultPulseSettings {
  /** Comma-separated text extensions that receive line-diff statistics. */
  trackedExtensions: string;
  /** Newline-separated glob patterns excluded from activity tracking. */
  excludeGlobs: string;
  /** Text files above this size are tracked without line statistics. */
  largeFileKb: number;
  /** Maximum retained baseline text content across the vault. */
  baselineContentBudgetKb: number;
  retentionDays: number;
  retentionMaxEntries: number;
  /** Baseline persistence interval. */
  flushIntervalSec: number;
  /** Events closer than this window appear as one activity burst. */
  burstWindowMinutes: number;
  /** Enables the optional desktop-only, read-only Git overlay. */
  gitEnabled: boolean;
  /** Interval for refreshing Git status while Obsidian is open. */
  gitRefreshSec: number;
}

export const DEFAULT_SETTINGS: VaultPulseSettings = {
  trackedExtensions: 'md, markdown, txt, canvas, json, csv, yaml, yml, toml, js, mjs, cjs, ts, py, sh, html, css, xml, base',
  excludeGlobs: '',
  largeFileKb: 512,
  baselineContentBudgetKb: 20480,
  retentionDays: 90,
  retentionMaxEntries: 50000,
  flushIntervalSec: 300,
  burstWindowMinutes: 10,
  gitEnabled: true,
  gitRefreshSec: 5,
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
