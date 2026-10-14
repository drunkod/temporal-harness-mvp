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
  jev: string;
  browser: string;
}
export interface MvpInput {
  root: string;
  maxTasks: number;
  browserDryRun: boolean;
  jev: boolean;
}
export interface MvpStatus {
  stage: string;
  processed: number;
  current: string | null;
  receipts: Receipt[];
}
