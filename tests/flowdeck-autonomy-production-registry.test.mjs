import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionRegistry } from '../dist/flowdeck-autonomy-production-registry.js';
import { autonomyPolicyDigest } from '../dist/flowdeck-autonomy-policy.js';

const policy = { schema: 'flowdeck.autonomy-policy/v1', projectId: 'project-0001', campaignId: 'campaign-0001',
  ownerId: 'owner-0001', deviceId: 'device-0001', enabledTaskIds: ['task-p1', 'task-p2'] };
const context = { schema: 'flowdeck.autonomous-input/v1', projectId: policy.projectId,
  campaignRunId: 'campaign-run-0001', policy, policyDigest: autonomyPolicyDigest(policy),
  workflowId: 'workflow-0001', runId: 'temporal-run-0001' };
const names = ['validateAndClaim', 'awaitP1Events', 'continueP1', 'reconcileContinuation',
  'awaitP1Completion', 'submitP2', 'reconcileP2', 'awaitP2Completion', 'closeout'];
function make(overrides = {}, assertExecution = c => {
  if (c.workflowId !== context.workflowId || c.runId !== context.runId) throw Error('identity/cancellation guard');
}) {
  const received = [];
  const remaining = Object.fromEntries(names.map(name => [name, async c => {
    received.push([name, c]); return { status: name === 'validateAndClaim' ? 'valid' : 'pending' };
  }]));
  Object.assign(remaining, overrides);
  const scopes = { claimExact: async () => {}, readExact: async () => null, persistExact: async () => {} };
  const registry = createProductionRegistry({
    initial: { root: '/tmp/unused', scopes, authorize: async () => { throw Error('unexpected authorize'); },
      browserFactory: () => { throw Error('unexpected browser'); },
      executionContext: () => ({ workflowExecution: { workflowId: context.workflowId, runId: context.runId },
        cancellationSignal: new AbortController().signal }) },
    remaining,
    assertExecution,
  });
  return { registry, received };
}

test('registry exposes every required method and guards/forwards the same execution context', async () => {
  const { registry, received } = make();
  for (const method of ['submitInitialP1', 'reconcileInitialP1', ...names]) assert.equal(typeof registry[method], 'function');
  for (const name of names) assert.deepEqual(await registry[name](context), { status: name === 'validateAndClaim' ? 'valid' : 'pending' });
  assert.deepEqual(received.map(x => x[0]), names);
  assert.ok(received.every(x => x[1] === context));
  // Existing initialActivities API is reused; missing exact scope is a blocked reconciliation.
  assert.deepEqual(await registry.reconcileInitialP1(context), { status: 'blocked', reason: 'initial_scope_unavailable' });
});

test('missing production methods fail at composition time', () => {
  assert.throws(() => make({ closeout: undefined }), /missing production activity: closeout/);
});

test('workflow/run identity and cancellation guard runs before an activity port', async () => {
  let calls = 0;
  const { registry } = make({ validateAndClaim: async () => { calls++; return { valid: true }; } });
  // Replace no guard at runtime: mismatch is rejected by the required guard before dispatch.
  await assert.rejects(registry.validateAndClaim({ ...context, runId: 'different-run-0001' }), /identity\/cancellation guard/);
 assert.equal(calls, 0);
});

test('cancellation guard runs before all production activity ports', async () => {
 let calls = 0, cancelled = true;
 const { registry } = make({ validateAndClaim: async () => { calls++; return { valid: true }; } }, () => {
  if (cancelled) throw Error('activity cancelled');
 });
 await assert.rejects(registry.validateAndClaim(context), /activity cancelled/);
 assert.equal(calls, 0);
 cancelled = false;
 assert.deepEqual(await registry.validateAndClaim(context), { valid: true });
 assert.equal(calls, 1);
});
