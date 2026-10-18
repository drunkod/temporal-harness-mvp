import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFlowdeckAutonomyProductionInitial } from '../dist/flowdeck-autonomy-production-initial.js';
import { createProductionFollowups } from '../dist/flowdeck-autonomy-production-followups.js';
import { createAutonomyCampaignStore } from '../dist/flowdeck-autonomy-campaign.js';
import { createAutonomySendProvenanceStore, autonomousSendPromptHash } from '../dist/flowdeck-autonomy-send-provenance.js';
import { autonomyPolicyDigest, sha256 } from '../dist/flowdeck-autonomy-policy.js';
import { composerPayloadFor } from '../dist/sashai-dispatch-evidence.js';
import { supervisedTaskPrompt } from '../dist/flowdeck-supervisor-activities.js';
import { PROJECT } from '../dist/sashai-live-browser.js';

const plan = Buffer.from('approved production followups test plan');
const p1 = { id: 'initial-p1', title: 'Implement P1', instruction: 'Complete the approved first task.' };
const p2 = { id: 'independent-p2', title: 'Implement P2', instruction: 'Complete the independent second task.' };
const validFrom = new Date(Date.now() - 60_000).toISOString();
const validUntil = new Date(Date.now() + 86_400_000).toISOString();
const project = { id: 'followups-project-0001', ownerId: 'followups-owner-0001', deviceId: 'followups-device-0001',
  repo: '/tmp/flowdeck-followups-project', projectUrl: PROJECT, initialTaskId: p1.id, tasks: [p1, p2] };
const policy = { schema: 'flowdeck.autonomy-policy/v1', mode: 'automatic-initial-send', interactive: false,
  environment: 'synthetic', profile: 'helium-profile-4', taskSource: 'approved-active-plan', projectId: project.id,
  projectUrl: PROJECT, ownerId: project.ownerId, deviceId: project.deviceId, worktree: project.repo, allowedRoot: project.repo,
  planSha256: sha256(plan), enabledTaskIds: [p1.id, p2.id], instructionHashes: [sha256(p1.instruction), sha256(p2.instruction)],
  campaignId: 'followups-campaign-0001', validFrom, validUntil, maxTasksPerRun: 2, maxContinuationsPerTask: 1,
  p2Continuations: 0, maxSubmissionsPerRun: 3, maxCampaignRuns: 2, maxCampaignSubmissions: 6,
  maxRunDurationMinutes: 60, automaticSuccessfulCloseout: true, uncertainSend: 'quarantine', identityConflict: 'quarantine',
  reviewRequiredBeforeDependentTask: true };
const execution = { workflowId: 'flowdeck-followups-test-0001', runId: 'temporal-followups-run-0001',
  campaignRunId: 'campaign-run-followups-0001', projectId: project.id, policyDigest: autonomyPolicyDigest(policy) };

