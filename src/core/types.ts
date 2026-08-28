export type ChangeOp = 'create' | 'modify' | 'delete' | 'rename' | 'resync' | 'commit';
export type EventSource = 'live' | 'reconcile' | 'system' | 'git';

export interface LineStat {
  added: number;
  removed: number;
}
export interface GitCommitInfo {
  oid: string;
  shortOid: string;
  subject: string;
  author: string;
  ts: number;
  paths: string[];
}


export interface ChangeEvent {
  seq: number;
  ts: number;
  op: ChangeOp;
  path: string;
  oldPath?: string;
  stat: LineStat | null;
  commit?: GitCommitInfo;
  source: EventSource;
}
