import { defineQuery, proxyActivities, setHandler, sleep } from '@temporalio/workflow';
import type { MvpInput, MvpStatus, Task, Packet, Receipt, ProgressEvent } from './protocol.js';
import type * as acts from './activities.js';

const a = proxyActivities<typeof acts>({
  startToCloseTimeout: '3 minutes',
  retry: { maximumAttempts: 1 },
});
export const statusQuery = defineQuery<MvpStatus>('mvpStatus');

export async function roamingMvp(input: MvpInput): Promise<MvpStatus> {
  const status: MvpStatus = {
    stage: 'starting', processed: 0, expected: input.maxTasks, current: null,
    receipts: [], events: [], message: 'Preparing the demo environment',
  };
  const pace = Math.min(2000, Math.max(0, input.demoPacingMs ?? 650));
  const transition = async (stage: string, detail: string,
    kind: ProgressEvent['kind'] = 'running', project: string | null = status.current) => {
    status.stage = stage;
    status.message = detail;
    status.events.push({ at: new Date().toISOString(), stage, project, detail, kind });
    if (pace > 0 && kind === 'running') await sleep(pace);
  };
  // Temporal serializes query values itself; structuredClone is not available in its VM.
  setHandler(statusQuery, () => status);
  await transition('starting', 'Temporal Worker accepted the workflow');
  for (let i = 0; i < input.maxTasks; i++) {
    await transition('discovering', 'Checking disposable repositories for pending tasks');
    const task: Task | null = await a.nextTask(input.root);
    if (!task) {
      await transition(status.processed ? 'completed' : 'no_tasks',
        status.processed ? 'All available demo tasks verified' : 'No pending tasks found',
        status.processed ? 'success' : 'warning');
      status.current = null;
      return status;
    }
    status.current = task.project;
    await transition('specifying', 'Creating immutable spec packet for ' + task.project);
    const packet: Packet = await a.compilePacket(input.root, task);
    await transition('jev', 'Classifying the task with OpenCode Zen Jev');
    const jev: string = await a.classifyJev(packet, input.jev);
    status.events.push({ at: new Date().toISOString(), stage: 'jev', project: task.project,
      detail: jev, kind: jev.startsWith('OpenCode Zen Jev') ? 'success' : 'warning' });
    await transition('browser', 'Recording a Repo Harness browser dry-run session');
    const browser: string = input.browserDryRun ? await a.browserDryRun(packet) : 'disabled';
    status.events.push({ at: new Date().toISOString(), stage: 'browser', project: task.project,
      detail: browser, kind: browser.startsWith('dry-run session saved:') ? 'success' : 'warning' });
    await transition('executing', 'Applying exact specification in an isolated Git worktree');
    const receipt: Receipt = await a.executeVerifyPromote(input.root, packet, jev, browser);
    status.receipts.push(receipt);
    status.processed++;
    if (receipt.verdict !== 'verified') {
      await transition('blocked', 'Independent verification blocked ' + task.project
        + (receipt.error ? ': ' + receipt.error : ''), 'error');
      return status;
    }
    await transition('verified', task.project + ' verified: Git commit ' + receipt.gitCommit.slice(0, 12), 'success');
    status.current = null;
  }
  await transition('completed', 'Two disposable projects completed with verifiable receipts', 'success');
  return status;
}
