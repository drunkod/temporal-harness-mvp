import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSendRecoveryStore, sendEventHash, sendPhaseHash, sanitizeSendCause, verifyLegacyStageFailure, LEGACY_STAGE_ORDER_ATTESTATION } from '../dist/flowdeck-send-recovery.js';

const keys = { projectId: 'pilot', taskId: 'B', eventHash: sendEventHash(['pilot', 'B', 'next', 'report-B']), phaseHash: sendPhaseHash(['pilot', 'B', 'next', 'initial']) };

test('stage failure records actual sanitized pre_send_failed cause and permits one scoped authorization', async () => {
  const base = await mkdtemp(join(tmpdir(), 'flowdeck-recovery-'));
  const store = createSendRecoveryStore(base);
  const dispatchId = 'failed-stage';
  await store.record({ ...keys, dispatchId, phase: 'claimed' });
  await store.record({ ...keys, dispatchId, phase: 'preparing' });
  const cause = sanitizeSendCause(new Error('Object.stage: token=secret-value connector picker unavailable'));
  await store.record({ ...keys, dispatchId, phase: 'pre_send_failed', cause });
  const auth = await store.authorize({ ...keys, oldDispatchId: dispatchId, attemptId: 'attempt-B', receiptPresent: false, taskBindingPresent: false });
  assert.equal(auth.oldDispatchId, dispatchId);
  assert.notEqual(auth.newDispatchId, dispatchId);
  assert.match((await store.latest(dispatchId)).cause, /redacted/);
  assert.doesNotMatch((await store.latest(dispatchId)).cause, /secret-value/);
  await store.consume(auth);
  await assert.rejects(() => store.consume(auth), /already consumed/);
  assert.ok((await readdir(store.root)).some(name => name.includes('authorization-') && name.endsWith('.json')));
});

test('a click-attempt marker seals the dispatch forever, even without a receipt', async () => {
  const base = await mkdtemp(join(tmpdir(), 'flowdeck-recovery-'));
  const store = createSendRecoveryStore(base);
  const dispatchId = 'clicked-or-crashed';
  await store.record({ ...keys, dispatchId, phase: 'claimed' });
  await store.record({ ...keys, dispatchId, phase: 'staged' });
  await store.record({ ...keys, dispatchId, phase: 'click_attempted' });
  await assert.rejects(() => store.authorize({ ...keys, oldDispatchId: dispatchId, attemptId: 'attempt-B', receiptPresent: false, taskBindingPresent: false }), /click-attempted/);
});

test('legacy claim-only dispatches refuse recovery because missing journal is not proof of no click', async () => {
  const base = await mkdtemp(join(tmpdir(), 'flowdeck-recovery-'));
  const store = createSendRecoveryStore(base);
  await assert.rejects(() => store.authorize({ ...keys, oldDispatchId: 'legacy-claim-only', attemptId: 'legacy-attempt', receiptPresent: false, taskBindingPresent: false }), /durable pre_send_failed/);
});

test('receipt or task binding blocks recovery and audit remains bounded append-only', async () => {
  const base = await mkdtemp(join(tmpdir(), 'flowdeck-recovery-'));
  const store = createSendRecoveryStore(base);
  const dispatchId = 'receipt-bound';
  await store.record({ ...keys, dispatchId, phase: 'pre_send_failed', cause: 'Object.stage: Original owned ChatGPT tab changed' });
  await assert.rejects(() => store.authorize({ ...keys, oldDispatchId: dispatchId, attemptId: 'attempt-B', receiptPresent: true, taskBindingPresent: false }), /absent sent receipt/);
  await assert.rejects(() => store.authorize({ ...keys, oldDispatchId: dispatchId, attemptId: 'attempt-B', receiptPresent: false, taskBindingPresent: true }), /absent sent receipt/);
  assert.ok((await readFile(store.audit, 'utf8')).includes('pre_send_failed'));
});

