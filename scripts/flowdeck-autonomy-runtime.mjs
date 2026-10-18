#!/usr/bin/env node
/** Real Temporal autonomous workflow with isolated, durable fake browser effects.
 * Synthetic only. This module never imports a browser automation adapter.
 */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Context } from '@temporalio/activity';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_TYPE = 'flowdeckAutonomousLifecycleV1';
const KINDS = ['initial_p1', 'continue_p1', 'initial_p2'];
const OUTCOMES = ['partial', 'success', 'success'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const own = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...keys].sort());
const sha256 = value => createHash('sha256').update(value).digest('hex');
const traceSynthetic = phase => { if (process.env.FLOWDECK_SYNTHETIC_DEBUG === '1') process.stderr.write('[synthetic-phase] '+phase+'\n'); };
function assertLocalTemporalAddress(address) {
  let host;
  try {
    if (address.includes('://')) host = new URL(address).hostname;
    else if (address.startsWith('[')) host = address.slice(1, address.indexOf(']'));
    else host = address.slice(0, address.lastIndexOf(':'));
  } catch { throw Error('synthetic mode requires a local Temporal address'); }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host))
    throw Error('synthetic mode connects only to a local Temporal service');
}

export function parseArgs(argv) {
  let mode, manifest, nonInteractive = false;
  for (const arg of argv) {
    if (arg === '--non-interactive') {
      if (nonInteractive) throw Error('duplicate --non-interactive');
      nonInteractive = true;
    } else if (arg.startsWith('--mode=')) {
      if (mode !== undefined) throw Error('duplicate --mode');
      mode = arg.slice('--mode='.length);
    } else if (arg.startsWith('--manifest=')) {
      if (manifest !== undefined) throw Error('duplicate --manifest');
      manifest = arg.slice('--manifest='.length);
    } else {
      throw Error(`unsupported argument: ${arg}`);
    }
  }
  if (mode !== 'synthetic') throw Error('only --mode=synthetic is supported; live mode is unavailable');
  if (!manifest || !isAbsolute(manifest) || resolve(manifest) !== manifest)
    throw Error('--manifest must be an absolute canonical path');
  if (!nonInteractive) throw Error('--non-interactive is required');
  return { mode, manifest, nonInteractive };
}

