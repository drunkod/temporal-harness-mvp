import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialActivities, createInitialScopeStore } from '../dist/flowdeck-autonomy-production-activities.js';
import { PROJECT } from '../dist/sashai-live-browser.js';
import { autonomyPolicyDigest, sha256 } from '../dist/flowdeck-autonomy-policy.js';
import { createAutonomyCampaignStore } from '../dist/flowdeck-autonomy-campaign.js';

const task = { id: 'initial-p1', title: 'Fixture task', instruction: 'Do the approved fixture work.' };
const task2 = { id: 'later-p2', title: 'Fixture task two', instruction: 'Do the second fixture work.' };
const planBytes = Buffer.from('approved plan');
const project = { id: 'project-test-0001', ownerId: 'owner-test-0001', deviceId: 'device-test-0001',
  repo: '/tmp/flowdeck-activities-test', projectUrl: PROJECT, initialTaskId: task.id, tasks: [task, task2] };
const policy = { schema: 'flowdeck.autonomy-policy/v1', mode: 'automatic-initial-send', interactive: false,
  environment: 'synthetic', profile: 'helium-profile-4', taskSource: 'approved-active-plan', projectId: project.id,
  projectUrl: PROJECT, ownerId: project.ownerId, deviceId: project.deviceId, worktree: project.repo,
  allowedRoot: project.repo, planSha256: sha256(planBytes), enabledTaskIds: [task.id, task2.id],
  instructionHashes: [sha256(task.instruction), sha256(task2.instruction)], campaignId: 'campaign-test-0001',
  validFrom: new Date(Date.now() - 60_000).toISOString(), validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  maxTasksPerRun: 2, maxContinuationsPerTask: 1, p2Continuations: 0, maxSubmissionsPerRun: 3,
  maxCampaignRuns: 2, maxCampaignSubmissions: 6, maxRunDurationMinutes: 60,
  automaticSuccessfulCloseout: true, uncertainSend: 'quarantine', identityConflict: 'quarantine',
  reviewRequiredBeforeDependentTask: true };

