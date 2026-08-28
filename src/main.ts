import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  TFile,
} from 'obsidian';
import type { DataAdapter, SettingDefinitionItem, TAbstractFile } from 'obsidian';
import { lineStat } from './core/diff';
import { isExcluded, isTextFile } from './core/exclude';
import type { ExcludeOptions } from './core/exclude';
import { EventFeed } from './core/feed';
import type { FileIO } from './core/fileio';
import { appendEvents, readLog, rotateIfNeeded } from './core/logStore';
import type { ChangeEvent } from './core/types';
import { decideLock, ownsLock, parseLock } from './core/writerLock';
import type { WriterLock } from './core/writerLock';
import { DEFAULT_SETTINGS, parseExtensions, parseGlobs } from './settings';
import type { ActivityAtlasSettings } from './settings';
import { VIEW_TYPE_ACTIVITY_ATLAS, ActivityAtlasTimelineView } from './ui/timelineView';
import type { TimelineDataSource } from './ui/timelineView';

const LOG_FILE = 'activity.jsonl';
const LOCK_FILE = 'writer.lock';
const LIVE_OPERATIONS = new Set(['create', 'modify', 'delete', 'rename']);
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
  settings: ActivityAtlasSettings;
  lastSeq: number;
  deviceId?: string;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  let count = 1;
  for (let index = 0; index < content.length; index++) {
    if (content[index] === '\n') count += 1;
  }
  return count;
}

function contentBytes(content: string | null | undefined): number {
  return content === null || content === undefined ? 0 : content.length * 2;
}

export default class ActivityAtlasPlugin extends Plugin implements TimelineDataSource {
  settings: ActivityAtlasSettings = { ...DEFAULT_SETTINGS };
  private io!: FileIO;
  private feed: EventFeed | null = null;
  private snapshots = new Map<string, string | null>();
  private snapshotContentBytes = 0;
  private lastSeq = 0;
  private deviceId = '';
  private events: ChangeEvent[] = [];
  private subscribers = new Set<() => void>();

  async onload(): Promise<void> {
    const data = (await this.loadData()) as Partial<PersistedData> | null;
    const savedSettings: Partial<ActivityAtlasSettings> = data?.settings ?? {};
    this.settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof ActivityAtlasSettings>) {
      const value = savedSettings[key];
      if (value !== undefined) {
        (this.settings as unknown as Record<string, unknown>)[key] = value;
      }
    }
    this.lastSeq = typeof data?.lastSeq === 'number' ? data.lastSeq : 0;
    this.deviceId = typeof data?.deviceId === 'string' ? data.deviceId : '';
    if (!this.deviceId) {
      this.deviceId = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    const dataDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    this.io = new AdapterFileIO(this.app.vault.adapter, dataDir);
    await this.io.mkdirp();
    if (await this.io.exists('baseline.gz')) await this.io.remove('baseline.gz');
    const existingLog = await readLog(this.io, LOG_FILE);
    this.events = existingLog.events.filter(event =>
      event.source === 'live' && LIVE_OPERATIONS.has(event.op),
    );
    if (this.events.length !== existingLog.events.length) {
      await this.io.write(
        LOG_FILE,
        this.events.map(event => JSON.stringify(event)).join('\n') + (this.events.length ? '\n' : ''),
      );
    }
    this.lastSeq = Math.max(this.lastSeq, existingLog.maxSeq ?? 0);
    await this.persist();

    this.registerView(VIEW_TYPE_ACTIVITY_ATLAS, leaf => new ActivityAtlasTimelineView(leaf, this));
    this.addRibbonIcon('activity', 'Open Activity Atlas', () => void this.activateView());
    this.addCommand({ id: 'open-timeline', name: 'Open activity timeline', callback: () => void this.activateView() });
    this.addCommand({ id: 'refresh-timeline', name: 'Refresh activity', callback: () => this.notify() });
    this.addSettingTab(new ActivityAtlasSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => void this.startFeed());
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_ACTIVITY_ATLAS)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_ACTIVITY_ATLAS, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async loadEvents(): Promise<ChangeEvent[]> {
    return [...this.events];
  }

  burstWindowMs(): number {
    return Math.max(0, this.settings.burstWindowMinutes) * 60_000;
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
      new Notice('Activity Atlas is in read-only standby because another instance is recording this vault.');
      this.registerInterval(window.setInterval(() => void this.tryTakeover(), LOCK_HEARTBEAT_MS));
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
    this.snapshots.clear();
    this.snapshotContentBytes = 0;

    this.registerEvent(this.app.vault.on('create', file => void this.onCreate(file)));
    this.registerEvent(this.app.vault.on('modify', file => void this.onModify(file)));
    this.registerEvent(this.app.vault.on('delete', file => this.onDelete(file)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => void this.onRename(file, oldPath)));
    this.registerInterval(window.setInterval(() => void this.flushEvents(), EVENT_FLUSH_MS));
    this.registerInterval(window.setInterval(() => void this.rotate(), ROTATE_MS));
    this.registerInterval(window.setInterval(() => void this.writeLock(), LOCK_HEARTBEAT_MS));
    this.notify();
  }