async function setup(t, { loseContinuationAck = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'flowdeck-production-followups-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const campaign = createAutonomyCampaignStore(root);
  await campaign.initialize(policy);
  const tabs = new Map(); let nextTab = 0, clicks = 0, failContinuationAck = loseContinuationAck;
  const newTabId = () => `ABCDEF012345678${++nextTab}`;
  const chatUrl = n => `https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/c/11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
  const addTurn = (tab, prompt, n) => {
    if (!tab.chatUrl) tab.chatUrl = chatUrl(n);
    tab.userTurns.push({ id: `turn-${n}`, text: composerPayloadFor(prompt) });
  };
  const initialBrowser = {
    createOwnedProjectTab: async ownerId => {
      const tab = { id: newTabId(), ownerId, projectUrl: PROJECT, chatUrl: null, connector: 'Probe RemoteMCP2',
        composer: '', hydrated: true, projectTab: true, userTurns: [] };
      tabs.set(tab.id, tab);
      return { id: tab.id, type: 'page', url: PROJECT + '?flowdeckAttempt=test', webSocketDebuggerUrl: 'fake' };
    },
    stage: async (tab, _url, prompt) => { tabs.get(tab.id).composer = composerPayloadFor(prompt); },
    matches: async (tab, _url, prompt) => tabs.get(tab.id).composer === composerPayloadFor(prompt),
    click: async (tab, _url, prompt) => {
      clicks++; addTurn(tabs.get(tab.id), prompt, clicks); return true;
    },
    chat: async tabId => { const tab = tabs.get(tabId); return tab?.chatUrl ? { url: tab.chatUrl, id: tab.chatUrl.split('/').at(-1) } : null; },
    firstUserTurn: async tabId => ({ matched: tabs.get(tabId).userTurns.length === 1, turnId: tabs.get(tabId).userTurns[0]?.id ?? null }),
  };
  const authorization = { policy, project, task: p1, planBytes: plan, usage: { initialP1: 0, p1Continuations: 0, initialP2: 0, total: 0 } };
  const initial = await createFlowdeckAutonomyProductionInitial({ root, runId: execution.runId,
    authorize: async () => authorization, browser: initialBrowser, campaign,
    uuid: () => 'owner-tab-followups-0001' }).run();
  assert.equal(initial.status, 'reconciled');
  const initialObservation = JSON.parse(await readFile(join(root, 'initial-observations',
    sha256(JSON.stringify([policy.campaignId, execution.runId, p1.id])) + '.json'), 'utf8'));
  let continuationId = null;
  const provenance = createAutonomySendProvenanceStore(join(root, 'send-provenance'));
  const browser = {
    observe: async tabId => tabs.get(tabId) ?? null,
    createOwnedProjectTab: async ownerId => {
      const tab = { id: newTabId(), ownerId, projectUrl: PROJECT, chatUrl: null, connector: 'Probe RemoteMCP2',
        composer: '', hydrated: true, projectTab: true, userTurns: [] };
      tabs.set(tab.id, tab); return tab;
    },
    stage: async (tabId, prompt) => { tabs.get(tabId).composer = composerPayloadFor(prompt); },
    matches: async (tabId, prompt) => tabs.get(tabId).composer === composerPayloadFor(prompt),
    click: async (tabId, prompt) => {
      clicks++; const tab = tabs.get(tabId); addTurn(tab, prompt, clicks);
      if (failContinuationAck && tabId === initial.scope.tabId) { failContinuationAck = false; throw Error('lost click acknowledgement'); }
      return true;
    },
  };
  const readOwnerClaim = async () => JSON.parse(await readFile(join(root, 'browser-owner.lock'), 'utf8'));
  const readPredecessor = async stage => {
    if (stage === 'initial_p1') return {
      schema: 'flowdeck.followup-predecessor/v1', stage, workflowId: execution.workflowId, runId: execution.runId,
      campaignRunId: execution.campaignRunId, campaignId: policy.campaignId, projectId: project.id, taskId: p1.id,
      policyDigest: execution.policyDigest, dispatchId: sha256(JSON.stringify([policy.campaignId, execution.runId, project.id, p1.id])), promptHash: initial.scope.promptHash,
      tabId: initial.scope.tabId, chatUrl: initialObservation.chatUrl, userTurnId: initialObservation.turnId,
      observedUserTurns: 1, workId: 'source-p1-initial-work-0001', ownerId: project.ownerId, deviceId: project.deviceId,
      sourceState: 'reported', outcome: 'partial', turnFinished: true, decision: 'continue',
      exactBinding: true, exactDispatch: true, exactSession: true, conflict: false,
    };
    const provenanceRecord = await provenance.readExact(continuationId);
    return {
      schema: 'flowdeck.followup-predecessor/v1', stage, workflowId: execution.workflowId, runId: execution.runId,
      campaignRunId: execution.campaignRunId, campaignId: policy.campaignId, projectId: project.id, taskId: p1.id,
      policyDigest: execution.policyDigest, dispatchId: continuationId, promptHash: provenanceRecord.intent.promptHash,
      tabId: provenanceRecord.observation.tabId, chatUrl: provenanceRecord.observation.chatUrl,
      userTurnId: provenanceRecord.observation.userTurnId, observedUserTurns: provenanceRecord.observation.observedUserTurns,
      workId: 'source-p1-continuation-work-0001', ownerId: project.ownerId, deviceId: project.deviceId,
      sourceState: 'reported', outcome: 'success', turnFinished: true, decision: 'implementation_done',
      exactBinding: true, exactDispatch: true, exactSession: true, conflict: false,
    };
  };
  const followups = createProductionFollowups({ root, execution, assertExecution: async current => assert.deepEqual(current, execution),
    authorize: async () => authorization, readOwnerClaim,
    readPredecessor, browser, campaign, provenance });
  return { root, campaign, provenance, tabs, initial, initialObservation, followups, get clicks() { return clicks; },
    setContinuationId(value) { continuationId = value; }, authorization, readOwnerClaim, readPredecessor, browser };
}

test('continuation and P2 use same guarded producer, exact destinations, and producer-written receipts', async t => {
  const f = await setup(t);
  const continued = await f.followups.continueP1();
  f.setContinuationId(continued.dispatchId);
  assert.equal(continued.status, 'submitted'); assert.equal(continued.submittedCount, 1);
  const continuation = await f.provenance.readExact(continued.dispatchId);
  assert.equal(continuation.intent.tabId, f.initial.scope.tabId);
  assert.equal(continuation.observation.chatUrl, f.initialObservation.chatUrl);
  assert.equal(continuation.observation.observedUserTurns, 2);
  assert.equal(continuation.intent.promptHash, autonomousSendPromptHash(supervisedTaskPrompt(project, p1, 'continue')));
  assert.equal((await f.followups.reconcileContinuation()).status, 'reconciled');

  const submittedP2 = await f.followups.submitP2();
  assert.equal(submittedP2.status, 'submitted'); assert.equal(submittedP2.submittedCount, 1);
  const second = await f.provenance.readExact(submittedP2.dispatchId);
  assert.notEqual(second.intent.tabId, continuation.intent.tabId);
  assert.notEqual(second.observation.chatUrl, continuation.observation.chatUrl);
  assert.equal(second.observation.observedUserTurns, 1);
  assert.equal(second.intent.promptHash, autonomousSendPromptHash(supervisedTaskPrompt(project, p2, 'initial')));
  assert.equal((await f.followups.reconcileP2()).status, 'reconciled');
  assert.equal(f.clicks, 3);
});

test('lost click acknowledgement is reconciled on same-run retry without another click', async t => {
  const f = await setup(t, { loseContinuationAck: true });
  await assert.rejects(f.followups.continueP1(), /lost click acknowledgement/);
  const before = f.clicks;
  const retried = await f.followups.continueP1();
  assert.equal(retried.status, 'reconciled'); assert.equal(retried.submittedCount, 0);
  assert.equal(f.clicks, before);
  const record = await f.provenance.readExact(retried.dispatchId);
  assert.equal(record.observation.observedUserTurns, 2);
});

test('missing owner claim fails before browser effects', async t => {
  const f = await setup(t);
  const bad = createProductionFollowups({ root: f.root, execution, assertExecution: async () => {},
    authorize: async () => ({ policy, project, planBytes: plan,
    usage: { initialP1: 1, p1Continuations: 0, initialP2: 0, total: 1 } }),
    readOwnerClaim: async () => null, readPredecessor: async () => null,
    browser: { observe: async () => { throw Error('browser should not be observed'); },
      createOwnedProjectTab: async () => { throw Error('browser should not create tabs'); },
      stage: async () => { throw Error('browser should not be staged'); }, matches: async () => false,
      click: async () => { throw Error('browser should not be clicked'); } },
    campaign: f.campaign, provenance: f.provenance });
  await assert.rejects(bad.continueP1(), /owner claim/);
  assert.equal(f.clicks, 1);
});

test('conflicting source/session predecessor evidence fails closed before staging', async t => {
  const f = await setup(t);
  const conflicting = async stage => ({ ...await f.readPredecessor(stage), conflict: true });
  const blocked = createProductionFollowups({ root: f.root, execution, assertExecution: async () => {},
    authorize: async () => f.authorization, readOwnerClaim: f.readOwnerClaim, readPredecessor: conflicting,
    browser: { observe: async () => { throw Error('browser should not be observed'); },
      createOwnedProjectTab: async () => { throw Error('browser should not create tabs'); },
      stage: async () => { throw Error('browser should not be staged'); }, matches: async () => false,
      click: async () => { throw Error('browser should not be clicked'); } }, campaign: f.campaign, provenance: f.provenance });
  await assert.rejects(blocked.continueP1(), /predecessor session binding/);
  assert.equal(f.clicks, 1);
  assert.equal((await f.campaign.reservations(policy)).length, 1);
});