export function validateManifest(manifest, manifestPath) {
  const keys = ['schema', 'fixtureRoot', 'workflowId', 'campaignRunId', 'policy', 'tasks', 'deadlineMs'];
  if (!own(manifest, keys) || manifest.schema !== 'flowdeck.autonomy-runtime-manifest/v1')
    throw Error('synthetic manifest schema/keys invalid');
  if (!isAbsolute(manifestPath) || resolve(manifestPath) !== manifestPath ||
      !isAbsolute(manifest.fixtureRoot) || resolve(manifest.fixtureRoot) !== manifest.fixtureRoot)
    throw Error('manifest and fixture root must use canonical absolute paths');
  const tempRoots = [resolve(tmpdir()), resolve(tmpdir().replace(/^\/var\//, '/private/var/'))];
  const root = manifest.fixtureRoot + sep;
  if (!tempRoots.some(temp => root.startsWith(temp + sep)) || manifest.fixtureRoot === resolve(homedir()) ||
      manifest.fixtureRoot.includes(`${sep}.state${sep}`) || manifest.fixtureRoot.startsWith(resolve(homedir()) + sep))
    throw Error('fixtureRoot must be an isolated temporary directory, outside the user home and .state');
  const manifestRelative = relative(manifest.fixtureRoot, manifestPath);
  if (manifestRelative.startsWith('..') || isAbsolute(manifestRelative))
    throw Error('fixture manifest must live inside fixtureRoot');
  if (!ID.test(manifest.workflowId) || !ID.test(manifest.campaignRunId))
    throw Error('workflowId/campaignRunId invalid');
  if (!manifest.policy || manifest.policy.environment !== 'synthetic' || manifest.policy.interactive !== false)
    throw Error('synthetic runtime requires a noninteractive synthetic policy');
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length !== 2 ||
      !manifest.tasks.every(t => t && ID.test(t.id) && typeof t.prompt === 'string' && t.prompt.trim()))
    throw Error('manifest must contain exactly two isolated fixture tasks');
  if (manifest.tasks[0].id === manifest.tasks[1].id ||
      JSON.stringify(manifest.policy.enabledTaskIds) !== JSON.stringify(manifest.tasks.map(t => t.id)))
    throw Error('fixture tasks must match the ordered policy task IDs');
  if (!Number.isSafeInteger(manifest.deadlineMs) || manifest.deadlineMs < 1000 || manifest.deadlineMs > 180000)
    throw Error('deadlineMs must be between 1000 and 180000');
  return manifest;
}

async function writeExclusive(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const fd = await open(path, 'wx', 0o600);
  try { await fd.writeFile(`${JSON.stringify(value)}\n`); await fd.sync(); } finally { await fd.close(); }
  const d = await open(dirname(path), 'r');
  try { await d.sync(); } finally { await d.close(); }
}
async function replaceDurable(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${randomUUID()}`;
  const fd = await open(temp, 'wx', 0o600);
  try { await fd.writeFile(`${JSON.stringify(value)}\n`); await fd.sync(); } finally { await fd.close(); }
  await rename(temp, path);
  const d = await open(dirname(path), 'r');
  try { await d.sync(); } finally { await d.close(); }
}
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function exists(path) { try { await stat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`${label}_deadline_exceeded (${ms}ms)`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
async function loadDist(name) { return import(pathToFileURL(join(SCRIPT_ROOT, 'dist', name)).href); }

async function identityRecord(root, manifest, policyDigest) {
  const path = join(root, 'runtime-identity.json');
  const expected = { schema: 'flowdeck.autonomy-runtime-identity/v1', workflowId: manifest.workflowId,
    campaignRunId: manifest.campaignRunId, policyDigest, taskQueue: `flowdeck-autonomy-synthetic-${randomUUID()}` };
  try { await writeExclusive(path, expected); return expected; }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const actual = await readJson(path);
    if (!own(actual, Object.keys(expected)) || actual.schema !== expected.schema ||
        actual.workflowId !== expected.workflowId || actual.campaignRunId !== expected.campaignRunId ||
        actual.policyDigest !== policyDigest || !/^flowdeck-autonomy-synthetic-[0-9a-f-]{36}$/.test(actual.taskQueue))
      throw Error('persisted synthetic Temporal identity changed; quarantine');
    return actual;
  }
}

function makeEvents(manifest) {
  const now = '2026-10-18T00:00:00.000Z';
  const sessions = [
    { workId: `${manifest.campaignRunId}-p1-initial`, taskId: manifest.tasks[0].id, outcome: 'partial' },
    { workId: `${manifest.campaignRunId}-p1-continuation`, taskId: manifest.tasks[0].id, outcome: 'success' },
    { workId: `${manifest.campaignRunId}-p2`, taskId: manifest.tasks[1].id, outcome: 'success' },
  ];
  const events = [];
  sessions.forEach((session, i) => {
    const common = { schema: 'remote-mcp.work-event/v1', source: 'remote-mcp-jazz',
      workId: session.workId, ownerId: manifest.policy.ownerId, deviceId: manifest.policy.deviceId,
      sourceCommittedAt: now, startedAt: now, timestampEvidence: 'recorded_in_source_transaction',
      executionVerified: false, backgroundProcesses: 'unknown', origin: 'event' };
    events.push({ ...common, eventId: `${manifest.campaignRunId}-event-${i}-started`, kind: 'work_started',
      revision: 1, completionEvidence: 'none' });
    events.push({ ...common, eventId: `${manifest.campaignRunId}-event-${i}-reported`, kind: 'work_reported',
      revision: 2, reportedAt: now, completionEvidence: 'agent_report_only', outcome: session.outcome });
  });
  const artifacts = sessions.map((session, index) => ({ workId: session.workId, taskId: session.taskId,
    outcome: session.outcome, path: `fake-output/${index}-${session.workId}.json`,
    content: JSON.stringify({ taskId: session.taskId, workId: session.workId, outcome: session.outcome }) }));
  return { schema: 'flowdeck.synthetic-source-fixture/v1', campaignRunId: manifest.campaignRunId, sessions, events, artifacts };
}

async function prepareSourceFixture(root, manifest) {
  const path = join(root, 'fake-source', 'source-events.json');
  const expected = makeEvents(manifest);
  try { await writeExclusive(path, expected); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (JSON.stringify(await readJson(path)) !== JSON.stringify(expected))
      throw Error('fake source fixture changed; quarantine');
  }
  for (const artifact of expected.artifacts) {
    const artifactPath = join(root, artifact.path);
    const record = { schema: 'flowdeck.synthetic-task-output/v1', workId: artifact.workId,
      taskId: artifact.taskId, outcome: artifact.outcome, content: artifact.content,
      contentSha256: sha256(artifact.content) };
    try { await writeExclusive(artifactPath, record); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (JSON.stringify(await readJson(artifactPath)) !== JSON.stringify(record))
        throw Error('fake task output artifact changed; quarantine');
    }
  }
  return path;
}

function makeActivities({ root, manifest, policyDigest, events, campaign, provenance,
  journal }) {
  const pairFor = (workId, outcome) => {
    const matches = events.events.filter(e => e.workId === workId);
    if (matches.length !== 2 || matches[0].kind !== 'work_started' || matches[1].kind !== 'work_reported' ||
        matches[1].outcome !== outcome || matches.some(e => e.ownerId !== manifest.policy.ownerId || e.deviceId !== manifest.policy.deviceId))
      throw Error('fake source event pair is missing or outside the pinned owner/device scope');
  };
  const context = c => {
    const actual = Context.current().info.workflowExecution;
    if (!c || c.workflowId !== actual.workflowId || c.runId !== actual.runId ||
        c.projectId !== manifest.policy.projectId || c.campaignRunId !== manifest.campaignRunId ||
        c.policyDigest !== policyDigest) throw Error('activity execution differs from pinned synthetic run');
    return c;
  };
  async function submit(kind, input) {
    const c = context(input);
    const index = KINDS.indexOf(kind);
    const taskId = index < 2 ? manifest.tasks[0].id : manifest.tasks[1].id;
    const runs = await campaign.reservations(manifest.policy);
    if (!runs.some(r => r.runId === c.runId && r.kind === kind)) await campaign.reserve(manifest.policy, c.runId, kind);
    const dispatchId = sha256(JSON.stringify([c.workflowId, c.runId, kind])).slice(0, 40);
    const projectSlug = new URL(manifest.policy.projectUrl).pathname.split('/')[2];
    const p1Chat = `https://chatgpt.com/g/${projectSlug}/c/${sha256(`${c.runId}-p1-chat`).slice(0, 24)}`;
    const priorChatUrl = kind === 'continue_p1' ? p1Chat : null;
    const chatUrl = kind === 'continue_p1' || kind === 'initial_p1' ? p1Chat :
      `https://chatgpt.com/g/${projectSlug}/c/${sha256(`${c.runId}-initial_p2-chat`).slice(0, 24)}`;
    const prompt = manifest.tasks[index < 2 ? 0 : 1].prompt;
    const intent = { schema: 'flowdeck.send-intent/v1', dispatchId, workflowId: c.workflowId,
      runId: c.runId, campaignId: manifest.policy.campaignId, campaignRunId: c.campaignRunId,
      projectId: c.projectId, taskId, kind, policyDigest, reservationId: sha256(JSON.stringify([c.runId, kind])),
      promptHash: provenance.autonomousSendPromptHash(prompt), tabId: sha256(`${c.runId}-${kind}-tab`).slice(0, 32).toUpperCase(),
      projectUrl: manifest.policy.projectUrl, priorChatUrl, priorUserTurns: kind === 'continue_p1' ? 1 : 0 };
    const initialScope = kind === 'initial_p1' ? { campaignId: manifest.policy.campaignId,
      runId: c.runId, projectId: c.projectId, taskId, tabId: intent.tabId,
      projectUrl: intent.projectUrl, worktree: manifest.policy.worktree,
      promptHash: intent.promptHash, policyDigest } : null;
    const clickPath = join(root, 'fake-browser', `${kind}.click.json`);
    if (await exists(clickPath)) {
      const old = await readJson(clickPath);
      if (old.dispatchId !== dispatchId || old.count !== 1 || old.runId !== c.runId)
        throw Error('fake click counter conflicts with this exact run; quarantine');
      const verified = await provenance.createAutonomySendProvenanceStore(join(root, 'send-provenance')).readExact(dispatchId);
      if (verified.receipt.dispatchId !== dispatchId) throw Error('prior click lacks reconciled provenance; quarantine');
      return { status: 'submitted' };
    }
    await provenance.putIntent(intent);
    await provenance.recordPhase(dispatchId, 'staged');
    if (initialScope) {
      if (await journal.current(initialScope) !== null) throw Error('initial dispatch already has a journal; quarantine');
      await journal.reserve(initialScope);
      await journal.next(initialScope, 'staged');
    }
    await provenance.recordPhase(dispatchId, 'click_attempted');
    if (initialScope) await journal.next(initialScope, 'click_attempted');
    await writeExclusive(clickPath, { schema: 'flowdeck.fake-browser-click/v1', dispatchId, runId: c.runId,
      kind, tabId: intent.tabId, chatUrl, count: 1, fake: true });
    const observation = { schema: 'flowdeck.send-observation/v1', dispatchId,
      intentSha256: sha256(await readFile(join(root, 'send-provenance', `${dispatchId}.intent.json`))),
      observedPromptHash: intent.promptHash, tabId: intent.tabId, chatUrl,
      userTurnId: `${dispatchId}-user-turn`, observedUserTurns: intent.priorUserTurns + 1 };
    await provenance.putObservation(observation);
    await provenance.recordPhase(dispatchId, 'submitted');
    if (initialScope) await journal.next(initialScope, 'submitted');
    await provenance.reconcile(dispatchId);
    if (initialScope) await journal.next(initialScope, 'reconciled');
    return { status: 'submitted' };
  }
  const reconciled = async (kind, input) => {
    const c = context(input);
    const gatePath = join(root, 'event-correlation', `${kind}.json`);
    const eventIndex = KINDS.indexOf(kind);
    const expectedEventIds = events.events.slice(eventIndex * 2, eventIndex * 2 + 2).map(event => event.eventId);
    let gate = await exists(gatePath) ? await readJson(gatePath) :
      { schema: 'flowdeck.synthetic-correlation-gate/v1', workflowId: c.workflowId, runId: c.runId,
        kind, pendingReturns: 0, eventIds: expectedEventIds };
    if (gate.schema !== 'flowdeck.synthetic-correlation-gate/v1' || gate.workflowId !== c.workflowId ||
        gate.runId !== c.runId || gate.kind !== kind || !Number.isSafeInteger(gate.pendingReturns) ||
        gate.pendingReturns < 0 || gate.pendingReturns > 2 || JSON.stringify(gate.eventIds) !== JSON.stringify(expectedEventIds))
      throw Error('durable workflow event correlation gate changed; quarantine');
    // Record the exact event-ID join durably even when the reconciliation
    // completed immediately. Historical synthetic gates can carry two
    // pending returns; fresh synthetic executions record zero instead of
    // scheduling artificial five-second waits. The production composition
    // exercises actual delayed session evidence separately.
    if (!(await exists(gatePath))) await writeExclusive(gatePath,gate);
    const dispatchId = sha256(JSON.stringify([c.workflowId, c.runId, kind])).slice(0, 40);
    const item = await provenance.createAutonomySendProvenanceStore(join(root, 'send-provenance')).readExact(dispatchId);
    return item.receipt?.dispatchId === dispatchId ? { status: 'reconciled' } : { status: 'blocked', reason: 'dispatch_provenance_incomplete' };
  };
  const pairActivity = (i, expected) => async c => {
    context(c);
    const session = events.sessions[i]; pairFor(session.workId, expected);
    return { status: 'reported' };
  };
  return {
    async validateAndClaim(c) { context(c); return { valid: true }; },
    async submitInitialP1(c) { return submit('initial_p1', c); },
    async reconcileInitialP1(c) { return reconciled('initial_p1', c); },
    async awaitP1Events(c) { return pairActivity(0, 'partial')(c); },
    async continueP1(c) { return submit('continue_p1', c); },
    async reconcileContinuation(c) { return reconciled('continue_p1', c); },
    async awaitP1Completion(c) { return pairActivity(1, 'success')(c).then(() => ({ status: 'implementation_done' })); },
    async submitP2(c) { return submit('initial_p2', c); },
    async reconcileP2(c) { return reconciled('initial_p2', c); },
    async awaitP2Completion(c) { return pairActivity(2, 'success')(c).then(() => ({ status: 'implementation_done' })); },
    async closeout(c) { context(c); return { status: 'closed' }; },
  };
}

async function makeCloseout({ root, identity, runId, manifest, temporal, campaign, provenance,
  fakeSourceReader, fakeProcessReader }) {
  const closeout = await loadDist('flowdeck-autonomy-closeout.js');
  const claim = join(root, 'sender-claims', 'synthetic-sender.claim.json');
  const archive = join(root, 'sender-claims', 'archive', `${identity.workflowId}-${runId}.claim.json`);
  const receipt = join(root, 'closeout', `${identity.workflowId}-${runId}.receipt.json`);
  const paths = { claim, archive, receipt, intent: join(root, 'closeout', 'closeout.intent.json'),
    lock: join(root, 'closeout', 'closeout.lock') };
  await mkdir(dirname(archive), { recursive: true, mode: 0o700 });
  await mkdir(dirname(receipt), { recursive: true, mode: 0o700 });
  const claimRecord = { schema: 'flowdeck.synthetic-sender-claim/v1', workflowId: identity.workflowId,
    runId, taskQueue: identity.taskQueue, policyDigest: identity.policyDigest };
  if (!(await exists(claim)) && !(await exists(archive))) await writeExclusive(claim, claimRecord);
  const temporalEvidence = async () => {
    const d = await temporal.workflow.getHandle(identity.workflowId, runId).describe();
    const result = await temporal.workflow.getHandle(identity.workflowId, runId).result();
    if (d.runId !== runId || d.status.name !== 'COMPLETED' || result.status !== 'completed' ||
        result.reason !== 'successfully_reconciled' || result.submissions !== 3)
      throw Error('exact Temporal execution is not completed with autonomous business success');
    return result;
  };
  const verifyAll = async () => {
    await temporalEvidence();
    if ((await fakeProcessReader()).length !== 0) throw Error('synthetic sender process reader found an outstanding process');
    const reservations = await campaign.reservations(manifest.policy);
    if (reservations.length !== 3 || KINDS.some(kind => reservations.filter(r => r.runId === runId && r.kind === kind).length !== 1))
      throw Error('exactly three durable run reservations are required for closeout');
    const eventFixture = await fakeSourceReader();
    if (eventFixture.events.length !== 6 || eventFixture.events.filter(e => e.kind === 'work_started').length !== 3 ||
        eventFixture.events.filter(e => e.kind === 'work_reported').map(e => e.outcome).join(',') !== 'partial,success,success')
      throw Error('fake source event pairs/outcomes failed independent verification');
    for (const kind of KINDS) {
      const gate = await readJson(join(root, 'event-correlation', `${kind}.json`));
      const expectedIds = eventFixture.events.slice(KINDS.indexOf(kind) * 2, KINDS.indexOf(kind) * 2 + 2).map(event => event.eventId);
      if (gate.schema !== 'flowdeck.synthetic-correlation-gate/v1' ||
          gate.workflowId !== identity.workflowId || gate.runId !== runId || gate.kind !== kind ||
          ![0,2].includes(gate.pendingReturns) ||
          JSON.stringify(gate.eventIds) !== JSON.stringify(expectedIds))
        throw Error(`workflow did not correlate the two durable source events for ${kind}`);
    }
    if (eventFixture.artifacts.length !== 3) throw Error('fake source fixture lacks all three task output records');
    for (const artifact of eventFixture.artifacts) {
      const output = await readJson(join(root, artifact.path));
      if (output.schema !== 'flowdeck.synthetic-task-output/v1' || output.workId !== artifact.workId ||
          output.taskId !== artifact.taskId || output.outcome !== artifact.outcome ||
          output.content !== artifact.content || output.contentSha256 !== sha256(output.content))
        throw Error('fake task output artifact failed independent verification');
    }
    const inbox = await readJson(join(root, 'event-inbox', 'inbox.json'));
    if (inbox.schema !== 'flowdeck.work-inbox/v1' || inbox.ownerId !== manifest.policy.ownerId ||
        inbox.deviceId !== manifest.policy.deviceId || Object.keys(inbox.events).length !== 6 ||
        Object.values(inbox.events).some(entry => entry.delivery !== 'delivered' || entry.attempts !== 1 ||
          entry.event.ownerId !== manifest.policy.ownerId || entry.event.deviceId !== manifest.policy.deviceId ||
          !eventFixture.events.some(event => JSON.stringify(event) === JSON.stringify(entry.event))))
      throw Error('durable event inbox does not contain six exact delivered source events');
    const deliveryAcks = await readJson(join(root, 'event-inbox', 'delivery-acks.json'));
    if (deliveryAcks.schema !== 'flowdeck.synthetic-delivery-acks/v1' ||
        Object.keys(deliveryAcks.events).length !== 6 ||
        eventFixture.events.some(event => deliveryAcks.events[event.eventId]?.workflowId !== identity.workflowId ||
          deliveryAcks.events[event.eventId]?.runId !== runId))
      throw Error('event delivery acknowledgements are not correlated to the exact Temporal run');
    const sends = await loadDist('flowdeck-autonomy-send-provenance.js');
    const store = sends.createAutonomySendProvenanceStore(join(root, 'send-provenance'));
    const rows = [];
    for (const kind of KINDS) {
      const dispatchId = sha256(JSON.stringify([identity.workflowId, runId, kind])).slice(0, 40);
      const verified = await store.readExact(dispatchId);
      if (verified.intent.workflowId !== identity.workflowId || verified.intent.runId !== runId ||
          verified.intent.kind !== kind || verified.receipt.dispatchId !== dispatchId)
        throw Error(`durable ${kind} provenance identity mismatch`);
      const click = await readJson(join(root, 'fake-browser', `${kind}.click.json`));
      if (click.count !== 1 || click.runId !== runId || click.dispatchId !== dispatchId || click.fake !== true)
        throw Error(`durable ${kind} click count is not exactly one`);
      rows.push({ kind, dispatchId, intent: verified.intent, receipt: verified.receipt, click });
    }
    const expectedProvenanceFiles = rows.flatMap(row => ['intent', 'staged', 'click_attempted', 'submitted',
      'observation', 'reconciled', 'receipt'].map(phase => `${row.dispatchId}.${phase}.json`)).sort();
    const actualProvenanceFiles = (await readdir(join(root, 'send-provenance'))).sort();
    if (JSON.stringify(actualProvenanceFiles) !== JSON.stringify(expectedProvenanceFiles))
      throw Error('send provenance directory has missing, extra, or conflicting dispatch records');
    const actualClicks = (await readdir(join(root, 'fake-browser'))).sort();
    const expectedClicks = KINDS.map(kind => `${kind}.click.json`).sort();
    if (JSON.stringify(actualClicks) !== JSON.stringify(expectedClicks))
      throw Error('fake browser click directory has extra or missing dispatches');
    const initial = rows[0];
    const initialScope = { campaignId: manifest.policy.campaignId, runId,
      projectId: manifest.policy.projectId, taskId: manifest.tasks[0].id,
      tabId: initial.click.tabId, projectUrl: manifest.policy.projectUrl,
      worktree: manifest.policy.worktree, promptHash: initial.intent.promptHash,
      policyDigest: identity.policyDigest };
    const initialModule = await loadDist('flowdeck-autonomy-initial-send.js');
    const initialJournal = initialModule.createAutonomousInitialJournal(join(root, 'initial-dispatches'));
    const phase = await initialJournal.current(initialScope);
    if (phase !== 'reconciled') throw Error('initial production-shaped dispatch journal is not reconciled');
    const initialKey = initialModule.initialDispatchKey(initialScope);
    const expectedInitialFiles = ['claimed', 'staged', 'click_attempted', 'submitted', 'reconciled']
      .map(name => `${initialKey}-${name}.json`).sort();
    if (JSON.stringify((await readdir(join(root, 'initial-dispatches'))).sort()) !== JSON.stringify(expectedInitialFiles))
      throw Error('initial dispatch journal has extra, missing, or conflicting phases');
    return rows;
  };
  const rows = await verifyAll();
  const claimSha256 = sha256(await readFile((await exists(claim)) ? claim : archive));
  const evidenceDigest = sha256(JSON.stringify({ workflowId: identity.workflowId, runId,
    taskQueue: identity.taskQueue, policyDigest: identity.policyDigest, rows: rows.map(r => ({ kind: r.kind,
      dispatchId: r.dispatchId, intent: sha256(r.receipt.intentSha256), receipt: r.receipt })) }));
  const evidence = { workflowId: identity.workflowId, runId, projectId: manifest.policy.projectId,
    claimSha256, evidenceDigest, terminalSuccess: true, allSendsReconciled: true,
    allSessionsReported: true, allEventsDelivered: true, promptSealsMatch: true,
    artifactsVerified: true, noSenders: true };
  const lockExists = await exists(paths.lock);
  await closeout.archiveAutonomousSuccess(evidence, paths, {
    resume: lockExists,
    verify: async () => {
      const again = await verifyAll();
      if (JSON.stringify(again.map(x => x.receipt)) !== JSON.stringify(rows.map(x => x.receipt)))
        throw Error('send evidence changed during closeout');
      return evidence;
    },
  });
  const receiptBytes = await readFile(receipt);
  if (!(await exists(archive)) || (await exists(claim)))
    throw Error('deterministic sender closeout receipt/archive verification failed');
  const record = JSON.parse(receiptBytes);
  if (record.workflowId !== identity.workflowId || record.runId !== runId || record.claimSha256 !== claimSha256 ||
      record.evidenceDigest !== evidenceDigest || record.state !== 'retired')
    throw Error('sender closeout receipt belongs to another execution or evidence set');
  return { receiptPath: receipt, receiptSha256: sha256(receiptBytes) };
}

export async function runSynthetic(manifestPath, options = {}) {
  const manifestStat = await lstat(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) throw Error('fixture manifest must be a regular file');
  const manifest = validateManifest(await readJson(manifestPath), manifestPath);
  const root = manifest.fixtureRoot;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const statRoot = await lstat(root);
  if (statRoot.isSymbolicLink() || !statRoot.isDirectory()) throw Error('fixtureRoot must be a real directory');
  const canonicalRoot = resolve(await realpath(root));
  const canonicalTemp = resolve(await realpath(tmpdir())) + sep;
  if (!canonicalRoot.startsWith(canonicalTemp) || canonicalRoot !== root)
    throw Error('fixtureRoot must be canonical and isolated under the system temporary directory');
  const policyModule = await loadDist('flowdeck-autonomy-policy.js');
  const policy = policyModule.validateAutonomyPolicy(manifest.policy, undefined, undefined);
  if (policy.environment !== 'synthetic' || policy.interactive !== false) throw Error('live or interactive policy rejected');
  const policyDigest = policyModule.autonomyPolicyDigest(policy);
  const { Connection, Client } = await import('@temporalio/client');
  const { NativeConnection, Worker } = await import('@temporalio/worker');
  const address = options.address ?? process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
  assertLocalTemporalAddress(address);
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
  const timeout = manifest.deadlineMs;
  let connection;
  try {
    connection = await bounded(Connection.connect({ address }), Math.min(timeout, 10000), 'Temporal_client_connect');
  } catch (e) {
    if (e?.code === 'ECONNREFUSED' || /ECONNREFUSED|UNAVAILABLE|deadline/i.test(String(e)))
      throw Error(`local Temporal is unavailable at ${address}; synthetic run did not start (${e.message})`);
    if (e?.code === 'EPERM')
      throw Error(`local Temporal access at ${address} was denied by the execution environment (EPERM); synthetic run did not start`);
    throw e;
  }
  let worker = null, workerRun = null, nativeConnection = null;
  try {
  const identity = await identityRecord(root, manifest, policyDigest);
  const campaignModule = await loadDist('flowdeck-autonomy-campaign.js');
  const campaign = campaignModule.createAutonomyCampaignStore(join(root, 'campaign'));
  const campaignPolicyFile = join(root, 'campaign', sha256(policy.campaignId), 'policy.json');
  if (!(await exists(campaignPolicyFile))) await campaign.initialize(policy);
  else await campaign.reservations(policy); // pins the persisted campaign policy before any connection
  const sourcePath = await prepareSourceFixture(root, manifest);
  const fakeSourceReader = async () => JSON.parse(await readFile(sourcePath, 'utf8'));
  const sourceFixture = await fakeSourceReader();
  const fakeProcessReader = async () => []; // explicit isolated process reader; no host process scan
  if ((await fakeProcessReader()).length !== 0) throw Error('synthetic process reader must be empty');
  const provenanceModule = await loadDist('flowdeck-autonomy-send-provenance.js');
  const provenance = {
    ...provenanceModule,
    ...provenanceModule.createAutonomySendProvenanceStore(join(root, 'send-provenance')),
  };
  const initialJournalModule = await loadDist('flowdeck-autonomy-initial-send.js');
  const journal = initialJournalModule.createAutonomousInitialJournal(join(root, 'initial-dispatches'));
  const activities = makeActivities({ root, manifest, policyDigest,
    events: sourceFixture, campaign, provenance, journal });
  const client = new Client({ connection, namespace });
  const input = { schema: 'flowdeck.autonomous-input/v1', projectId: policy.projectId,
    campaignRunId: manifest.campaignRunId, policy, policyDigest };
  const adapterModule = await loadDist('flowdeck-autonomy-temporal-adapter.js');
  const temporalEffects = adapterModule.createTemporalIdentityEffects(client, {
    workflowId: identity.workflowId, taskQueue: identity.taskQueue, input,
  });
  const controllerModule = await loadDist('flowdeck-autonomy-controller.js');
  const inboxModule = await loadDist('flowdeck-work-events.js');
  const deliveryModule = await loadDist('flowdeck-autonomy-event-delivery.js');
  let runId = null, workerError = null;
  let follower = 'stopped', inbox = null, delivery = null;
  let ackState = { schema: 'flowdeck.synthetic-delivery-acks/v1', events: {} };
  const ackPath = join(root, 'event-inbox', 'delivery-acks.json');
  if (await exists(ackPath)) ackState = await readJson(ackPath);
  const handleForRun = () => {
    if (!runId) throw Error('exact Temporal run ID has not been bound');
    return client.workflow.getHandle(identity.workflowId, runId);
  };
  const effects = {
    async authorize(config) {
      return { allowed: config.policy.environment === 'synthetic' && config.policy.interactive === false &&
        policyModule.autonomyPolicyDigest(config.policy) === policyDigest,
      policyDigest, reason: 'synthetic_policy_mismatch' };
    },
    async checkExisting(id) {
      const found = await temporalEffects.checkExisting(id);
      if (found.runId) runId = found.runId;
      return found;
    },
    async startExistingIdentity(request) {
      const started = await temporalEffects.startExistingIdentity(request);
      runId = started.runId;
      return started;
    },
    async ensureFollower(_config, onEvent) {
      traceSynthetic('follower:start');
      if (!runId) throw Error('follower cannot start before exact Temporal run binding');
      if (follower === 'running') return;
      if (ackState.schema !== 'flowdeck.synthetic-delivery-acks/v1' || !ackState.events || Array.isArray(ackState.events))
        throw Error('synthetic event delivery acknowledgement ledger is malformed');
      const target = { workflowId: identity.workflowId, runId };
      delivery = deliveryModule.createAutonomyEventDelivery({ ownerId: policy.ownerId,
        deviceId: policy.deviceId, target,
        inbox: {
          async readPending(eventId) {
            const event = sourceFixture.events.find(item => item.eventId === eventId);
            if (!event) throw Error('fake source reader could not find the requested event');
            return event;
          },
          async markDelivered(eventId, exactTarget) {
            if (exactTarget.workflowId !== target.workflowId || exactTarget.runId !== target.runId)
              throw Error('event acknowledgement target changed');
            const prior = ackState.events[eventId];
            const record = { workflowId: exactTarget.workflowId, runId: exactTarget.runId };
            if (prior && JSON.stringify(prior) !== JSON.stringify(record)) throw Error('event acknowledgement conflict');
            ackState.events[eventId] = record;
            await replaceDurable(ackPath, ackState);
            // Inbox is the sole writer of its attempts/delivery checkpoint after ACK.
          },
        },
        workflow: { async signal(exactTarget, signalName, event) {
          if (signalName !== 'flowdeckAutonomousWorkEventV1' || exactTarget.workflowId !== identity.workflowId ||
              exactTarget.runId !== runId) throw Error('event signal target/name changed');
          await client.workflow.getHandle(exactTarget.workflowId, exactTarget.runId).signal(signalName, event);
        } },
      });
      inbox = inboxModule.createWorkEventInbox({ directory: join(root, 'event-inbox'),
        ownerId: policy.ownerId, deviceId: policy.deviceId,
        wake: event => onEvent(event.eventId) });
      // Inbox fsyncs pending before the controller signals; only the ACK
      // advances delivery and the durable controller event checkpoint.
      for (const event of sourceFixture.events) await inbox.ingest(event, { live: true });
      const status = await inbox.status();
      if (status.pending !== 0 || Object.values(status.events).some(x => x.delivery !== 'delivered'))
        throw Error('synthetic source follower did not drain its durable inbox');
      follower = 'running'; traceSynthetic('follower:ready');
    },
    async followerStatus() { return follower === 'running' ? 'running' : 'stopped'; },
    async stopFollower() { follower = 'stopped'; },
    async deliverEvent(eventId, target) {
      if (!delivery || target.workflowId !== identity.workflowId || target.runId !== runId)
        throw Error('event delivery target is not the exact bound workflow run');
      await delivery(eventId, target);
    },
    async ensureWorker() {
      traceSynthetic('worker:start');
      if (worker && worker.getState() === 'RUNNING') return;
      if (!runId) throw Error('worker cannot start before exact Temporal run binding');
      const senderClaim = join(root, 'sender-claims', 'synthetic-sender.claim.json');
      const senderArchive = join(root, 'sender-claims', 'archive', `${identity.workflowId}-${runId}.claim.json`);
      const claimRecord = { schema: 'flowdeck.synthetic-sender-claim/v1', workflowId: identity.workflowId,
        runId, taskQueue: identity.taskQueue, policyDigest };
      if (!(await exists(senderClaim)) && !(await exists(senderArchive))) await writeExclusive(senderClaim, claimRecord);
      else if (await exists(senderClaim) && JSON.stringify(await readJson(senderClaim)) !== JSON.stringify(claimRecord))
        throw Error('sender claim does not match the exact Temporal run; quarantine');
      traceSynthetic('worker:connecting');
      nativeConnection = await bounded(NativeConnection.connect({ address }), Math.min(timeout, 10000), 'Temporal_worker_connect');
      traceSynthetic('worker:creating');
      worker = await bounded(Worker.create({ connection: nativeConnection, namespace,
        taskQueue: identity.taskQueue, workflowsPath: join(SCRIPT_ROOT, 'dist', 'flowdeck-autonomous-workflow.js'),
        activities, maxConcurrentActivityTaskExecutions: 1, maxConcurrentWorkflowTaskExecutions: 2 }),
      Math.min(timeout, 30000), 'Temporal_worker_create');
      traceSynthetic('worker:created');
      workerRun = worker.run();
      workerRun.catch(error => { workerError = error; traceSynthetic('worker:failed'); });
      await bounded((async () => {
        while (worker.getState() === 'INITIALIZED') await new Promise(resolveTick => setTimeout(resolveTick, 10));
        if (worker.getState() !== 'RUNNING') throw workerError ?? Error(`worker did not reach RUNNING (${worker.getState()})`);
      })(), Math.min(timeout, 10000), 'Temporal_worker_readiness'); traceSynthetic('worker:ready');
    },
    async workerStatus() {
      if (workerError || (worker && worker.getState() === 'FAILED')) return 'unresponsive';
      if (worker && worker.getState() === 'RUNNING') return 'running';
      return 'stopped';
    },
    async stopWorker() {
      if (!worker) return;
      if (worker.getState() === 'RUNNING') worker.shutdown();
      if (workerRun) await bounded(workerRun, Math.min(timeout, 10000), 'Temporal_worker_shutdown');
      if (worker.getState() !== 'STOPPED') throw Error(`worker shutdown was not proven (${worker.getState()})`);
      if (nativeConnection) { await nativeConnection.close(); nativeConnection = null; }
    },
    async status() {
      return { worker: worker ? worker.getState() : 'STOPPED', follower,
        runId, workflow: runId ? (await handleForRun().describe()).status.name : 'unbound' };
    },
    async verify() {
      if (!runId) return { terminal: false, status: 'blocked', reason: 'run_unbound' };
      const d = await handleForRun().describe();
      if (d.runId !== runId) throw Error('controller observed a different Temporal run');
      if (d.status.name === 'RUNNING') return { terminal: false, status: 'blocked', reason: 'workflow_running' };
      if (d.status.name === 'COMPLETED') {
        const result = await handleForRun().result();
        return { terminal: true, status: result.status === 'completed' ? 'completed' : 'blocked', reason: result.reason };
      }
      return { terminal: true, status: 'blocked', reason: `workflow_${d.status.name.toLowerCase()}` };
    },
    async cancelWorkflow(target) { await client.workflow.getHandle(target.workflowId, target.runId).cancel(); },
    async assertNoOutstandingEffects(target) {
      if (target.workflowId !== identity.workflowId || target.runId !== runId ||
          await this.workerStatus() !== 'stopped' || await this.followerStatus() !== 'stopped' ||
          (await fakeProcessReader()).length !== 0)
        throw Error('sender shutdown or exact run evidence is incomplete');
      const d = await handleForRun().describe();
      if (d.status.name !== 'COMPLETED' || d.runId !== runId) throw Error('Temporal execution is not terminal completed');
    },
    async finalizeOrResumeCloseout(target) {
      if (target.runId !== runId || target.workflowId !== identity.workflowId || target.policyDigest !== policyDigest)
        throw Error('closeout target differs from exact lifecycle identity');
      return makeCloseout({ root, identity, runId, manifest, temporal: client, campaign,
        provenance, fakeSourceReader, fakeProcessReader });
    },
    async verifyCloseoutReceipt(record, target) {
      const bytes = await readFile(record.receiptPath);
      if (sha256(bytes) !== record.receiptSha256)
        throw Error('controller closeout receipt content hash mismatch');
      if (target.runId !== runId)
        throw Error('controller closeout receipt exact run identity mismatch');
      if (target.workflowId !== identity.workflowId)
        throw Error('controller closeout receipt workflow identity mismatch');
    },
  };
  const controller = controllerModule.createAutonomyController(join(root, 'controller.json'), effects,
    join(root, 'controller-owners'));
  const config = { schema: 'flowdeck.autonomy-controller-config/v1', policy, workflowId: identity.workflowId,
    runId: null, ownerScope: { ownerId: policy.ownerId, deviceId: policy.deviceId, worktree: policy.worktree },
    follower: { schema: 'flowdeck.event-follower/v1', source: 'synthetic-source-fixture',
      ownerId: policy.ownerId, deviceId: policy.deviceId, cursorPath: join(root, 'follower', 'cursor.json') },
    deadlineAt: new Date(Date.now() + timeout).toISOString(), stopGraceMs: Math.min(timeout, 10000) };
  const controllerAlreadyExisted = await exists(join(root, 'controller.json'));
  if (controllerAlreadyExisted) {
    const prior = await controller.read();
    if (!prior.runId) throw Error('existing controller has no exact bound Temporal run');
    const verified = await temporalEffects.checkExisting({ workflowId: identity.workflowId, runId: prior.runId });
    if (!verified.runId || verified.runId !== prior.runId || verified.policyDigest !== policyDigest ||
        !['running', 'completed'].includes(verified.status))
      throw Error('cannot adopt existing synthetic controller without exact Temporal history');
    runId = verified.runId;
  }
  traceSynthetic('controller:execute');
  let lifecycle = await bounded(controller.execute(config), timeout, 'autonomy_controller_execute');
  traceSynthetic('controller:state:'+lifecycle.manifest.state+':'+(lifecycle.manifest.failureReason??'none'));
  if (lifecycle.manifest.failureReason && lifecycle.manifest.state !== 'closeout_blocked')
    throw Error('controller reported a blocked lifecycle: '+lifecycle.manifest.failureReason);
  if (!['retired', 'business_blocked', 'cancelled', 'closeout_blocked', 'shutdown_uncertain'].includes(lifecycle.manifest.state)) {
    if (!runId) throw Error('controller returned without binding the actual Temporal run ID');
    const handle = client.workflow.getHandle(identity.workflowId, runId);
    await bounded(handle.result(), Math.max(1, config.deadlineAt ? Date.parse(config.deadlineAt) - Date.now() : timeout),
      'autonomous_workflow');
    lifecycle = await bounded(controller.execute(config), Math.max(1, Date.parse(config.deadlineAt) - Date.now()),
      'autonomy_controller_closeout');
  }
  if (lifecycle.manifest.state !== 'retired' || !lifecycle.manifest.businessResult ||
      lifecycle.manifest.businessResult.status !== 'completed' || !lifecycle.manifest.closeoutReceipt)
    throw Error(`controller did not independently retire a successful cycle (${lifecycle.manifest.state}: ${lifecycle.manifest.failureReason ?? 'no detail'})`);
  const runIdFinal = lifecycle.manifest.runId;
  const result = await client.workflow.getHandle(identity.workflowId, runIdFinal).result();
  if (result.status !== 'completed' || result.reason !== 'successfully_reconciled' || result.submissions !== 3)
    throw Error(`Temporal business result is not the required three-send success: ${JSON.stringify(result)}`);
  const clickCounts = Object.fromEntries(await Promise.all(KINDS.map(async kind => [kind,
    (await readJson(join(root, 'fake-browser', `${kind}.click.json`))).count])));
  if (KINDS.some(kind => clickCounts[kind] !== 1)) throw Error('a fake browser dispatch count was not exactly one');
  const verifiedReceipt = await makeCloseout({ root, identity, runId: runIdFinal, manifest,
    temporal: client, campaign, provenance, fakeSourceReader, fakeProcessReader });
  if (JSON.stringify(verifiedReceipt) !== JSON.stringify(lifecycle.manifest.closeoutReceipt))
    throw Error('deterministic receipt changed during independent restart verification');
  return { mode: 'synthetic', workflowId: identity.workflowId, runId: runIdFinal, taskQueue: identity.taskQueue,
    temporalStatus: 'COMPLETED', submissions: result.submissions, clickCounts, reservations: 3,
    eventOutcomes: OUTCOMES, senderStopped: lifecycle.manifest.worker === 'stopped' && lifecycle.manifest.follower === 'stopped',
    receipt: verifiedReceipt, restarted: controllerAlreadyExisted };
  } finally {
    if (worker?.getState() === 'RUNNING') worker.shutdown();
    if (workerRun) await bounded(workerRun.catch(() => undefined), 5000, 'synthetic_worker_cleanup').catch(() => undefined);
    if (nativeConnection) await nativeConnection.close().catch(() => undefined);
    await connection.close().catch(() => undefined);
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  const result = await runSynthetic(args.manifest);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`flowdeck synthetic runtime failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
