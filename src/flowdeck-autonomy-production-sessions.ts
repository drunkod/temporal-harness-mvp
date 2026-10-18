import type { AutonomousExecutionContext } from './flowdeck-autonomous-workflow.js';
import type { WorkEventV1 } from './flowdeck-work-events.js';

export type ProductionSessionStage = 'initial_p1' | 'continue_p1' | 'initial_p2';
export type SessionVerdict = { status: 'pending' | 'blocked' | 'reported' | 'implementation_done'; reason?: string };

/** Independent read-only report from the upstream work-session ledger. */
export interface SourceWorkReport {
  workId: string; ownerId: string; deviceId: string;
  state: 'running' | 'reported'; outcome: 'partial' | 'success' | 'failed' | null;
  startedAt: string; reportedAt: string | null;
}
/** Durable record that joins a source work ID to an actual submitted dispatch. */
export interface ProductionSessionBinding {
  workflowId: string; runId: string; campaignRunId: string; projectId: string;
  campaignId: string; taskId: string; stage: ProductionSessionStage;
  dispatchId: string; workId: string; ownerId: string; deviceId: string;
  tabId: string; chatUrl: string; dispatchReconciled: true;
}
export interface ProductionResponseObservation {
  workId: string; taskId: string; ownerId: string; deviceId: string;
  tabId: string; chatUrl: string; userTurns: number;
  turn: 'running' | 'finished' | 'unknown';
  decision: 'continue' | 'implementation_done' | 'needs_attention' | 'unknown';
  strictCompletionMarker: boolean;
}
export interface ProductionSessionPorts {
  /** Must query the authoritative source independently of the Flowdeck inbox. */
  readSourceReport(context: AutonomousExecutionContext, stage: ProductionSessionStage): Promise<SourceWorkReport | null>;
  /** Must read exact durable dispatch/session bindings, not expected manifest values. */
  readBinding(context: AutonomousExecutionContext, stage: ProductionSessionStage): Promise<ProductionSessionBinding | null>;
  /** Reads the scoped Flowdeck inbox, including actual delivery acknowledgements. */
  readInboxEvents(context: AutonomousExecutionContext, stage: ProductionSessionStage): Promise<ReadonlyArray<{ event: WorkEventV1; delivery: string }> | null>;
  /** Read-only browser observation from the exact bound chat and tab. */
  observeResponse(context: AutonomousExecutionContext, stage: ProductionSessionStage, binding: ProductionSessionBinding): Promise<ProductionResponseObservation | null>;
}

const expectedTask = (c: AutonomousExecutionContext, stage: ProductionSessionStage) =>
  stage === 'initial_p2' ? c.policy.enabledTaskIds[1] : c.policy.enabledTaskIds[0];
function chatBelongsToProject(projectUrl: string, chatUrl: string): boolean {
  try {
    const project = new URL(projectUrl), chat = new URL(chatUrl);
    const projectParts = project.pathname.split('/').filter(Boolean);
    const chatParts = chat.pathname.split('/').filter(Boolean);
    return project.origin === chat.origin && projectParts.at(-1) === 'project' &&
      chatParts.length === projectParts.length + 1 &&
      projectParts.slice(0, -1).every((part, i) => chatParts[i] === part) &&
      chatParts.at(-2) === 'c' && Boolean(chatParts.at(-1));
  } catch { return false; }
}
const failed = (reason: string): SessionVerdict => ({ status: 'blocked', reason });
const pending: SessionVerdict = { status: 'pending' };

function validEvent(e: WorkEventV1, c: AutonomousExecutionContext): boolean {
  return e?.schema === 'remote-mcp.work-event/v1' && e.source === 'remote-mcp-jazz' &&
    e.ownerId === c.policy.ownerId && e.deviceId === c.policy.deviceId &&
    Boolean(e.eventId?.trim() && e.workId?.trim()) &&
    ['work_started', 'work_reported'].includes(e.kind) &&
    ['event', 'snapshot'].includes(e.origin) && e.executionVerified === false &&
    e.backgroundProcesses === 'unknown' && e.timestampEvidence === 'recorded_in_source_transaction' &&
    Number.isFinite(Date.parse(e.startedAt)) && Number.isFinite(Date.parse(e.sourceCommittedAt)) &&
    (e.kind === 'work_started'
      ? e.revision === 1 && e.completionEvidence === 'none' && e.outcome === undefined && e.reportedAt === undefined
      : e.revision === 2 && e.completionEvidence === 'agent_report_only' &&
        ['partial', 'success', 'failed'].includes(e.outcome ?? '') &&
        typeof e.reportedAt === 'string' && Number.isFinite(Date.parse(e.reportedAt)));
}

/**
 * Production session verdicts are a four-way join: upstream report, delivered
 * source events, durable dispatch binding, and a fresh browser observation.
 * The source reader is intentionally a required independent integration seam.
 */