async function root(t) {
  const path = await mkdtemp(join(tmpdir(), 'flowdeck-activities-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  // Production preflight initializes the durable campaign before activities run.
  await createAutonomyCampaignStore(path).initialize(policy);
  return path;
}
function fixture(path, options = {}) {
  const context = { schema: 'flowdeck.autonomous-input/v1', projectId: project.id,
    campaignRunId: 'campaign-run-0001', policy, policyDigest: autonomyPolicyDigest(policy),
    workflowId: 'flowdeck-workflow-0001', runId: 'temporal-run-00000001' };
  let clicks = 0, stages = 0, authorizations = 0, browserFactories = 0;
  const cancellation = new AbortController();
  const browser = {
    createOwnedProjectTab: async () => ({ id: 'ABCDEF0123456789', type: 'page', url: PROJECT + '?fixture=1' }),
    stage: async () => { stages++; }, matches: async () => true,
    click: async () => { clicks++; if (options.clickError) throw Error(options.clickError); return true; },
    chat: async () => ({ url: options.chatUrl ?? 'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/c/11111111-1111-4111-8111-111111111111' }),
    firstUserTurn: async () => ({ matched: true, turnId: 'turn-fixture' }),
  };
  const ports = {
    root: path, scopes: createInitialScopeStore(path),
    authorize: async () => { authorizations++; return { policy, project, task, planBytes, usage: { initialP1: 0, p1Continuations: 0, initialP2: 0, total: 0 } }; },
    browserFactory: () => { browserFactories++; return browser; },
    executionContext: () => ({ workflowExecution: { workflowId: context.workflowId, runId: context.runId }, cancellationSignal: cancellation.signal }),
  };
  return { context, ports, cancellation, browser, get clicks() { return clicks; }, get stages() { return stages; },
    get authorizations() { return authorizations; }, get browserFactories() { return browserFactories; } };
}

test('mismatched Activity workflow/run IDs fail before store, authorization, or browser effects', async t => {
  const f = fixture(await root(t)); let storeCalls = 0;
  f.ports.scopes = { claimExact: async () => { storeCalls++; }, readExact: async () => { storeCalls++; }, persistExact: async () => { storeCalls++; } };
  f.ports.executionContext = () => ({ workflowExecution: { workflowId: 'other-workflow-0001', runId: 'other-run-00000001' }, cancellationSignal: f.cancellation.signal });
  await assert.rejects(initialActivities(f.ports).submitInitialP1(f.context), /execution differs/);
  assert.equal(storeCalls, 0); assert.equal(f.authorizations, 0); assert.equal(f.browserFactories, 0); assert.equal(f.clicks, 0);
});

test('validated policy digest/project mismatch fails before all effects', async t => {
  const f = fixture(await root(t)); const bad = { ...f.context, policyDigest: '0'.repeat(64) };
  await assert.rejects(initialActivities(f.ports).submitInitialP1(bad), /execution differs/);
  assert.equal(f.authorizations, 0); assert.equal(f.browserFactories, 0); assert.equal(f.clicks, 0);
});

test('authority returned by policy authorization must match the pinned digest before browser construction', async t => {
  const f = fixture(await root(t));
  f.ports.authorize = async () => ({ policy: { ...policy, validUntil: new Date(Date.now() + 2 * 86_400_000).toISOString() },
    project, task, planBytes, usage: { initialP1: 0, p1Continuations: 0, initialP2: 0, total: 0 } });
  await assert.rejects(initialActivities(f.ports).submitInitialP1(f.context), /authority drifted/);
  assert.equal(f.browserFactories, 0); assert.equal(f.clicks, 0);
});

test('run can reconcile immediately while submit preserves the workflow submission count verdict', async t => {
  const f = fixture(await root(t));
  assert.deepEqual(await initialActivities(f.ports).submitInitialP1(f.context), { status: 'submitted' });
  assert.equal(f.clicks, 1);
  assert.deepEqual(await initialActivities(f.ports).reconcileInitialP1(f.context), { status: 'reconciled' });
});

test('lost click acknowledgement is discovered from journal and never clicked again', async t => {
  const f = fixture(await root(t), { clickError: 'lost click acknowledgement' });
  const activities = initialActivities(f.ports);
  assert.deepEqual(await activities.submitInitialP1(f.context), { status: 'blocked', reason: 'initial_submission_uncertain' });
  assert.equal(f.clicks, 1);
  // A fresh composition simulates a worker/activity restart and uses the recovered durable scope.
  const restarted = initialActivities(f.ports);
  const result = await restarted.reconcileInitialP1(f.context);
  assert.ok(['reconciled', 'pending'].includes(result.status));
  assert.equal(f.clicks, 1);
});

test('scope return loss is recovered from the exact on-disk claim journal', async t => {
  const f = fixture(await root(t));
  const scopes = f.ports.scopes; let loseReturn = true;
  f.ports.scopes = { ...scopes, persistExact: async (context, scope) => {
    await scopes.persistExact(context, scope);
    if (loseReturn) { loseReturn = false; throw Error('activity response lost after durable scope write'); }
  } };
  await assert.rejects(initialActivities(f.ports).submitInitialP1(f.context), /response lost/);
  // Retrying the Activity reads the original scope/journal and observes only.
  assert.deepEqual(await initialActivities(f.ports).submitInitialP1(f.context), { status: 'submitted' });
  assert.ok(await f.ports.scopes.readExact(f.context));
  assert.equal(f.clicks, 1);
});

test('owner without any scope blocks instead of treating the execution as fresh', async t => {
  const f = fixture(await root(t));
  await f.ports.scopes.claimExact(f.context);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(f.ports.root, 'browser-owner.lock'), JSON.stringify({ runId: f.context.runId, campaignId: policy.campaignId }));
  await assert.rejects(f.ports.scopes.readExact(f.context), /ambiguous owner without recoverable initial scope/);
});

test('foreign Project chat is quarantined after one click and never resent', async t => {
  const f = fixture(await root(t), { chatUrl: 'https://chatgpt.com/g/g-p-other/c/11111111-1111-4111-8111-111111111111' });
  assert.deepEqual(await initialActivities(f.ports).submitInitialP1(f.context),
    { status: 'blocked', reason: 'initial_submission_uncertain' });
  assert.equal(f.clicks, 1);
});

test('cancellation fails before authorization or filesystem/browser authorization', async t => {
  const f = fixture(await root(t)); f.cancellation.abort();
  await assert.rejects(initialActivities(f.ports).submitInitialP1(f.context), /cancelled/);
  assert.equal(f.authorizations, 0); assert.equal(f.browserFactories, 0); assert.equal(f.clicks, 0);
});
