import {
  App,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from 'obsidian';
import type { DataAdapter, TAbstractFile } from 'obsidian';
import { countLines, entryContentBytes, makeBinaryEntry, makeTextEntryBudgeted, parseBaseline, serializeBaseline } from './core/baseline';
import type { Baseline, BaselineEntry } from './core/baseline';
import { lineStat } from './core/diff';
import { isExcluded, isTextFile } from './core/exclude';
import type { ExcludeOptions } from './core/exclude';
import { EventFeed } from './core/feed';
import type { FileIO } from './core/fileio';
import { appendEvents, readLog, rotateIfNeeded } from './core/logStore';
import { reconcile } from './core/reconcile';
import type { FileSnapshot } from './core/reconcile';
import type { ChangeEvent } from './core/types';
import { decideLock, ownsLock, parseLock } from './core/writerLock';
import type { WriterLock } from './core/writerLock';
import type { GitSnapshot } from './git/types';
import type { GitStatusService } from './git/service';
import { DEFAULT_SETTINGS, parseExtensions, parseGlobs } from './settings';
import type { VaultPulseSettings } from './settings';
import { VIEW_TYPE_VAULT_PULSE, VaultPulseTimelineView } from './ui/timelineView';
import type { TimelineDataSource } from './ui/timelineView';

const LOG_FILE = 'activity.jsonl';
const BASELINE_FILE = 'baseline.gz';
const LOCK_FILE = 'writer.lock';
const EVENT_FLUSH_MS = 2000;
const ROTATE_MS = 3600_000;
const LOCK_HEARTBEAT_MS = 30_000;

class AdapterFileIO implements FileIO {
  constructor(private readonly adapter: DataAdapter, private readonly baseDir: string) {}

  private absolute(path: string): string {
    return `${this.baseDir}/${path}`;
  }

  async exists(path: string): Promise<boolean> {
    return this.adapter.exists(this.absolute(path));
  }

  async read(path: string): Promise<string> {
    return this.adapter.read(this.absolute(path));
  }

  async readBinary(path: string): Promise<Uint8Array> {
    return new Uint8Array(await this.adapter.readBinary(this.absolute(path)));
  }

  async write(path: string, data: string): Promise<void> {
    await this.adapter.write(this.absolute(path), data);
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    await this.adapter.writeBinary(this.absolute(path), buffer);
  }

  async append(path: string, data: string): Promise<void> {
    await this.adapter.append(this.absolute(path), data);
  }

  async rename(from: string, to: string): Promise<void> {
    await this.adapter.rename(this.absolute(from), this.absolute(to));
  }

  async remove(path: string): Promise<void> {
    await this.adapter.remove(this.absolute(path));
  }

  async mkdirp(): Promise<void> {
    if (!(await this.adapter.exists(this.baseDir))) await this.adapter.mkdir(this.baseDir);
  }
}

interface PersistedData {
  settings: VaultPulseSettings;
  lastSeq: number;
  lastHead?: string;
  deviceId?: string;
}

export default class VaultPulsePlugin extends Plugin implements TimelineDataSource {
  settings: VaultPulseSettings = { ...DEFAULT_SETTINGS };
  private io!: FileIO;
  private feed: EventFeed | null = null;
  private baseline: Baseline = new Map();
  private baselineDirty = false;
  private baselineContentBytes = 0;
  private lastSeq = 0;
  private lastHead?: string;
  private deviceId = '';
  private events: ChangeEvent[] = [];
  private subscribers = new Set<() => void>();
  private gitService: GitStatusService | null = null;
  private gitSnapshot: GitSnapshot | null = null;
  private gitRefreshTimer: number | null = null;
  private gitRefreshGeneration = 0;

  async onload(): Promise<void> {
    const data = (await this.loadData()) as Partial<PersistedData> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
    this.lastSeq = typeof data?.lastSeq === 'number' ? data.lastSeq : 0;
    this.lastHead = typeof data?.lastHead === 'string' ? data.lastHead : undefined;
    this.deviceId = typeof data?.deviceId === 'string' ? data.deviceId : '';
    if (!this.deviceId) {
      this.deviceId = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    const dataDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    this.io = new AdapterFileIO(this.app.vault.adapter, dataDir);
    await this.io.mkdirp();
    const existingLog = await readLog(this.io, LOG_FILE);
    this.events = existingLog.events;
    this.lastSeq = Math.max(this.lastSeq, existingLog.maxSeq ?? 0);
    await this.persist();

    this.registerView(VIEW_TYPE_VAULT_PULSE, leaf => new VaultPulseTimelineView(leaf, this));
    this.addRibbonIcon('activity', 'Open Vault Pulse', () => void this.activateView());
    this.addCommand({ id: 'open-timeline', name: 'Open activity timeline', callback: () => void this.activateView() });
    this.addCommand({ id: 'refresh-timeline', name: 'Refresh activity and Git status', callback: () => void this.refreshGit(true) });
    this.addSettingTab(new VaultPulseSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => void this.startFeed());
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_VAULT_PULSE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_VAULT_PULSE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async loadEvents(): Promise<ChangeEvent[]> {
    return [...this.events];
  }

  burstWindowMs(): number {
    return Math.max(0, this.settings.burstWindowMinutes) * 60_000;
  }

  async loadGitSnapshot(): Promise<GitSnapshot | null> {
    if (this.settings.gitEnabled && !this.gitService) await this.initializeGitOverlay();
    return this.gitSnapshot;
  }

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private notify(): void {
    for (const callback of this.subscribers) callback();
  }

  private excludeOptions(): ExcludeOptions {
    return {
      configDir: this.app.vault.configDir,
      trackedExtensions: parseExtensions(this.settings.trackedExtensions),
      extraGlobs: parseGlobs(this.settings.excludeGlobs),
    };
  }

  private async readLock(): Promise<WriterLock | null> {
    try {
      if (!(await this.io.exists(LOCK_FILE))) return null;
      return parseLock(await this.io.read(LOCK_FILE));
    } catch {
      return null;
    }
  }

  private async writeLock(): Promise<void> {
    try {
      await this.io.write(LOCK_FILE, JSON.stringify({ deviceId: this.deviceId, ts: Date.now() }));
    } catch {
      // The next heartbeat retries without interrupting activity tracking.
    }
  }

  private async startFeed(): Promise<void> {
    const existing = await this.readLock();
    if (decideLock(existing, this.deviceId, Date.now()) === 'standby') {
      new Notice('Vault Pulse is in read-only standby because another instance is recording this vault.');
      this.registerInterval(window.setInterval(() => void this.tryTakeover(), LOCK_HEARTBEAT_MS));
      await this.initializeGitOverlay();
      return;
    }
    await this.writeLock();
    await this.initializeFeed();
  }

  private async tryTakeover(): Promise<void> {
    if (this.feed) return;
    const existing = await this.readLock();
    if (decideLock(existing, this.deviceId, Date.now()) !== 'take') return;
    await this.writeLock();
    await this.initializeFeed();
  }

  private async initializeFeed(): Promise<void> {
    if (this.feed) return;
    const log = await readLog(this.io, LOG_FILE);
    this.events = log.events;
    this.lastSeq = Math.max(this.lastSeq, log.maxSeq ?? 0);
    this.feed = new EventFeed(this.lastSeq);

    let oldBaseline: Baseline | null = null;
    if (await this.io.exists(BASELINE_FILE)) {
      try {
        oldBaseline = parseBaseline(await this.io.readBinary(BASELINE_FILE));
      } catch {
        new Notice('Vault Pulse rebuilt a damaged activity baseline.');
      }
    }

    const snapshots = await this.scanVault(oldBaseline);
    if (oldBaseline === null) {
      this.baseline = new Map(snapshots.map(snapshot => [snapshot.path, { hash: snapshot.hash, content: snapshot.content }]));
      this.emit('resync', '', { source: 'system', stat: null });
    } else {
      const result = reconcile(oldBaseline, snapshots, this.feed.peekNextSeq(), Date.now());
      this.baseline = result.baseline;
      for (const event of result.events) {
        this.feed.pushLoaded(event);
        this.events.push(event);
      }
    }
    this.baselineContentBytes = 0;
    for (const entry of this.baseline.values()) this.baselineContentBytes += entryContentBytes(entry);
    this.baselineDirty = true;
    await this.flushEvents();
    await this.saveBaseline();
    await this.rotate();

    this.registerEvent(this.app.vault.on('create', file => void this.onCreate(file)));
    this.registerEvent(this.app.vault.on('modify', file => void this.onModify(file)));
    this.registerEvent(this.app.vault.on('delete', file => this.onDelete(file)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => void this.onRename(file, oldPath)));
    this.registerInterval(window.setInterval(() => void this.flushEvents(), EVENT_FLUSH_MS));
    this.registerInterval(window.setInterval(() => void this.flushState(), this.settings.flushIntervalSec * 1000));
    this.registerInterval(window.setInterval(() => void this.rotate(), ROTATE_MS));
    this.registerInterval(window.setInterval(() => void this.writeLock(), LOCK_HEARTBEAT_MS));
    await this.initializeGitOverlay();
    this.notify();
  }

  private emit(op: ChangeEvent['op'], path: string, options: Parameters<EventFeed['push']>[2] = {}): ChangeEvent | null {
    if (!this.feed) return null;
    const event = this.feed.push(op, path, options);
    this.events.push(event);
    this.lastSeq = Math.max(this.lastSeq, event.seq);
    this.notify();
    this.scheduleGitRefresh();
    return event;
  }

  private async scanVault(previousBaseline: Baseline | null): Promise<FileSnapshot[]> {
    const options = this.excludeOptions();
    const maxFileBytes = this.settings.largeFileKb * 1024;
    const budgetBytes = this.settings.baselineContentBudgetKb * 1024;
    let usedBytes = 0;
    const snapshots: FileSnapshot[] = [];
    for (const file of this.app.vault.getFiles()) {
      if (isExcluded(file.path, options)) continue;
      if (isTextFile(file.path, options.trackedExtensions) && file.stat.size <= maxFileBytes) {
        try {
          const content = await this.app.vault.cachedRead(file);
          const entry = makeTextEntryBudgeted(content, usedBytes, budgetBytes);
          snapshots.push({ path: file.path, hash: entry.hash, content: entry.content, mtime: file.stat.mtime });
          usedBytes += entryContentBytes(entry);
        } catch {
          const previous = previousBaseline?.get(file.path);
          const entry = previous ?? makeBinaryEntry(file.stat.size, file.stat.mtime);
          snapshots.push({ path: file.path, hash: entry.hash, content: entry.content, mtime: file.stat.mtime });
          usedBytes += entryContentBytes(entry);
        }
      } else {
        const entry = makeBinaryEntry(file.stat.size, file.stat.mtime);
        snapshots.push({ path: file.path, hash: entry.hash, content: null, mtime: file.stat.mtime });
      }
    }
    return snapshots;
  }

  private shouldTrackText(file: TFile): boolean {
    const options = this.excludeOptions();
    return !isExcluded(file.path, options)
      && isTextFile(file.path, options.trackedExtensions)
      && file.stat.size <= this.settings.largeFileKb * 1024;
  }

  private isExcludedPath(path: string): boolean {
    return isExcluded(path, this.excludeOptions());
  }

  private replaceBaseline(path: string, entry: BaselineEntry): void {
    const previous = this.baseline.get(path);
    if (previous) this.baselineContentBytes -= entryContentBytes(previous);
    this.baseline.set(path, entry);
    this.baselineContentBytes += entryContentBytes(entry);
    this.baselineDirty = true;
  }

  private async onCreate(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || this.isExcludedPath(file.path)) return;
    try {
      if (this.shouldTrackText(file)) {
        const content = await this.app.vault.cachedRead(file);
        const entry = makeTextEntryBudgeted(content, this.baselineContentBytes, this.settings.baselineContentBudgetKb * 1024);
        this.replaceBaseline(file.path, entry);
        this.emit('create', file.path, { stat: { added: countLines(content), removed: 0 } });
      } else {
        this.replaceBaseline(file.path, makeBinaryEntry(file.stat.size, file.stat.mtime));
        this.emit('create', file.path, { stat: null });
      }
    } catch {
      // Reconciliation recovers unreadable placeholders later.
    }
  }

  private async onModify(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || this.isExcludedPath(file.path)) return;
    try {
      if (this.shouldTrackText(file)) {
        const content = await this.app.vault.cachedRead(file);
        const previous = this.baseline.get(file.path);
        const stat = previous?.content !== null && previous?.content !== undefined
          ? lineStat(previous.content, content)
          : null;
        const entry = makeTextEntryBudgeted(content, this.baselineContentBytes, this.settings.baselineContentBudgetKb * 1024);
        this.replaceBaseline(file.path, entry);
        this.emit('modify', file.path, { stat });
      } else {
        this.replaceBaseline(file.path, makeBinaryEntry(file.stat.size, file.stat.mtime));
        this.emit('modify', file.path, { stat: null });
      }
    } catch {
      // Reconciliation recovers unreadable placeholders later.
    }
  }

  private onDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile) || this.isExcludedPath(file.path)) return;
    const previous = this.baseline.get(file.path);
    const stat = previous?.content !== null && previous?.content !== undefined
      ? { added: 0, removed: countLines(previous.content) }
      : null;
    if (previous) this.baselineContentBytes -= entryContentBytes(previous);
    this.baseline.delete(file.path);
    this.baselineDirty = true;
    this.emit('delete', file.path, { stat });
  }

  private async onRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (!(file instanceof TFile)) return;
    const oldExcluded = this.isExcludedPath(oldPath);
    const newExcluded = this.isExcludedPath(file.path);
    if (oldExcluded && newExcluded) return;
    if (oldExcluded) {
      await this.onCreate(file);
      return;
    }
    const entry = this.baseline.get(oldPath);
    if (entry) {
      this.baseline.delete(oldPath);
      if (newExcluded) this.baselineContentBytes -= entryContentBytes(entry);
      else this.baseline.set(file.path, entry);
      this.baselineDirty = true;
    }
    if (newExcluded) this.emit('delete', oldPath, { stat: null });
    else this.emit('rename', file.path, { oldPath, stat: { added: 0, removed: 0 } });
  }

  private async flushEvents(): Promise<void> {
    if (!this.feed || this.feed.pending === 0) return;
    const pending = this.feed.drain();
    try {
      await appendEvents(this.io, LOG_FILE, pending);
      await this.persist();
    } catch (error) {
      for (const event of pending) this.feed.pushLoaded(event);
      new Notice('Vault Pulse could not persist activity and will retry.');
      console.error('Vault Pulse event flush failed', error);
    }
  }

  private async saveBaseline(): Promise<void> {
    if (!this.baselineDirty) return;
    await this.io.writeBinary(BASELINE_FILE, serializeBaseline(this.baseline));
    this.baselineDirty = false;
  }

  private async flushState(): Promise<void> {
    await this.flushEvents();
    await this.saveBaseline();
  }

  private async rotate(): Promise<void> {
    try {
      await this.flushEvents();
      if (this.feed?.pending) return;
      const rotated = await rotateIfNeeded(
        this.io,
        LOG_FILE,
        this.settings.retentionMaxEntries,
        this.settings.retentionDays,
        Date.now(),
      );
      if (rotated) {
        const log = await readLog(this.io, LOG_FILE);
        this.events = log.events;
        this.notify();
      }
    } catch (error) {
      console.error('Vault Pulse log rotation failed', error);
    }
  }

  private async initializeGitOverlay(): Promise<void> {
    if (this.gitService) return;
    if (!this.settings.gitEnabled || !Platform.isDesktopApp) return;
    const adapter = this.app.vault.adapter as DataAdapter & { getBasePath?: () => string };
    if (typeof adapter.getBasePath !== 'function') return;
    try {
      const module = await import('./git/service');
      this.gitService = new module.GitStatusService(adapter.getBasePath());
      await this.refreshGit(false);
      this.registerInterval(window.setInterval(() => void this.refreshGit(true), this.settings.gitRefreshSec * 1000));
    } catch (error) {
      console.warn('Vault Pulse Git overlay is unavailable', error);
    }
  }

  private scheduleGitRefresh(): void {
    if (!this.gitService) return;
    if (this.gitRefreshTimer !== null) window.clearTimeout(this.gitRefreshTimer);
    this.gitRefreshTimer = window.setTimeout(() => {
      this.gitRefreshTimer = null;
      void this.refreshGit(true);
    }, 350);
  }

  private async refreshGit(recordCommit: boolean): Promise<void> {
    if (!this.settings.gitEnabled) {
      this.gitSnapshot = null;
      this.notify();
      return;
    }
    if (!this.gitService) {
      await this.initializeGitOverlay();
      if (!this.gitService) return;
    }
    const generation = ++this.gitRefreshGeneration;
    const snapshot = await this.gitService.refresh();
    if (generation !== this.gitRefreshGeneration) return;
    this.gitSnapshot = snapshot;
    if (snapshot.available && snapshot.head) {
      if (recordCommit && this.lastHead && snapshot.head !== this.lastHead && snapshot.latestCommit) {
        this.emit('commit', '', {
          source: 'git',
          ts: snapshot.latestCommit.ts,
          stat: null,
          commit: snapshot.latestCommit,
        });
      }
      if (this.lastHead !== snapshot.head) {
        this.lastHead = snapshot.head;
        await this.persist();
      }
    }
    this.notify();
  }

  private async persist(): Promise<void> {
    const data: PersistedData = {
      settings: this.settings,
      lastSeq: this.lastSeq,
      lastHead: this.lastHead,
      deviceId: this.deviceId,
    };
    await this.saveData(data);
  }

  async saveSettings(): Promise<void> {
    await this.persist();
    this.notify();
  }

  onunload(): void {
    if (this.gitRefreshTimer !== null) window.clearTimeout(this.gitRefreshTimer);
    void (async () => {
      if (!this.feed) return;
      await this.flushState();
      try {
        const existing = await this.readLock();
        if (ownsLock(existing, this.deviceId)) await this.io.remove(LOCK_FILE);
      } catch {
        // A stale lock expires automatically and another instance can recover.
      }
    })();
  }
}

class VaultPulseSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: VaultPulsePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Vault Pulse' });
    containerEl.createEl('p', { text: 'Activity stays local to this vault. Git integration is read-only and optional.' });
    const settings = this.plugin.settings;

    new Setting(containerEl)
      .setName('Burst window')
      .setDesc('Minutes of inactivity that separate one activity burst from the next.')
      .addSlider(slider => slider
        .setLimits(1, 30, 1)
        .setValue(settings.burstWindowMinutes)
        .setDynamicTooltip()
        .onChange(async value => {
          settings.burstWindowMinutes = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Read-only Git overlay')
      .setDesc('Shows staged, uncommitted, untracked, ignored, and committed states when desktop Git is available.')
      .addToggle(toggle => toggle.setValue(settings.gitEnabled).onChange(async value => {
        settings.gitEnabled = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Git refresh interval')
      .setDesc('Seconds between read-only Git status refreshes.')
      .addSlider(slider => slider
        .setLimits(2, 30, 1)
        .setValue(settings.gitRefreshSec)
        .setDynamicTooltip()
        .onChange(async value => {
          settings.gitRefreshSec = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Tracked text extensions')
      .setDesc('Comma-separated extensions that receive line-diff statistics. Other files are still tracked.')
      .addTextArea(text => text.setValue(settings.trackedExtensions).onChange(async value => {
        settings.trackedExtensions = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Exclude paths')
      .setDesc('One glob per line. Vault Pulse always excludes its own configuration directory.')
      .addTextArea(text => text.setValue(settings.excludeGlobs).onChange(async value => {
        settings.excludeGlobs = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Large text file threshold')
      .setDesc('Files above this size in KB are tracked without line statistics.')
      .addText(text => text.setValue(String(settings.largeFileKb)).onChange(async value => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
          settings.largeFileKb = parsed;
          await this.plugin.saveSettings();
        }
      }));

    new Setting(containerEl)
      .setName('Baseline content budget')
      .setDesc('Maximum KB of text retained locally for line statistics.')
      .addText(text => text.setValue(String(settings.baselineContentBudgetKb)).onChange(async value => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
          settings.baselineContentBudgetKb = parsed;
          await this.plugin.saveSettings();
        }
      }));

    new Setting(containerEl)
      .setName('Retention')
      .setDesc('Days of activity retained locally.')
      .addSlider(slider => slider
        .setLimits(7, 365, 1)
        .setValue(settings.retentionDays)
        .setDynamicTooltip()
        .onChange(async value => {
          settings.retentionDays = value;
          await this.plugin.saveSettings();
        }));
  }
}