export function createProductionSessionChecks(ports: ProductionSessionPorts) {
  for (const method of ['readSourceReport', 'readBinding', 'readInboxEvents', 'observeResponse'] as const)
    if (!ports || typeof ports[method] !== 'function') throw new Error(`missing production session port: ${method}`);
  async function check(c: AutonomousExecutionContext, stage: ProductionSessionStage): Promise<SessionVerdict> {
    const [source, binding, inbox] = await Promise.all([
      ports.readSourceReport(c, stage), ports.readBinding(c, stage), ports.readInboxEvents(c, stage),
    ]);
    if (inbox === null || binding === null) return pending;
    if (binding.workflowId !== c.workflowId || binding.runId !== c.runId ||
        binding.campaignRunId !== c.campaignRunId || binding.projectId !== c.projectId ||
        binding.campaignId !== c.policy.campaignId || binding.taskId !== expectedTask(c, stage) ||
        binding.stage !== stage || binding.ownerId !== c.policy.ownerId || binding.deviceId !== c.policy.deviceId ||
        !binding.workId || !binding.dispatchId || !binding.tabId ||
        !chatBelongsToProject(c.policy.projectUrl, binding.chatUrl) || binding.dispatchReconciled !== true)
      return failed('session_binding_scope_conflict');

    const unique = new Map<string, { event: WorkEventV1; delivery: string }>();
    for (const x of inbox) {
      if (!validEvent(x.event, c)) return failed('source_event_scope_or_schema_conflict');
      if (x.event.workId === binding.workId && x.delivery !== 'delivered') {
        if (x.delivery === 'pending') return pending;
        return failed('source_event_not_delivered');
      }
      const key = JSON.stringify([x.event.source, x.event.ownerId, x.event.deviceId, x.event.eventId]);
      const prior = unique.get(key);
      if (prior && JSON.stringify(prior.event) !== JSON.stringify(x.event))
        return failed('conflicting_duplicate_source_event');
      if (!prior) unique.set(key, x);
    }
    const relevant = [...unique.values()].filter(x => x.event.workId === binding.workId);
    const starts = relevant.filter(x => x.event.kind === 'work_started');
    const reports = relevant.filter(x => x.event.kind === 'work_reported');
    if (starts.length > 1 || reports.length > 1) return failed('duplicate_source_event_conflict');
    if (reports.length && !starts.length) return pending; // Reports may arrive before their start event.
    if (!starts.length || !reports.length || source === null) return pending;
    const start = starts[0].event, report = reports[0].event;
    if (start.ownerId !== binding.ownerId || start.deviceId !== binding.deviceId ||
        report.ownerId !== binding.ownerId || report.deviceId !== binding.deviceId ||
        start.workId !== report.workId || report.startedAt !== start.startedAt ||
        report.revision !== 2 || report.kind !== 'work_reported') return failed('source_event_pair_conflict');
    if (source.workId !== binding.workId || source.ownerId !== binding.ownerId || source.deviceId !== binding.deviceId)
      return failed('independent_source_report_scope_conflict');
    if (source.startedAt !== start.startedAt || source.reportedAt !== (report.reportedAt ?? null) ||
        source.outcome !== (report.outcome ?? null)) return failed('independent_source_inbox_conflict');
    if (source.state === 'running') {
      if (source.outcome !== null || source.reportedAt !== null) return failed('independent_source_report_conflict');
      return pending;
    }
    if (source.state !== 'reported' || !source.reportedAt || !source.outcome)
      return failed('independent_source_report_invalid');
    if (source.outcome === 'failed') return failed('work_session_failed');

    const observation = await ports.observeResponse(c, stage, binding);
    if (!observation) return pending;
    if (observation.workId !== binding.workId || observation.taskId !== binding.taskId ||
        observation.ownerId !== binding.ownerId || observation.deviceId !== binding.deviceId ||
        observation.tabId !== binding.tabId || observation.chatUrl !== binding.chatUrl)
      return failed('observed_response_scope_conflict');
    const targetTurns = stage === 'continue_p1' ? 2 : 1;
    if (observation.userTurns > targetTurns) return failed('unexpected_extra_user_turn');
    if (observation.turn !== 'finished' || observation.userTurns !== targetTurns || observation.decision === 'unknown') return pending;
    if (observation.decision === 'needs_attention') return failed('response_needs_attention');
    if (stage === 'initial_p1') {
      if (source.outcome !== 'partial' || observation.decision !== 'continue' || observation.strictCompletionMarker)
        return failed('initial_p1_not_strictly_partial');
      return { status: 'reported' };
    }
    if (source.outcome !== 'success' || observation.decision !== 'implementation_done' || !observation.strictCompletionMarker)
      return failed('task_not_strictly_complete');
    return { status: 'implementation_done' };
  }
  return {
    awaitP1Events: (c: AutonomousExecutionContext) => check(c, 'initial_p1'),
    awaitP1Completion: (c: AutonomousExecutionContext) => check(c, 'continue_p1'),
    awaitP2Completion: (c: AutonomousExecutionContext) => check(c, 'initial_p2'),
    check,
  };
}
