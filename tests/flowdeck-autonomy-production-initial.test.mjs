import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFlowdeckAutonomyProductionInitial, productionAutonomyRoot } from '../dist/flowdeck-autonomy-production-initial.js';
import { PROJECT, matchInitialFirstUserTurn } from '../dist/sashai-live-browser.js';
import { sha256 } from '../dist/flowdeck-autonomy-policy.js';
import { createAutonomyCampaignStore } from '../dist/flowdeck-autonomy-campaign.js';

const plan = Buffer.from('approved active plan fixture');
const task = { id: 'initial-p1', title: 'Implement fixture', instruction: 'Do the approved fixture work.' };
const task2 = { id: 'later-p2', title: 'Later fixture', instruction: 'Do the later approved fixture work.' };
const validFrom = new Date(Date.now() - 60_000).toISOString();
const validUntil = new Date(Date.now() + 2 * 86400_000).toISOString();
const project = { id: 'project-test-0001', ownerId: 'owner-test-0001', deviceId: 'device-test-0001',
  repo: '/tmp/flowdeck-initial-test', projectUrl: PROJECT, initialTaskId: task.id, tasks: [task, task2] };
const policy = () => ({ schema: 'flowdeck.autonomy-policy/v1', mode: 'automatic-initial-send', interactive: false,
  environment: 'synthetic', profile: 'helium-profile-4', taskSource: 'approved-active-plan', projectId: project.id,
  projectUrl: project.projectUrl, ownerId: project.ownerId, deviceId: project.deviceId, worktree: project.repo,
  allowedRoot: project.repo, planSha256: sha256(plan), enabledTaskIds: [task.id, task2.id],
  instructionHashes: [sha256(task.instruction), sha256(task2.instruction)], campaignId: 'campaign-test-0001',
  validFrom, validUntil, maxTasksPerRun: 2,
  maxContinuationsPerTask: 1, p2Continuations: 0, maxSubmissionsPerRun: 3, maxCampaignRuns: 2,
  maxCampaignSubmissions: 6, maxRunDurationMinutes: 60, automaticSuccessfulCloseout: true,
  uncertainSend: 'quarantine', identityConflict: 'quarantine', reviewRequiredBeforeDependentTask: true });
