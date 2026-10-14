export interface Task {
  project: string;
  repo: string;
  taskId: string;
  title: string;
  head: string;
}
export interface Packet extends Task {
  outputRel: string;
  content: string;
  contentSha256: string;
  packetSha256: string;
  packetFile: string;
}
export interface Receipt {
  taskId: string;
  project: string;
  repo: string;
  packetSha256: string;
  contentSha256: string;
  gitCommit: string;
  worktree: string;
  verdict: 'verified' | 'blocked' | 'indeterminate';
  error?: string;
  jev: string;
  browser: string;
}
export interface MvpInput {
  root: string;
  maxTasks: number;
  browserDryRun: boolean;
  jev: boolean;
  demoPacingMs?: number;
}
export interface ProgressEvent {
  at: string;
  stage: string;
  project: string | null;
  detail: string;
  kind: 'running' | 'success' | 'warning' | 'error';
}
export interface MvpStatus {
  stage: string;
  processed: number;
  expected: number;
  current: string | null;
  receipts: Receipt[];
  events: ProgressEvent[];
  message: string;
}
