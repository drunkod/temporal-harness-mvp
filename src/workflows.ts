import { defineQuery, proxyActivities, setHandler } from '@temporalio/workflow';
import type { MvpInput, MvpStatus, Task, Packet, Receipt } from './protocol.js';
import type * as acts from './activities.js';

const a = proxyActivities<typeof acts>({
  startToCloseTimeout: '3 minutes',
  retry: { maximumAttempts: 1 },
});
export const statusQuery = defineQuery<MvpStatus>('mvpStatus');

export async function roamingMvp(input: MvpInput): Promise<MvpStatus> {
  const status: MvpStatus = { stage: 'starting', processed: 0, current: null, receipts: [] };
  setHandler(statusQuery, () => structuredClone(status));
  for (let i = 0; i < input.maxTasks; i++) {
    status.stage = 'discovering';
    const task: Task | null = await a.nextTask(input.root);
    if (!task) break;
    status.current = task.project + '/' + task.taskId;
    status.stage = 'specifying';
    const packet: Packet = await a.compilePacket(input.root, task);
    status.stage = 'jev-advisory';
    const jev: string = await a.classifyJev(packet, input.jev);
    status.stage = 'browser-dry-run';
    const browser: string = input.browserDryRun ? await a.browserDryRun(packet) : 'disabled';
    status.stage = 'executing-and-verifying';
    const receipt: Receipt = await a.executeVerifyPromote(input.root, packet, jev, browser);
    status.receipts.push(receipt);
    status.processed++;
    if (receipt.verdict !== 'verified') {
      status.stage = 'blocked';
      return status;
    }
  }
  status.stage = 'completed';
  status.current = null;
  return status;
}