test('legacy proof accepts only exact reviewed ActivityTaskFailed history', () => {
  const input = [{ id: 'project' }, { id: 'B' }, { workId: 'A-work' }, { eventId: 'report-B', workId: 'A-work' }];
  const history = { runId: 'run-good', workflowId: 'wf-good', events: [
    { eventId: '77', eventType: 'EVENT_TYPE_ACTIVITY_TASK_SCHEDULED', activityTaskScheduledEventAttributes: { retryPolicy:{maximumAttempts:1}, activityId: 'activity-1', input: { decoded: input } } },
    { eventType: 'EVENT_TYPE_ACTIVITY_TASK_FAILED', activityTaskFailedEventAttributes: { scheduledEventId: '77', failure: { message: 'Original owned ChatGPT tab changed', stackTrace: 'Object.stage -> send' } } },
  ] };
  const proof = verifyLegacyStageFailure(history, input, '77', LEGACY_STAGE_ORDER_ATTESTATION, { runId: 'run-good', workflowId: 'wf-good' });
  assert.equal(proof.verified, true);
  assert.throws(() => verifyLegacyStageFailure(history, [...input.slice(0, 3), { eventId: 'wrong' }], '77', LEGACY_STAGE_ORDER_ATTESTATION), /input/);
  assert.throws(() => verifyLegacyStageFailure({ ...history, runId: 'run-other' }, input, '77', LEGACY_STAGE_ORDER_ATTESTATION, { runId: 'run-good', workflowId: 'wf-good' }), /exact requested run/);
  assert.throws(() => verifyLegacyStageFailure({ ...history, events: [...history.events, { eventType: 'EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT', activityTaskTimedOutEventAttributes: { scheduledEventId: '77' } }] }, input, '77', LEGACY_STAGE_ORDER_ATTESTATION), /Timeout/);
  assert.throws(() => verifyLegacyStageFailure({ ...history, events: [history.events[0], { eventType: 'EVENT_TYPE_ACTIVITY_TASK_FAILED', activityTaskFailedEventAttributes: { scheduledEventId: '77', failure: { message: 'timeout', stackTrace: 'Object.stage -> send' } } }] }, input, '77', LEGACY_STAGE_ORDER_ATTESTATION), /non-timeout|Object.stage/);
});

test('successor preview accepts one consumed proven pre-click failure without writing or consuming the root slot', async () => {
  const base = await mkdtemp(join(tmpdir(), 'flowdeck-recovery-'));
  const store = createSendRecoveryStore(base);
  const root = 'root-dispatch';
  await store.record({ ...keys, dispatchId: root, phase: 'claimed', attemptId: 'root-attempt' });
  await store.record({ ...keys, dispatchId: root, phase: 'preparing' });
  await store.record({ ...keys, dispatchId: root, phase: 'pre_send_failed', attemptId: 'root-attempt' });
  const parent = await store.authorize({ ...keys, oldDispatchId: root, attemptId: 'root-attempt', receiptPresent: false, taskBindingPresent: false });
  await store.consume(parent);
  const failedChild = parent.newDispatchId;
  await store.record({ ...keys, dispatchId: failedChild, phase: 'claimed', oldDispatchId: parent.oldDispatchId, attemptId: 'child-attempt' });
  await store.record({ ...keys, dispatchId: failedChild, phase: 'preparing' });
  await store.record({ ...keys, dispatchId: failedChild, phase: 'pre_send_failed', attemptId: 'child-attempt' });
  const before = await readdir(store.root);
  const result = await store.successorPreview({ ...keys, failedParentDispatchId: failedChild, failedAttemptId: 'child-attempt' });
  assert.equal(result.eligible, true);
  assert.deepEqual(await readdir(store.root), before);
  assert.ok(before.some(name => name === `authorization-slot-${keys.phaseHash}.json`));
  assert.ok(!before.some(name => name === `successor-slot-${failedChild}.json`));
  const successor = await store.authorizeSuccessor({ ...keys, failedParentDispatchId: failedChild, failedAttemptId: 'child-attempt' });
  await store.consumeSuccessor(successor);
});

test('successor recovery rejects changed hashes, click ancestors, missing records, cycles, and duplicate forks', async () => {
  const base = await mkdtemp(join(tmpdir(), 'flowdeck-recovery-'));
  const store = createSendRecoveryStore(base);
  const root = 'root-dispatch';
  await store.record({ ...keys, dispatchId: root, phase: 'claimed', attemptId: 'root-attempt' });
  await store.record({ ...keys, dispatchId: root, phase: 'preparing' });
  await store.record({ ...keys, dispatchId: root, phase: 'pre_send_failed', attemptId: 'root-attempt' });
  const parent = await store.authorize({ ...keys, oldDispatchId: root, attemptId: 'root-attempt', receiptPresent: false, taskBindingPresent: false });
  await store.consume(parent);
  const child = parent.newDispatchId;
  await store.record({ ...keys, dispatchId: child, phase: 'claimed', oldDispatchId: root, attemptId: 'child-attempt' });
  await store.record({ ...keys, dispatchId: child, phase: 'preparing' });
  await store.record({ ...keys, dispatchId: child, phase: 'pre_send_failed', attemptId: 'child-attempt' });
  const input = { ...keys, failedParentDispatchId: child, failedAttemptId: 'child-attempt' };
  await store.authorizeSuccessor(input);
  await assert.rejects(() => store.authorizeSuccessor(input), /already exists/);
  await assert.rejects(() => store.successorPreview({ ...input, eventHash: 'changed' }), /keys/);
  const authNames = (await readdir(store.root)).filter(name => name.startsWith('authorization-') && name.endsWith('.json') && !name.includes('slot'));
  const successor = await Promise.all(authNames.map(name => readFile(join(store.root, name), 'utf8').then(JSON.parse))).then(values => values.find(value => value.kind === 'successor'));
  await store.record({ ...keys, dispatchId: root, phase: 'click_attempted' });
  await assert.rejects(() => store.consumeSuccessor(successor), /click/);
});

