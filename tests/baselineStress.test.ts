import { strToU8 } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Baseline,
  BaselineEntry,
  entryContentBytes,
  makeBinaryEntry,
  makeTextEntryBudgeted,
  parseBaseline,
  serializeBaseline,
} from '../src/core/baseline';
import { binaryHash, hashContent } from '../src/core/hash';

const PROFILE = process.env.VAULT_PULSE_PROFILE === '1';
const ENTRY_COUNT = 6_000;
/** 刻意设小于全量内容总量的预算，逼出真实的 content/hash-only 混合分布 */
const BUDGET_BYTES = 800 * 1024;
const CONFIGURED_BUDGET_BYTES = 20 * 1024 * 1024;
const PROFILE_ENTRY_COUNT = 5_000;
const PROFILE_CONTENT_CHARS = Math.floor(CONFIGURED_BUDGET_BYTES / 2 / PROFILE_ENTRY_COUNT);
const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789 你好世界';

function makeContent(index: number): string {
  const len = 50 + (index % 250);
  let s = '';
  for (let i = 0; i < len; i++) s += CHARS[(index + i) % CHARS.length];
  return s;
}

interface BinaryMeta {
  size: number;
  mtime: number;
}

interface Fixture {
  baseline: Baseline;
  /** 记录构建时的期望值，用于逐条核对而不依赖内部实现细节 */
  expectedContent: Map<string, string>;
  textPathsOverBudget: Set<string>;
  binaryMeta: Map<string, BinaryMeta>;
}

function buildFixture(count: number, budgetBytes: number): Fixture {
  const baseline: Baseline = new Map();
  const expectedContent = new Map<string, string>();
  const textPathsOverBudget = new Set<string>();
  const binaryMeta = new Map<string, BinaryMeta>();
  let usedBytes = 0;

  for (let i = 0; i < count; i++) {
    if (i % 3 === 2) {
      const path = `stress/attachments/img-${i}.png`;
      const meta = { size: 1000 + i, mtime: 1_785_000_000_000 + i };
      baseline.set(path, makeBinaryEntry(meta.size, meta.mtime));
      binaryMeta.set(path, meta);
      continue;
    }
    const path = `stress/notes/folder-${i % 40}/file-${i}.md`;
    const content = makeContent(i);
    const entry = makeTextEntryBudgeted(content, usedBytes, budgetBytes);
    usedBytes += entryContentBytes(entry);
    baseline.set(path, entry);
    expectedContent.set(path, content);
    if (entry.content === null) textPathsOverBudget.add(path);
  }

  return { baseline, expectedContent, textPathsOverBudget, binaryMeta };
}

interface ProfileRow {
  entries: number;
  withContent: number;
  hashOnly: number;
  uncompressedBytes: number;
  compressedBytes: number;
  serializeMs: number;
  parseMs: number;
  heapDeltaMb: number;
}

const profileRows: ProfileRow[] = [];