const usage = { initialP1: 0, p1Continuations: 0, initialP2: 0, total: 0 };
async function sandbox(t) { const root = await mkdtemp(join(tmpdir(), 'flowdeck-production-initial-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
function fixture(root, overrides = {}) {
  let clicks = 0, stages = 0;
  const tab = { id: 'ABCDEF0123456789', type: 'page', url: PROJECT + '?flowdeckAttempt=fixture', webSocketDebuggerUrl: 'fake' };
  const browser = {
    createOwnedProjectTab: async () => tab,
    requireTab: async () => tab,
    stage: async () => { stages++; },
    matches: async () => true,
    click: async () => {
      const { readdir, readFile } = await import('node:fs/promises');
      const phases = await readdir(join(root, 'initial-dispatches'));
      const barrier = phases.find(name => name.endsWith('-click_attempted.json'));
      assert.ok(barrier, 'durable click_attempted must exist before LiveBrowser.click');
      assert.ok((await readFile(join(root, 'browser-owner.lock'), 'utf8')).includes('flowdeck.browser-owner/v1'));
      clicks++; return true;
    },
    chat: async () => ({ url: 'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/c/11111111-1111-4111-8111-111111111111', id: '11111111-1111-4111-8111-111111111111' }),
    firstUserTurn: async () => ({ matched: true, turnId: 'turn-fixture' }),
    evidence: async () => ({ promptMatched: true, turnId: 'turn-fixture' })
  };
  const auth = { policy: policy(), project, task, planBytes: plan, usage };
  const deps = { root, runId: 'temporal-run-00000001', authorize: async () => auth, browser, campaign: { reserve: async () => ({ reserved: true }) },
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(), ...overrides };
  return { deps, auth, browser, get clicks() { return clicks; }, get stages() { return stages; } };
}

test('happy initial P1 stages canonical prompt, crosses one click barrier, and reconciles exact first turn', async t => {
  const f = fixture(await sandbox(t));
  const campaign = createAutonomyCampaignStore(f.deps.root);
  await campaign.initialize(f.auth.policy); f.deps.campaign = campaign;
  const result = await createFlowdeckAutonomyProductionInitial(f.deps).run();
  assert.equal(result.status, 'reconciled'); assert.equal(f.clicks, 1); assert.equal(f.stages, 1);
  assert.equal(result.scope.runId, f.deps.runId);
  assert.equal((await campaign.reservations(f.auth.policy)).length, 1);
  assert.equal((await campaign.reservations(f.auth.policy))[0].runId, f.deps.runId);
  const { readFile, readdir } = await import('node:fs/promises');
  const owner = JSON.parse(await readFile(join(f.deps.root, 'browser-owner.lock'), 'utf8'));
  assert.equal(owner.runId, f.deps.runId);
  const journalDir = join(f.deps.root, 'initial-dispatches');
  const claimed = JSON.parse(await readFile(join(journalDir, (await readdir(journalDir)).find(n => n.endsWith('-claimed.json')),), 'utf8'));
  assert.equal(claimed.scope.runId, f.deps.runId);
});

test('missing or malformed Temporal runId refuses before any transaction effects', async t => {
  for (const runId of [undefined, '', 'bad/id']) {
    const f = fixture(await sandbox(t));
    if (runId === undefined) delete f.deps.runId;
    else f.deps.runId = runId;
    let authorizations = 0, reservations = 0, tabs = 0;
    f.deps.authorize = async () => { authorizations++; return f.auth; };
    f.deps.campaign.reserve = async () => { reservations++; return { reserved: true }; };
    f.browser.createOwnedProjectTab = async () => { tabs++; return { id: 'ABCDEF0123456789', type: 'page', url: PROJECT }; };
    await assert.rejects(createFlowdeckAutonomyProductionInitial(f.deps).run(), /valid Temporal runId is required/);
    assert.equal(authorizations, 0);
    assert.equal(reservations, 0);
    assert.equal(tabs, 0);
    const { readdir, access } = await import('node:fs/promises');
    await assert.rejects(access(join(f.deps.root, 'browser-owner.lock')));
    await assert.rejects(readdir(join(f.deps.root, 'initial-dispatches')));
  }
});

test('changed approved plan/task policy refuses before click', async t => {
  const f = fixture(await sandbox(t)); let checks = 0;
  f.deps.authorize = async () => { if (++checks > 1) return { ...f.auth, planBytes: Buffer.from('changed plan') }; return f.auth; };
  await assert.rejects(createFlowdeckAutonomyProductionInitial(f.deps).run(), /approved active plan changed/);
  assert.equal(f.clicks, 0);
});

test('changed standing policy is revalidated immediately before click', async t => {
  const f = fixture(await sandbox(t)); let checks = 0;
  f.deps.authorize = async () => {
    if (++checks < 4) return f.auth;
    return { ...f.auth, policy: { ...f.auth.policy, validUntil: new Date(Date.now() + 3 * 86400_000).toISOString() } };
  };
  await assert.rejects(createFlowdeckAutonomyProductionInitial(f.deps).run(), /policy\/enrollment\/plan changed/);
  assert.equal(f.clicks, 0);
});

test('machine-wide owner claim prevents a competing checkout from launching or clicking', async t => {
  const root = await sandbox(t), first = fixture(root);
  assert.equal((await createFlowdeckAutonomyProductionInitial(first.deps).run()).status, 'reconciled');
  assert.equal(first.clicks, 1);
  assert.equal(productionAutonomyRoot().endsWith('Flowdeck/autonomy-v1'), true);
  const second = fixture(root);
  await assert.rejects(createFlowdeckAutonomyProductionInitial(second.deps).run(), /already exists/);
  assert.equal(second.clicks, 0);
});

test('cancellation before click retains durable claim and sends nothing', async t => {
  const f = fixture(await sandbox(t)); let n = 0;
  f.deps.cancelled = () => ++n >= 4;
  await assert.rejects(createFlowdeckAutonomyProductionInitial(f.deps).run(), /canceled/);
  assert.equal(f.clicks, 0);
});

test('composer mismatch refuses before click_attempted', async t => {
  const f = fixture(await sandbox(t)); f.browser.matches = async () => false;
  const activity = createFlowdeckAutonomyProductionInitial(f.deps);
  await assert.rejects(activity.run(), /composer or owned tab mismatch/);
  assert.equal(f.clicks, 0);
});

test('click acknowledgement loss is uncertain and restart only passively reconciles without another click', async t => {
  const f = fixture(await sandbox(t)); let attempts = 0;
  f.browser.click = async () => { attempts++; throw Error('lost click acknowledgement'); };
  const activity = createFlowdeckAutonomyProductionInitial(f.deps);
  await assert.rejects(activity.run(), /lost click acknowledgement/);
  assert.equal(attempts, 1);
  const scope = await (async () => {
    const { readFile, readdir } = await import('node:fs/promises');
    const dir = join(f.deps.root, 'initial-dispatches'); const name = (await readdir(dir)).find(n => n.endsWith('-claimed.json'));
    return JSON.parse(await readFile(join(dir, name), 'utf8')).scope;
  })();
  const restarted = createFlowdeckAutonomyProductionInitial(f.deps);
  f.deps.authorize = async () => { throw Error('policy unavailable after click'); };
  assert.equal((await restarted.reconcile(scope)).status, 'reconciled');
  assert.equal(attempts, 1);
});

test('tab/chat Project mismatch quarantines after the single click', async t => {
  const f = fixture(await sandbox(t));
  f.browser.chat = async () => ({ url: 'https://chatgpt.com/g/g-p-other/c/11111111-1111-4111-8111-111111111111', id: '11111111-1111-4111-8111-111111111111' });
  await assert.rejects(createFlowdeckAutonomyProductionInitial(f.deps).run(), /tab\/chat URL mismatch/);
  assert.equal(f.clicks, 1);
});

test('nonmatching first user turn remains pending after the single click', async t => {
  const f = fixture(await sandbox(t)); f.browser.firstUserTurn = async () => ({ matched: false, turnId: null });
  const result = await createFlowdeckAutonomyProductionInitial(f.deps).run();
  assert.equal(result.status, 'pending'); assert.equal(f.clicks, 1);
});

test('first-user matcher rejects a later matching user turn when the first differs', () => {
  const result = matchInitialFirstUserTurn([{ text: 'unapproved prior message', turnId: 'prior' },
    { text: 'approved prompt', turnId: 'later' }], 'approved prompt');
  assert.deepEqual(result, { matched: false, turnId: null });
});

test('first-user matcher refuses an extra turn even when first text is sealed', () => {
  const prompt = 'approved first task';
  const normalized = 'Probe RemoteMCP2 ' + prompt;
  const result = matchInitialFirstUserTurn([{ text: normalized, turnId: 'first' },
    { text: 'unexpected second turn', turnId: 'second' }], prompt);
  assert.deepEqual(result, { matched: false, turnId: null });
});

test('initial reconciliation accepts canonical Sashai chat route with -dr-sashai suffix', async t => {
  const f = fixture(await sandbox(t));
  f.browser.chat = async () => ({
    url: 'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d-dr-sashai/c/11111111-1111-4111-8111-111111111111',
    id: '11111111-1111-4111-8111-111111111111'
  });
  const result = await createFlowdeckAutonomyProductionInitial(f.deps).run();
  assert.equal(result.status, 'reconciled');
  assert.equal(f.clicks, 1);
});
