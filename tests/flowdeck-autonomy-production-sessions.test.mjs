import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionSessionChecks } from '../dist/flowdeck-autonomy-production-sessions.js';

const ctx = {
  schema: 'flowdeck.autonomous-input/v1', projectId: 'project-0001', campaignRunId: 'campaign-run-0001',
  workflowId: 'workflow-0001', runId: 'temporal-run-0001', policyDigest: 'a'.repeat(64),
  policy: { campaignId: 'campaign-0001', ownerId: 'owner-0001', deviceId: 'device-0001',
    enabledTaskIds: ['task-p1', 'task-p2'], projectUrl: 'https://chatgpt.com/g/g-p-project-0001/project' },
};
const startedAt = '2026-10-18T10:00:00.000Z';
const reportedAt = '2026-10-18T10:01:00.000Z';
const start = { schema: 'remote-mcp.work-event/v1', source: 'remote-mcp-jazz', eventId: 'event-start',
  workId: 'work-0001', ownerId: 'owner-0001', deviceId: 'device-0001', kind: 'work_started', revision: 1,
  sourceCommittedAt: startedAt, startedAt, timestampEvidence: 'recorded_in_source_transaction',
  completionEvidence: 'none', executionVerified: false, backgroundProcesses: 'unknown', origin: 'event' };
const report = { ...start, eventId: 'event-report', kind: 'work_reported', revision: 2,
  sourceCommittedAt: reportedAt, reportedAt, completionEvidence: 'agent_report_only', outcome: 'partial' };
function evidence(overrides = {}) {
  const values = {
    source: { workId: 'work-0001', ownerId: 'owner-0001', deviceId: 'device-0001', state: 'reported',
      outcome: 'partial', startedAt, reportedAt },
    binding: { workflowId: ctx.workflowId, runId: ctx.runId, campaignRunId: ctx.campaignRunId,
      projectId: ctx.projectId, campaignId: ctx.policy.campaignId, taskId: 'task-p1', stage: 'initial_p1',
      dispatchId: 'dispatch-0001', workId: 'work-0001', ownerId: 'owner-0001', deviceId: 'device-0001',
      tabId: 'tab-0001', chatUrl: 'https://chatgpt.com/g/g-p-project-0001/c/chat-0001', dispatchReconciled: true },
    inbox: [{ event: start, delivery: 'delivered' }, { event: report, delivery: 'delivered' }],
    observation: { workId: 'work-0001', taskId: 'task-p1', ownerId: 'owner-0001', deviceId: 'device-0001',
      tabId: 'tab-0001', chatUrl: 'https://chatgpt.com/g/g-p-project-0001/c/chat-0001', userTurns: 1,
      turn: 'finished', decision: 'continue', strictCompletionMarker: false },
  };
  Object.assign(values, overrides);
  return {
    ...values,
    readSourceReport: async () => values.source,
    readBinding: async () => values.binding,
    readInboxEvents: async () => values.inbox,
    observeResponse: async () => values.observation,
  };
}

test('late source report and delayed start event remain pending until the exact join is complete', async () => {
  const p = evidence();
  let ready = false;
  const checks = createProductionSessionChecks({
    ...p, readSourceReport: async () => ready ? p.readSourceReport() : null,
    readInboxEvents: async () => ready ? p.readInboxEvents() : [{ event: report, delivery: 'delivered' }],
  });
  assert.deepEqual(await checks.awaitP1Events(ctx), { status: 'pending' });
  ready = true;
  assert.deepEqual(await checks.awaitP1Events(ctx), { status: 'reported' });
});

test('duplicate and out-of-order events are deduplicated only by the inbox; duplicate evidence conflicts', async () => {
  const repeated = createProductionSessionChecks(evidence({ inbox: [
    { event: start, delivery: 'delivered' }, { event: { ...start }, delivery: 'delivered' },
    { event: report, delivery: 'delivered' },
  ] }));
  assert.deepEqual(await repeated.awaitP1Events(ctx), { status: 'reported' });
  const duplicate = { ...report, eventId: 'event-report-2' };
  const checks = createProductionSessionChecks(evidence({ inbox: [
    { event: report, delivery: 'delivered' }, { event: duplicate, delivery: 'delivered' },
    { event: start, delivery: 'delivered' },
  ] }));
  assert.deepEqual(await checks.awaitP1Events(ctx), { status: 'blocked', reason: 'duplicate_source_event_conflict' });
  const conflict = createProductionSessionChecks(evidence({ inbox: [
    { event: start, delivery: 'delivered' }, { event: report, delivery: 'delivered' },
    { event: { ...report, outcome: 'success' }, delivery: 'delivered' },
  ] }));
  assert.deepEqual(await conflict.awaitP1Events(ctx), { status: 'blocked', reason: 'conflicting_duplicate_source_event' });
});

test('upstream running or failed report cannot be replaced by inbox success', async () => {
  const running = createProductionSessionChecks(evidence({
    source: { workId: 'work-0001', ownerId: 'owner-0001', deviceId: 'device-0001', state: 'running',
      outcome: null, startedAt, reportedAt: null },
  }));
  assert.deepEqual(await running.awaitP1Events(ctx), { status: 'blocked', reason: 'independent_source_inbox_conflict' });
  const failed = createProductionSessionChecks(evidence({
    source: { workId: 'work-0001', ownerId: 'owner-0001', deviceId: 'device-0001', state: 'reported',
      outcome: 'failed', startedAt, reportedAt },
    inbox: [{ event: start, delivery: 'delivered' },
      { event: { ...report, outcome: 'failed' }, delivery: 'delivered' }],
  }));
  assert.deepEqual(await failed.awaitP1Events(ctx), { status: 'blocked', reason: 'work_session_failed' });
});

test('wrong task, chat, or extra turn blocks; unfinished hydration remains pending', async () => {
  for (const patch of [{ taskId: 'task-p2' }, { chatUrl: 'https://chatgpt.com/g/other/c/other' }, { userTurns: 2 }]) {
    const checks = createProductionSessionChecks(evidence({ observation: { ...evidence().observation, ...patch } }));
    const result = await checks.awaitP1Events(ctx);
    assert.equal(result.status, 'blocked');
  }
  const pendingChecks = createProductionSessionChecks(evidence({ observation: { ...evidence().observation, turn: 'unknown' } }));
  assert.deepEqual(await pendingChecks.awaitP1Events(ctx), { status: 'pending' });
});

test('success requires source agreement and a strict completion marker', async () => {
  const completionContext = { ...ctx, policy: { ...ctx.policy, enabledTaskIds: ['task-p1', 'task-p2'] } };
  const p = evidence({
    source: { workId: 'work-0001', ownerId: 'owner-0001', deviceId: 'device-0001', state: 'reported',
      outcome: 'success', startedAt, reportedAt },
    binding: { ...evidence().binding, taskId: 'task-p1', stage: 'continue_p1' },
    inbox: [{ event: start, delivery: 'delivered' },
      { event: { ...report, outcome: 'success' }, delivery: 'delivered' }],
    observation: { ...evidence().observation, taskId: 'task-p1', userTurns: 2,
      decision: 'implementation_done', strictCompletionMarker: true },
  });
  const checks = createProductionSessionChecks(p);
  assert.deepEqual(await checks.awaitP1Completion(completionContext), { status: 'implementation_done' });
  p.observeResponse = async () => ({ ...p.observation, strictCompletionMarker: false });
  assert.deepEqual(await checks.awaitP1Completion(completionContext), { status: 'blocked', reason: 'task_not_strictly_complete' });
});