test('successor recovery fails closed on missing and cyclic ancestry records', async () => {
  const makeAuth = (id, oldDispatchId, newDispatchId) => ({ ...keys, authorizationId: id, attemptId: 'attempt', oldDispatchId, newDispatchId, issuedAt: new Date().toISOString() });
  const missingBase = await mkdtemp(join(tmpdir(), 'flowdeck-recovery-'));
  const missing = createSendRecoveryStore(missingBase);
  const parent = makeAuth('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'missing-parent', 'failed-child');
  await missing.record({ ...keys, dispatchId: 'failed-child', phase: 'claimed', oldDispatchId: 'missing-parent', attemptId: 'attempt' });
  await writeFile(join(missing.root, `authorization-${parent.authorizationId}.json`), JSON.stringify(parent));
  await writeFile(join(missing.root, `authorization-${parent.authorizationId}.consumed`), '{}');
  await missing.record({ ...keys, dispatchId: 'failed-child', phase: 'preparing' });
  await missing.record({ ...keys, dispatchId: 'failed-child', phase: 'pre_send_failed', attemptId: 'attempt' });
  await assert.rejects(() => missing.successorPreview({ ...keys, failedParentDispatchId: 'failed-child', failedAttemptId: 'attempt' }), /click-attempted|records|missing/);

  const cycleBase = await mkdtemp(join(tmpdir(), 'flowdeck-recovery-'));
  const cycle = createSendRecoveryStore(cycleBase);
  const a = makeAuth('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cycle-one', 'failed-child');
  const b = makeAuth('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'failed-child', 'cycle-one');
  Object.assign(a,{kind:'successor',parentAuthorizationId:b.authorizationId});
  Object.assign(b,{kind:'successor',parentAuthorizationId:a.authorizationId});
  await cycle.record({ ...keys, dispatchId: 'failed-child', phase: 'claimed', oldDispatchId: 'cycle-one', attemptId: 'attempt' });
  for (const auth of [a, b]) {
    await writeFile(join(cycle.root, `successor-slot-${auth.oldDispatchId}.json`), JSON.stringify(auth));
    await writeFile(join(cycle.root, `authorization-${auth.authorizationId}.json`), JSON.stringify(auth));
    await writeFile(join(cycle.root, `authorization-${auth.authorizationId}.consumed`), '{}');
  }
  await cycle.record({ ...keys, dispatchId: 'failed-child', phase: 'preparing' });
  await cycle.record({ ...keys, dispatchId: 'failed-child', phase: 'pre_send_failed', attemptId: 'attempt' });
  for (const [dispatchId, oldDispatchId] of [['cycle-one', 'failed-child']]) {
    await cycle.record({ ...keys, dispatchId, phase: 'claimed', oldDispatchId });
    await cycle.record({ ...keys, dispatchId, phase: 'preparing' });
    await cycle.record({ ...keys, dispatchId, phase: 'pre_send_failed' });
  }
  await assert.rejects(() => cycle.successorPreview({ ...keys, failedParentDispatchId: 'failed-child', failedAttemptId: 'attempt' }), /cycle/);
});

test('authorization slot permits only one generation for an old dispatch and full-field consume rejects tampering', async () => {
  const base = await mkdtemp(join(tmpdir(), 'flowdeck-recovery-'));
  const store = createSendRecoveryStore(base);
  const dispatchId = 'one-slot';
  await store.record({ ...keys, dispatchId, phase: 'pre_send_failed', cause: 'Object.stage: picker unavailable' });
  const auth = await store.authorize({ ...keys, oldDispatchId: dispatchId, attemptId: 'attempt-1', receiptPresent: false, taskBindingPresent: false });
  await assert.rejects(() => store.authorize({ ...keys, oldDispatchId: dispatchId, attemptId: 'attempt-2', receiptPresent: false, taskBindingPresent: false }), /already issued/);
  await assert.rejects(() => store.consume({ ...auth, taskId: 'tampered' }), /fields mismatch/);
  await store.consume(auth);
  await assert.rejects(() => store.consume(auth), /already consumed/);
});
