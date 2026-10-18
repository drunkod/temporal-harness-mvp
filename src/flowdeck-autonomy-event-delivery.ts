import type { WorkEventV1 } from './flowdeck-work-events.js';

export interface EventDeliveryTarget { workflowId: string; runId: string }
export interface PendingEventInbox {
  readPending(eventId: string): Promise<WorkEventV1>;
  /** Durable inbox ACK/checkpoint. Call only after the exact signal RPC resolves. */
  markDelivered(eventId: string, target: EventDeliveryTarget): Promise<void>;
}
export interface ExactWorkflowSignal {
  signal(target: EventDeliveryTarget, signalName: 'flowdeckAutonomousWorkEventV1', event: WorkEventV1): Promise<void>;
}

/** Delivers one durable inbox event to one pinned Temporal execution. If signal
 * acknowledgement is lost, markDelivered is skipped and retry sends the same
 * eventId again for workflow-side deduplication.
 */
export function createAutonomyEventDelivery(options: {
  inbox: PendingEventInbox;
  workflow: ExactWorkflowSignal;
  target: EventDeliveryTarget;
  ownerId: string;
  deviceId: string;
}) {
  const { inbox, workflow, target, ownerId, deviceId } = options;
  if (!target.workflowId || !target.runId || !ownerId || !deviceId) throw Error('exact event delivery identity required');
  const acked = new Set<string>();
  let queue: Promise<void> = Promise.resolve();
  return (eventId: string, requestedTarget: EventDeliveryTarget): Promise<void> => {
    const result = queue.then(async () => {
      if (!eventId || requestedTarget.workflowId !== target.workflowId || requestedTarget.runId !== target.runId)
        throw Error('event delivery target mismatch');
      if (acked.has(eventId)) return;
      const event = await inbox.readPending(eventId);
      if (!event || event.schema !== 'remote-mcp.work-event/v1' || event.source !== 'remote-mcp-jazz' ||
          event.eventId !== eventId || event.ownerId !== ownerId || event.deviceId !== deviceId ||
          !event.workId || !['work_started', 'work_reported'].includes(event.kind))
        throw Error('pending inbox event identity mismatch');
      await workflow.signal(target, 'flowdeckAutonomousWorkEventV1', event);
      await inbox.markDelivered(eventId, target);
      acked.add(eventId);
    });
    queue = result.catch(() => undefined);
    return result;
  };
}