describe('baseline persistence at scale', () => {
  it(`round-trips ${ENTRY_COUNT.toLocaleString('en-US')} entries with a content/hash-only mix`, () => {
    const { baseline, expectedContent, textPathsOverBudget, binaryMeta } = buildFixture(
      ENTRY_COUNT,
      BUDGET_BYTES,
    );
    expect(baseline.size).toBe(ENTRY_COUNT);

    // 契约要求 content 与 hash-only 条目并存
    let withContent = 0;
    let hashOnly = 0;
    for (const entry of baseline.values()) {
      if (entry.content === null) hashOnly++;
      else withContent++;
    }
    expect(withContent).toBeGreaterThan(0);
    expect(hashOnly).toBeGreaterThan(0);
    expect(withContent + hashOnly).toBe(ENTRY_COUNT);
    // 预算刻意收紧，验证确实发生了预算溢出（否则本用例无法覆盖 hash-only 路径）
    expect(textPathsOverBudget.size).toBeGreaterThan(0);
    expect(binaryMeta.size).toBeGreaterThan(0);

    const heapBefore = process.memoryUsage().heapUsed;
    const uncompressedBytes = strToU8(
      JSON.stringify(Object.fromEntries(baseline)),
    ).length;

    const serializeStarted = performance.now();
    const compressed = serializeBaseline(baseline);
    const serializeMs = Number((performance.now() - serializeStarted).toFixed(3));

    expect(compressed.length).toBeGreaterThan(0);
    // gzip 应对高重复度的重复路径/内容前缀产生实质压缩
    expect(compressed.length).toBeLessThan(uncompressedBytes);

    const parseStarted = performance.now();
    const restored = parseBaseline(compressed);
    const parseMs = Number((performance.now() - parseStarted).toFixed(3));
    const heapDeltaMb = Number(((process.memoryUsage().heapUsed - heapBefore) / 1_048_576).toFixed(2));

    // 精确 round-trip：不仅条目数一致，Map 的键值内容也必须逐一相等
    expect(restored.size).toBe(baseline.size);
    expect(restored).toEqual(baseline);

    // 逐条核对有内容条目：全文与哈希均须保留精确
    for (const [path, content] of expectedContent) {
      if (textPathsOverBudget.has(path)) continue;
      const entry = restored.get(path) as BaselineEntry;
      expect(entry.content).toBe(content);
      expect(entry.hash).toBe(hashContent(content));
    }

    // 逐条核对预算溢出条目：content 应为 null，但 hash 仍等于全文版哈希（变更检测精度不丢失）
    for (const path of textPathsOverBudget) {
      const entry = restored.get(path) as BaselineEntry;
      expect(entry.content).toBeNull();
      expect(entry.hash).toBe(hashContent(expectedContent.get(path) as string));
    }

    // 逐条核对二进制条目：content 恒为 null，hash 由 size+mtime 推导
    for (const [path, meta] of binaryMeta) {
      const entry = restored.get(path) as BaselineEntry;
      expect(entry.content).toBeNull();
      expect(entry.hash).toBe(binaryHash(meta.size, meta.mtime));
    }

    profileRows.push({
      entries: ENTRY_COUNT,
      withContent,
      hashOnly,
      uncompressedBytes,
      compressedBytes: compressed.length,
      serializeMs,
      parseMs,
      heapDeltaMb,
    });
  }, 20_000);


  it.skipIf(!PROFILE)('profiles a baseline near the configured 20 MiB content budget', () => {
    const baseline: Baseline = new Map();
    let usedBytes = 0;
    for (let index = 0; index < PROFILE_ENTRY_COUNT; index++) {
      const prefix = `${index}:`;
      const content = (prefix + 'activity-atlas-baseline-content|'.repeat(100))
        .slice(0, PROFILE_CONTENT_CHARS);
      const entry = makeTextEntryBudgeted(content, usedBytes, CONFIGURED_BUDGET_BYTES);
      usedBytes += entryContentBytes(entry);
      baseline.set(`stress/profile/file-${index}.md`, entry);
    }

    expect(usedBytes).toBeGreaterThan(19 * 1024 * 1024);
    expect([...baseline.values()].every(entry => entry.content !== null)).toBe(true);
    const heapBefore = process.memoryUsage().heapUsed;
    const uncompressedBytes = strToU8(JSON.stringify(Object.fromEntries(baseline))).length;
    const serializeStarted = performance.now();
    const compressed = serializeBaseline(baseline);
    const serializeMs = Number((performance.now() - serializeStarted).toFixed(3));
    const parseStarted = performance.now();
    const restored = parseBaseline(compressed);
    const parseMs = Number((performance.now() - parseStarted).toFixed(3));
    const heapDeltaMb = Number(((process.memoryUsage().heapUsed - heapBefore) / 1_048_576).toFixed(2));

    expect(restored.size).toBe(PROFILE_ENTRY_COUNT);
    expect(restored.get('stress/profile/file-0.md')).toEqual(baseline.get('stress/profile/file-0.md'));
    expect(restored.get(`stress/profile/file-${PROFILE_ENTRY_COUNT - 1}.md`))
      .toEqual(baseline.get(`stress/profile/file-${PROFILE_ENTRY_COUNT - 1}.md`));
    profileRows.push({
      entries: PROFILE_ENTRY_COUNT,
      withContent: PROFILE_ENTRY_COUNT,
      hashOnly: 0,
      uncompressedBytes,
      compressedBytes: compressed.length,
      serializeMs,
      parseMs,
      heapDeltaMb,
    });
  }, 30_000);
  afterAll(() => {
    if (PROFILE) console.table(profileRows);
  });
});