  private emit(op: ChangeEvent['op'], path: string, options: Parameters<EventFeed['push']>[2] = {}): ChangeEvent | null {
    if (!this.feed) return null;
    const event = this.feed.push(op, path, options);
    this.events.push(event);
    this.lastSeq = Math.max(this.lastSeq, event.seq);
    this.notify();
    return event;
  }

  private replaceSnapshot(path: string, content: string | null): void {
    this.snapshotContentBytes -= contentBytes(this.snapshots.get(path));
    const budgetBytes = this.settings.comparisonContentBudgetKb * 1024;
    const retained = content !== null
      && this.snapshotContentBytes + contentBytes(content) <= budgetBytes
      ? content
      : null;
    this.snapshots.set(path, retained);
    this.snapshotContentBytes += contentBytes(retained);
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


  private async onCreate(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || this.isExcludedPath(file.path)) return;
    try {
      if (this.shouldTrackText(file)) {
        const content = await this.app.vault.cachedRead(file);
        this.replaceSnapshot(file.path, content);
        this.emit('create', file.path, { stat: { added: countLines(content), removed: 0 } });
      } else {
        this.replaceSnapshot(file.path, null);
        this.emit('create', file.path, { stat: null });
      }
    } catch {
      // Ignore unreadable files; a later live event can capture them.
    }
  }

  private async onModify(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || this.isExcludedPath(file.path)) return;
    try {
      if (this.shouldTrackText(file)) {
        const content = await this.app.vault.cachedRead(file);
        const previous = this.snapshots.get(file.path);
        const stat = previous !== null && previous !== undefined
          ? lineStat(previous, content)
          : null;
        this.replaceSnapshot(file.path, content);
        this.emit('modify', file.path, { stat });
      } else {
        this.replaceSnapshot(file.path, null);
        this.emit('modify', file.path, { stat: null });
      }
    } catch {
      // Ignore unreadable files; a later live event can capture them.
    }
  }

  private onDelete(file: TAbstractFile): void {
    if (!(file instanceof TFile) || this.isExcludedPath(file.path)) return;
    const previous = this.snapshots.get(file.path);
    const stat = previous !== null && previous !== undefined
      ? { added: 0, removed: countLines(previous) }
      : null;
    this.snapshotContentBytes -= contentBytes(previous);
    this.snapshots.delete(file.path);
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
    const hadEntry = this.snapshots.has(oldPath);
    const entry = this.snapshots.get(oldPath);
    if (hadEntry) {
      this.snapshots.delete(oldPath);
      if (newExcluded) this.snapshotContentBytes -= contentBytes(entry);
      else this.snapshots.set(file.path, entry ?? null);
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
      new Notice('Activity Atlas could not persist activity and will retry.');
      console.error('Activity Atlas event flush failed', error);
    }
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
      console.error('Activity Atlas log rotation failed', error);
    }
  }


  private async persist(): Promise<void> {
    const data: PersistedData = {
      settings: this.settings,
      lastSeq: this.lastSeq,
      deviceId: this.deviceId,
    };
    await this.saveData(data);
  }

  async saveSettings(): Promise<void> {
    await this.persist();
    this.notify();
  }

  onunload(): void {
    void (async () => {
      if (!this.feed) return;
      await this.flushEvents();
      try {
        const existing = await this.readLock();
        if (ownsLock(existing, this.deviceId)) await this.io.remove(LOCK_FILE);
      } catch {
        // A stale lock expires automatically and another instance can recover.
      }
    })();
  }
}

type ActivityAtlasSettingKey = keyof ActivityAtlasSettings;

class ActivityAtlasSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ActivityAtlasPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem<ActivityAtlasSettingKey>[] {
    return [{
      type: 'group',
      heading: 'Activity Atlas',
      items: [
        {
          name: 'Local activity',
          desc: 'Activity stays local to this vault and is recorded only while Obsidian is open.',
          searchable: false,
        },
        {
          name: 'Burst window',
          desc: 'Minutes of inactivity that separate one activity burst from the next.',
          control: {
            type: 'number',
            key: 'burstWindowMinutes',
            min: 1,
            max: 30,
            step: 1,
          },
        },
        {
          name: 'Tracked text extensions',
          desc: 'Comma-separated extensions that receive line-diff statistics. Other files are still tracked.',
          control: {
            type: 'textarea',
            key: 'trackedExtensions',
            rows: 3,
          },
        },
        {
          name: 'Exclude paths',
          desc: 'One glob per line. Activity Atlas always excludes its own configuration directory.',
          control: {
            type: 'textarea',
            key: 'excludeGlobs',
            rows: 4,
          },
        },
        {
          name: 'Large text file threshold',
          desc: 'Files above this size in KB are tracked without line statistics.',
          control: {
            type: 'number',
            key: 'largeFileKb',
            min: 1,
            step: 1,
          },
        },
        {
          name: 'Live comparison budget',
          desc: 'Maximum KB of text kept in memory for line statistics during the current session.',
          control: {
            type: 'number',
            key: 'comparisonContentBudgetKb',
            min: 1,
            step: 1,
          },
        },
        {
          name: 'Retention',
          desc: 'Days of activity retained locally.',
          control: {
            type: 'number',
            key: 'retentionDays',
            min: 7,
            max: 365,
            step: 1,
          },
        },
      ],
    }];
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as ActivityAtlasSettingKey];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (!(key in DEFAULT_SETTINGS)) return;
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
  }
}
