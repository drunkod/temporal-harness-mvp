import test from 'node:test';
import { createProductionPredecessorReader } from '../dist/flowdeck-autonomy-production-predecessor.js';
import { createProductionSourceCursorStore } from '../dist/flowdeck-autonomy-production-cursor.js';
import { createSenderProcessFence } from '../dist/flowdeck-autonomy-production-process.js';
import { createProductionFollowerOwnership } from '../dist/flowdeck-autonomy-production-ownership.js';
import assert from 'node:assert/strict';
import { NativeConnection, Worker } from '@temporalio/worker';
import { Client } from '@temporalio/client';
import { Context } from '@temporalio/activity';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createInitialScopeStore } from '../dist/flowdeck-autonomy-production-activities.js';
import { createAutonomousInitialJournal } from '../dist/flowdeck-autonomy-initial-send.js';
import { createProductionFollowups } from '../dist/flowdeck-autonomy-production-followups.js';
import { createProductionRegistry } from '../dist/flowdeck-autonomy-production-registry.js';
import { createProductionSessionChecks } from '../dist/flowdeck-autonomy-production-sessions.js';
import { createProductionRuntimeComposition, createPinnedProductionInbox } from '../dist/flowdeck-autonomy-production-runtime.js';
import { createFilesystemEvidenceReaders, createTemporalEvidenceClient } from '../dist/flowdeck-autonomy-production-evidence.js';
import { createTemporalIdentityEffects } from '../dist/flowdeck-autonomy-temporal-adapter.js';
import { createAutonomyCampaignStore } from '../dist/flowdeck-autonomy-campaign.js';
import { createAutonomySendProvenanceStore } from '../dist/flowdeck-autonomy-send-provenance.js';
import { autonomyPolicyDigest, sha256 } from '../dist/flowdeck-autonomy-policy.js';
import { composerPayloadFor } from '../dist/sashai-dispatch-evidence.js';
import { PROJECT } from '../dist/sashai-live-browser.js';

const temporalAddress = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
const taskQueue = `flowdeck-prod-composition-${process.pid}`;
const ids = {
  projectId: 'prod-composition-project-01', campaignId: 'prod-composition-campaign-01',
  campaignRunId: 'prod-composition-campaign-run-01', ownerId: 'prod-composition-owner-01',
  deviceId: 'prod-composition-device-01', p1: 'prod-task-p1', p2: 'prod-task-p2',
};

function setTimeoutBounded(promise, ms, label) {
  return new Promise((resolveResult, rejectResult) => {
    const timer = setTimeout(() => rejectResult(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(resolveResult, rejectResult).finally(() => clearTimeout(timer));
  });
}

async function runProductionComposition(t, scenario = 'success') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'flowdeck-prod-composition-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const connection = await NativeConnection.connect({ address: temporalAddress });
  const client = new Client({ connection });
  const sourceReports = new Map();
  const event = (workId, kind, revision, at, outcome) => ({
    schema: 'remote-mcp.work-event/v1', source: 'remote-mcp-jazz',
    eventId: `${workId}-${kind}`, workId, ownerId: ids.ownerId, deviceId: ids.deviceId,
    kind, revision, sourceCommittedAt: at, startedAt: sourceReports.get(workId)?.startedAt ?? at,
    ...(kind === 'work_reported' ? { reportedAt: at, outcome } : {}),
    timestampEvidence: 'recorded_in_source_transaction',
    completionEvidence: kind === 'work_started' ? 'none' : 'agent_report_only',
    executionVerified: false, backgroundProcesses: 'unknown', origin: 'event',
  });
  const sessions = new Map();
  const tabs = new Map();
  const clicks = [];
  const artifactWrites = [];
  const state = { activeActivities: 0, browserCallsInFlight: 0 };
  const artifactPaths = [join(root, 'output', 'p1.txt'), join(root, 'output', 'p2.txt')];
  const planBytes = Buffer.from('isolated approved test plan');
  const project = {
    id: ids.projectId, ownerId: ids.ownerId, deviceId: ids.deviceId,
    repo: root, projectUrl: PROJECT, initialTaskId: ids.p1,
    tasks: [
      { id: ids.p1, title: 'Production P1', instruction: 'Create the first approved output.' },
      { id: ids.p2, title: 'Independent P2', instruction: 'Create the second approved output.' },
    ],
  };
  const policy = {
    schema: 'flowdeck.autonomy-policy/v1', mode: 'automatic-initial-send', interactive: false,
    environment: 'synthetic', profile: 'helium-profile-4', taskSource: 'approved-active-plan',
    projectId: project.id, projectUrl: PROJECT, ownerId: project.ownerId, deviceId: project.deviceId,
    worktree: root, allowedRoot: root, planSha256: sha256(planBytes), enabledTaskIds: [ids.p1, ids.p2],
    instructionHashes: project.tasks.map(task => sha256(task.instruction)), campaignId: ids.campaignId,
    validFrom: new Date(Date.now() - 60_000).toISOString(), validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    maxTasksPerRun: 2, maxContinuationsPerTask: 1, p2Continuations: 0, maxSubmissionsPerRun: 3,
    maxCampaignRuns: 2, maxCampaignSubmissions: 6, maxRunDurationMinutes: 60,
    automaticSuccessfulCloseout: true, uncertainSend: 'quarantine', identityConflict: 'quarantine',
    reviewRequiredBeforeDependentTask: true,
  };
  const policyDigest = autonomyPolicyDigest(policy);
  const input = { schema: 'flowdeck.autonomous-input/v1', projectId: ids.projectId,
    campaignRunId: ids.campaignRunId, policy, policyDigest };
  const workflowId = `flowdeck-production-${process.pid}-${Date.now()}`;
  const policyAuth = async () => ({ policy, project, task: project.tasks[0], planBytes, usage: { initialP1: 0, p1Continuations: 0, initialP2: 0, total: 0 } });
  const newTab = ownerId => {
    const n = tabs.size + 1;
    const tab = { id: `FLOWDECKTAB000000${String(n).padStart(4, '0')}`, ownerId,
      projectUrl: PROJECT, chatUrl: null, connector: 'Probe RemoteMCP2', composer: '',
      hydrated: true, projectTab: true, userTurns: [], responseFinished: false, assistantText: '' };
    tabs.set(tab.id, tab);
    return tab;
  };
  const makeChatUrl = n => `https://chatgpt.com/g/${new URL(PROJECT).pathname.split('/')[2]}/c/11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
  const initialBrowser = {
    createOwnedProjectTab: async ownerId => {
      const tab = newTab(ownerId);
      return { id: tab.id, type: 'page', url: PROJECT, webSocketDebuggerUrl: 'stateful-test-adapter' };
    },
    stage: async (tab, _url, prompt) => { tabs.get(tab.id).composer = composerPayloadFor(prompt); },
    matches: async (tab, _url, prompt) => tabs.get(tab.id)?.composer === composerPayloadFor(prompt),
    click: async (tab, _url, prompt) => { await clickTurn(tab.id, prompt); return true; },
    chat: async tabId => tabs.get(tabId)?.chatUrl ? { url: tabs.get(tabId).chatUrl, id: tabs.get(tabId).chatUrl.split('/').at(-1) } : null,
    firstUserTurn: async tabId => ({ matched: tabs.get(tabId)?.userTurns.length === 1, turnId: tabs.get(tabId)?.userTurns[0]?.id ?? null }),
  };
  let clickNo = 0;
  async function clickTurn(tabId, prompt) {
    state.browserCallsInFlight++;
    try {
    const tab = tabs.get(tabId);
    assert.ok(tab?.hydrated, 'fake browser tab must be hydrated before click');
    clickNo++;
    if (!tab.chatUrl) tab.chatUrl = makeChatUrl(clickNo);
    const stage = ['initial_p1', 'continue_p1', 'initial_p2'][clickNo - 1];
    const workId = `prod-work-${clickNo}-00000001`;
    const turn = { id: `prod-user-turn-${clickNo}`, text: composerPayloadFor(prompt) };
    tab.userTurns.push(turn);
    clicks.push({ stage, tabId, chatUrl: tab.chatUrl, turnId: turn.id });
    const startedAt = new Date(Date.now() + clickNo).toISOString();
    const reportedAt = new Date(Date.now() + 100 + clickNo).toISOString();
    const outcome = stage === 'initial_p1' ? 'partial' : 'success';
    sessions.set(stage, { workId, stage, taskId: stage === 'initial_p2' ? ids.p2 : ids.p1, startedAt, reportedAt });
    artifactWrites.push(delay(120).then(async () => {
      sourceReports.set(workId, { workId, ownerId: ids.ownerId, deviceId: ids.deviceId,
        state: 'reported', outcome, startedAt, reportedAt });
      sourceQueue.push(event(workId, 'work_started', 1, startedAt));
      sourceQueue.push(event(workId, 'work_reported', 2, reportedAt, outcome));
      tab.assistantText = stage === 'initial_p1'
        ? 'The first task is unfinished; I will continue it in the same conversation.\nFLOWDECK_STATUS: continue'
        : 'The approved implementation is complete.\nFLOWDECK_STATUS: implementation_done';
      tab.responseFinished = true;
      if (stage !== 'initial_p1') {
        const path = stage === 'initial_p2' ? artifactPaths[1] : artifactPaths[0];
        await mkdir(join(root, 'output'), { recursive: true });
        await writeFile(path, `${stage} artifact ${turn.id}\n`);
      }
    }));
    } finally { state.browserCallsInFlight--; }
  }

  const sourceQueue = [];
  let sourceWake;
  const source = { async *follow({ signal }) {
    while (!signal.aborted) {
      if (sourceQueue.length) { yield sourceQueue.shift(); continue; }
      await new Promise(resolveWake => {
        let poll;
        const finish = () => { clearInterval(poll); signal.removeEventListener('abort', finish); resolveWake(); };
        sourceWake = finish;
        signal.addEventListener('abort', finish, { once: true });
        poll = setInterval(() => { if (sourceQueue.length) finish(); }, 10);
      });
    }
  } };
  const wakeSource = () => { sourceWake?.(); sourceWake = null; };
  const originalPush = sourceQueue.push.bind(sourceQueue);
  sourceQueue.push = (...values) => { const n = originalPush(...values); wakeSource(); return n; };

  const campaign = createAutonomyCampaignStore(join(root, 'autonomy'));
  await campaign.initialize(policy);
  const scopes = createInitialScopeStore(join(root, 'autonomy'));
  const executionContext = () => {
    const temporal = Context.current();
    return { workflowExecution: temporal.info.workflowExecution, cancellationSignal: temporal.cancellationSignal };
  };
  const followupExecution = { workflowId, runId: 'set-by-activity', campaignRunId: ids.campaignRunId,
    projectId: ids.projectId, policyDigest };
  let actualRunId = null;
  const assertActivityExecution = c => {
    const current = executionContext().workflowExecution;
    if (c.workflowId !== current.workflowId || c.runId !== current.runId || (actualRunId && c.runId !== actualRunId))
      throw new Error('activity SDK execution differs from autonomous context');
  };
  const initialPorts = {
    root: join(root, 'autonomy'), scopes, authorize: async () => policyAuth(),
    browserFactory: () => initialBrowser, executionContext,
  };
  const provenance = createAutonomySendProvenanceStore(join(root, 'autonomy', 'send-provenance'));
  const followupBrowser = {
    observe: async tabId => tabs.get(tabId) ?? null,
    createOwnedProjectTab: async ownerId => newTab(ownerId),
    stage: async (tabId, prompt) => { tabs.get(tabId).composer = composerPayloadFor(prompt); },
    matches: async (tabId, prompt) => tabs.get(tabId)?.composer === composerPayloadFor(prompt),
    click: async (tabId, prompt) => {
      await clickTurn(tabId, prompt);
      if (scenario === 'lost_continuation_ack' && clicks.length === 2)
        throw Error('injected lost continuation click acknowledgement after append');
      return true;
    },
  };
  const followupsFor = context => createProductionFollowups({
    root: join(root, 'autonomy'), execution: { ...followupExecution, runId: context.runId },
    authorize: policyAuth, assertExecution: async () => assertActivityExecution(context),
    readOwnerClaim: async () => JSON.parse(await readFile(join(root, 'autonomy', 'browser-owner.lock'), 'utf8')),
    readPredecessor: async stage => predecessorReader(stage, context), browser: followupBrowser, campaign, provenance,
  });
  const bindingPath = workId => join(root, 'supervisor', `binding-${sha256(JSON.stringify([ids.projectId, workId]))}.json`);
  await mkdir(join(root, 'supervisor'), { recursive: true });
  const bindings = new Map();
  async function bindStage(stage, context, dispatchId) {
    const session = sessions.get(stage), click = clicks[stage === 'initial_p1' ? 0 : stage === 'continue_p1' ? 1 : 2];
    assert.ok(session && click, `click and session exist before binding ${stage}`);
    const binding = { workflowId, runId: context.runId, campaignRunId: ids.campaignRunId,
      projectId: ids.projectId, campaignId: ids.campaignId, taskId: session.taskId, stage,
      dispatchId, workId: session.workId, ownerId: ids.ownerId, deviceId: ids.deviceId,
      tabId: click.tabId, chatUrl: click.chatUrl, dispatchReconciled: true };
    bindings.set(stage, binding);
    await writeFile(bindingPath(session.workId), JSON.stringify({ binding }));
  }
  const inboxDir = join(root, 'inbox');
  let exactInbox;
  const ensureInbox = () => {
    if (!exactInbox) {
      if (!actualRunId) throw Error('Temporal run ID must be bound before source event admission');
      exactInbox = createPinnedProductionInbox({ directory: inboxDir, ownerId: ids.ownerId, deviceId: ids.deviceId,
        workflowId, runId: actualRunId,
        signal: async (target, row) => client.workflow.getHandle(target.workflowId, target.runId)
          .signal('flowdeckAutonomousWorkEventV1', row) });
    }
    return exactInbox;
  };
  const inbox = {
    ingest: (...args) => ensureInbox().ingest(...args),
    retryPending: (...args) => ensureInbox().retryPending(...args),
    status: (...args) => ensureInbox().status(...args),
  };
  const workflowSignal = async (target, row) => client.workflow.getHandle(target.workflowId, target.runId)
    .signal('flowdeckAutonomousWorkEventV1', row);
  // The same disk-backed, run-bound cursor implementation used by production.
  // Its seed is the explicit empty snapshot of this isolated synthetic source.
  const cursorPath = join(root, 'cursor.json');
  const cursorStore = createProductionSourceCursorStore(cursorPath);
  const cursorScope = runId => ({source:'remote-mcp-jazz',ownerId:ids.ownerId,
    deviceId:ids.deviceId,workflowId,runId});
  let sourceIndex = 0;
  const indexedSource = { async *follow(options) {
    for await (const row of source.follow(options)) yield { event: row, cursor: `cursor-${++sourceIndex}` };
  } };
  const sessionPorts = {
    readSourceReport: async (_c, stage) => {
      const session = sessions.get(stage); return session ? sourceReports.get(session.workId) ?? null : null;
    },
    readBinding: async (_c, stage) => bindings.get(stage) ?? null,
    readInboxEvents: async (_c, stage) => {
      const session = sessions.get(stage); if (!session) return null;
      const state = await ensureInbox().status();
      return Object.values(state.events).filter(x => x.event.workId === session.workId).map(x => ({ event: x.event, delivery: x.delivery }));
    },
    observeResponse: async (_c, stage, binding) => {
      const tab = tabs.get(binding.tabId); const session = sessions.get(stage);
      if (!tab || !session) return null;
      const marker = tab.assistantText.trim().split(/\r?\n/).at(-1);
      const decision = marker === 'FLOWDECK_STATUS: continue' ? 'continue'
        : marker === 'FLOWDECK_STATUS: implementation_done' ? 'implementation_done'
          : marker === 'FLOWDECK_STATUS: needs_attention' ? 'needs_attention' : 'unknown';
      return { workId: session.workId, taskId: binding.taskId, ownerId: ids.ownerId,
        deviceId: ids.deviceId, tabId: tab.id, chatUrl: tab.chatUrl, userTurns: tab.userTurns.length,
        turn: tab.responseFinished ? 'finished' : 'running', decision,
        strictCompletionMarker: marker === 'FLOWDECK_STATUS: implementation_done' };
    },
  };
  const sessionChecks = createProductionSessionChecks(sessionPorts);
  const predecessorReader = createProductionPredecessorReader({root:join(root, 'autonomy'),sessions:sessionPorts});
  const remainingFor = () => {
    return {
      validateAndClaim: async c => { assertActivityExecution(c); await campaign.readPolicy(policy); return { valid: true }; },
      awaitP1Events: c => sessionChecks.awaitP1Events(c),
      continueP1: async c => { assertActivityExecution(c); const r = await followupsFor(c).continueP1(); return { status: r.status === 'submitted' ? 'submitted' : r.status, reason: r.status === 'pending' ? 'continuation_pending' : undefined }; },
      reconcileContinuation: async c => { assertActivityExecution(c); const r = await followupsFor(c).reconcileContinuation(); if (r.status === 'reconciled') await bindStage('continue_p1', c, r.dispatchId); return { status: r.status }; },
      awaitP1Completion: c => sessionChecks.awaitP1Completion(c),
      submitP2: async c => { assertActivityExecution(c); const r = await followupsFor(c).submitP2(); return { status: r.status === 'submitted' ? 'submitted' : r.status, reason: r.status === 'pending' ? 'p2_pending' : undefined }; },
      reconcileP2: async c => { assertActivityExecution(c); const r = await followupsFor(c).reconcileP2(); if (r.status === 'reconciled') await bindStage('initial_p2', c, r.dispatchId); return { status: r.status }; },
      awaitP2Completion: c => sessionChecks.awaitP2Completion(c),
      closeout: async c => {
        assertActivityExecution(c);
        const [p1, p2] = await Promise.all([sessionChecks.awaitP1Completion(c), sessionChecks.awaitP2Completion(c)]);
        return p1.status === 'implementation_done' && p2.status === 'implementation_done'
          ? { status: 'closed' } : { status: 'blocked', reason: 'production_readiness_evidence_incomplete' };
      },
    };
  };
  const registry = createProductionRegistry({ initial: initialPorts,
    remaining: remainingFor(),
    assertExecution: c => assertActivityExecution(c),
  });
  // The workflow Activity SDK context is the binding authority. A fresh registry per activity
  // isn't necessary because all activities receive the context and the production ports re-check it.
  const activityRegistry = new Proxy(registry, { get(target, key) {
    const method = target[key]; if (typeof method !== 'function') return method;
    return async context => {
      state.activeActivities++;
      try {
      actualRunId ??= Context.current().info.workflowExecution.runId;
      assertActivityExecution(context);
      if (['reconcileInitialP1', 'reconcileContinuation', 'reconcileP2'].includes(String(key))) {
        const result = await method(context);
        if (result.status === 'reconciled') {
          if (key === 'reconcileInitialP1') {
            const scope = await scopes.readExact(context);
            await bindStage('initial_p1', context, sha256(JSON.stringify([policy.campaignId, context.runId, project.id, ids.p1])));
            assert.equal(scope.tabId, bindings.get('initial_p1').tabId);
          }
        }
        return result;
      }
      return await method(context);
      } finally { state.activeActivities--; }
    };
  } });

  const sourceAdapter = { async catchUp(){ if(sourceQueue.length) throw Error('initial fake source queue was not empty'); return {complete:true,events:[]}; }, async *follow(options) { yield* indexedSource.follow(options); } };
  let worker;
  let workerRun;
  // Disposable child is test-owned: macOS process observation and durable
  // predecessor evidence are real; this child is NOT the SDK worker/browser.
  let witnessChild = null, witnessExit = null, witnessIdentity = null;
  const processFence = createSenderProcessFence(join(root, 'sender-witness.json'));
  async function stopWitnessChild() {
    if (!witnessChild) return;
    if (witnessChild.exitCode === null && witnessChild.signalCode === null)
      witnessChild.kill('SIGTERM');
    await setTimeoutBounded(witnessExit, 5_000, 'owned witness child exit');
  }
  async function startWitnessChild(target) {
    if (witnessChild) return;
    const child = spawn(process.execPath, ['-e',
      "process.stdout.write('ready\\n');setInterval(()=>{},1000)"], {
      stdio:['ignore','pipe','ignore']});
    witnessChild = child;
    witnessExit = new Promise(resolveExit => {
      child.once('error', resolveExit);
      child.once('close', resolveExit);
    });
    await setTimeoutBounded(new Promise((resolveReady,rejectReady) => {
      child.once('error',rejectReady);
      child.stdout.once('data',data => String(data).includes('ready')
        ? resolveReady() : rejectReady(Error('owned child readiness mismatch')));
    }), 5_000, 'owned witness child ready');
    witnessIdentity = {...target,role:'worker',pid:child.pid};
    await processFence.registerExact(witnessIdentity);
    assert.equal(await processFence.inspectExact(witnessIdentity),'running');
  }

  let failFirstWorkerDrain = true;
  let runtime;
  t.after(async () => {
    if(runtime) await runtime.effects.stopFollower().catch(()=>undefined);
    await stopWitnessChild();
    if (worker) { if(worker.getState()==='RUNNING')worker.shutdown(); await workerRun.catch(() => undefined); worker = null; }
    await connection.close();
  });
  const workerActor = {
    async startOrAdoptExact(target) {
      if (worker) { assert.equal(target.workflowId, workflowId); return; }
      await startWitnessChild(target);
      worker = await Worker.create({ connection, namespace: 'default', taskQueue,
        workflowsPath: resolve('dist/flowdeck-autonomous-workflow.js'), activities: activityRegistry });
      workerRun = worker.run();
    },
    status: async () => worker ? 'running' : 'stopped',
    stopAndDrain: async () => {
      if (worker && failFirstWorkerDrain) { failFirstWorkerDrain = false; throw Error('injected worker drain failure'); }
      if (worker) { worker.shutdown(); await workerRun; worker = null; }
      await stopWitnessChild();
    },
  };
  const temporalIdentity = createTemporalIdentityEffects(client, { workflowId, taskQueue, input });
  const evidenceTemporal = createTemporalEvidenceClient(client);
  const controllerPath = join(root, 'controller.json');
  const ownerRoot = join(root, 'controller-owners');
  const runtimePorts = {
    effects: {
      authorize: async config => ({ allowed: true, policyDigest: autonomyPolicyDigest(config.policy) }),
      ...temporalIdentity,
      checkExisting: async request => {const found=await temporalIdentity.checkExisting(request);if(found.runId)actualRunId=found.runId;return found;},
      startExistingIdentity: async request => {
        const started=await temporalIdentity.startExistingIdentity(request);actualRunId=started.runId;
        await cursorStore.initializeExact(cursorScope(started.runId),null);
        return started;
      },
      status: async () => ({ workflowId }),
      verify: async () => {
        const handle = client.workflow.getHandle(workflowId, actualRunId ?? undefined);
        const description = await handle.describe();
        if (description.status.name !== 'COMPLETED') return { terminal: false, status: 'blocked', reason: 'workflow_running' };
        const result = await handle.result();
        return { terminal: true, status: result.status, reason: result.reason };
      },
      cancelWorkflow: async target => client.workflow.getHandle(target.workflowId, target.runId).cancel(),
      assertNoOutstandingEffects: async () => assert.equal(state.activeActivities + state.browserCallsInFlight, 0),
      verifyCloseoutReceipt: async (receipt, target) => {
        assert.equal(target.workflowId, workflowId);
        assert.equal(target.runId, actualRunId);
        assert.equal(sha256(await readFile(receipt.receiptPath)), receipt.receiptSha256);
      },
    },
    worker: workerActor,
    predecessors: { assertStoppedExact: async target => {
      assert.equal(target.workflowId,workflowId);
      assert.equal(target.runId,actualRunId);
      assert.ok(witnessIdentity, 'process witness must have been registered before activation');
      assert.equal(await workerActor.status(),'stopped');
      assert.ok(!worker || worker.getState() !== 'RUNNING', 'SDK worker must have completed shutdown');
      await processFence.assertStoppedExact(witnessIdentity);
    } },
    signalEvent: workflowSignal,
    source: sourceAdapter,
    inbox,
    cursor: cursorStore,
    ownership: createProductionFollowerOwnership(join(root, 'follower-owner.json')),
    evidence: async target => {
      const scope0 = await scopes.readExact({ ...input, ...target });
      const session0 = sessions.get('initial_p1'), session1 = sessions.get('continue_p1'), session2 = sessions.get('initial_p2');
      assert.ok(scope0 && session0 && session1 && session2);
      const journal1 = await provenance.readExact(`followup-${sha256(JSON.stringify([workflowId, target.runId, ids.campaignRunId, 'continue_p1']))}`);
      const journal2 = await provenance.readExact(`followup-${sha256(JSON.stringify([workflowId, target.runId, ids.campaignRunId, 'initial_p2']))}`);
      const claimPath = join(root, 'autonomy', 'browser-owner.lock');
      const claimBytes = await readFile(claimPath);
      const paths = { claim: claimPath, intent: join(root, 'closeout', 'intent.json'),
        archive: join(root, 'closeout', 'archive.json'), receipt: join(root, 'closeout', 'receipt.json'),
        lock: join(root, 'closeout', 'lock.json') };
      const manifest = {
        schema: 'flowdeck.autonomy-closeout-manifest/v1', workflowId, runId: target.runId,
        projectId: ids.projectId, campaignId: ids.campaignId, campaignRunId: ids.campaignRunId,
        policyDigest, terminalResult: { status: 'completed', businessResult: 'successfully_reconciled' },
        reservations: ['initial_p1', 'continue_p1', 'initial_p2'].map(kind => ({ kind, id: sha256(JSON.stringify([target.runId, kind])) })),
        sessions: [session0, session1, session2].map(s => ({ workId: s.workId, taskId: s.taskId })),
        journals: [
          { dispatchId: sha256(JSON.stringify([ids.campaignId, target.runId, ids.projectId, ids.p1])), promptHash: scope0.promptHash,
            tabId: scope0.tabId, chatUrl: bindings.get('initial_p1').chatUrl },
          { dispatchId: journal1.intent.dispatchId, promptHash: journal1.intent.promptHash,
            tabId: journal1.observation.tabId, chatUrl: journal1.observation.chatUrl },
          { dispatchId: journal2.intent.dispatchId, promptHash: journal2.intent.promptHash,
            tabId: journal2.observation.tabId, chatUrl: journal2.observation.chatUrl },
        ],
        artifacts: [],
        ownerClaimPath: claimPath, ownerClaimSha256: sha256(claimBytes), paths,
        ownerId: ids.ownerId, deviceId: ids.deviceId, taskIds: [ids.p1, ids.p2],
        policyPath: join(root, 'policy.json'), inboxDirectory: inboxDir,
        autonomyRoot: join(root, 'autonomy'), supervisorRoot: join(root, 'supervisor'),
      };
      await mkdir(join(root, 'closeout'), { recursive: true });
      await Promise.all(artifactWrites);
      for (const path of artifactPaths) manifest.artifacts.push({ path, sha256: sha256(await readFile(path)) });
      await writeFile(manifest.policyPath, JSON.stringify(policy));
      // This isolated test's sender process registry is the actual Temporal
      // worker actor; do not mistake unrelated host test commands for senders.
      // Controller drain also checks SDK Worker.run() completion and counters.
      const readers = createFilesystemEvidenceReaders(evidenceTemporal, async () => {
        const status=await workerActor.status();
        return status==='running'?[{pid:process.pid,command:'node flowdeck-autonomy-sender'}]:[];
      }, {
        readExact: async query => sourceReports.get(query.workId) ?? null,
      });
      return { manifest, readers };
    },
    inspectExactRun: async target => {
      const unresolvedDispatches = [];
      // The initial P1 producer owns the historical initial-dispatch journal;
      // subsequent producers own the new hash-linked send-provenance store.
      try {
        const initialScope = await scopes.readExact({ ...input, ...target });
        if (!initialScope || await createAutonomousInitialJournal(join(root, 'autonomy', 'initial-dispatches')).current(initialScope) !== 'reconciled')
          unresolvedDispatches.push('initial_p1');
      } catch { unresolvedDispatches.push('initial_p1'); }
      const dispatchIds = [
        `followup-${sha256(JSON.stringify([workflowId, target.runId, ids.campaignRunId, 'continue_p1']))}`,
        `followup-${sha256(JSON.stringify([workflowId, target.runId, ids.campaignRunId, 'initial_p2']))}`,
      ];
      for (const dispatchId of dispatchIds) {
        try { await provenance.readExact(dispatchId); }
        catch { unresolvedDispatches.push(dispatchId); }
      }
      return { activeActivities: state.activeActivities, browserCallsInFlight: state.browserCallsInFlight, unresolvedDispatches };
    },
  };
  runtime = createProductionRuntimeComposition(controllerPath, runtimePorts, ownerRoot);

  const controllerConfig = {
    schema: 'flowdeck.autonomy-controller-config/v1', policy, workflowId, runId: null,
    ownerScope: { ownerId: ids.ownerId, deviceId: ids.deviceId, worktree: root },
    follower: { schema: 'flowdeck.event-follower/v1', source: 'remote-mcp-jazz', ownerId: ids.ownerId,
      deviceId: ids.deviceId, cursorPath: join(root, 'cursor.json') },
    deadlineAt: new Date(Date.now() + 150_000).toISOString(), stopGraceMs: 5_000,
  };

  assert.equal(sourceQueue.length, 0, 'the source starts without preloaded future reports');
  const runDeadline = Date.now() + 150_000;
  let first;
  let sawShutdownUncertain = false;
  let recreatedAfterBusinessCompletion = false;
  do {
    first = await setTimeoutBounded(runtime.controller.execute(controllerConfig), 15_000, 'production controller probe');
    if (process.env.FLOWDECK_COMPOSITION_DEBUG === '1') console.error('composition controller:',first.manifest.state,first.manifest.failureReason,first.manifest.businessResult);
    if (first.manifest.state === 'retired') break;
    if (first.manifest.state === 'shutdown_uncertain') {
      sawShutdownUncertain = true;
      if (!recreatedAfterBusinessCompletion) {
        recreatedAfterBusinessCompletion = true;
        runtime = createProductionRuntimeComposition(controllerPath, runtimePorts, ownerRoot);
      }
    }
    if (['business_blocked', 'cancelled', 'closeout_blocked'].includes(first.manifest.state)) break;
    await delay(100);
  } while (Date.now() < runDeadline);
  if (scenario === 'lost_continuation_ack') {
    assert.equal(first.manifest.state, 'business_blocked', 'an uncertain external Send must block the run');
    assert.equal(clicks.length, 2, 'the continuation clicked once; no P2 Send is permitted');
    assert.equal(clicks.filter(x => x.stage === 'continue_p1').length, 1);
    assert.equal(first.manifest.closeoutReceipt, null, 'a failed workflow cannot be retired');
    const continuationId = `followup-${sha256(JSON.stringify([workflowId, first.manifest.runId, ids.campaignRunId, 'continue_p1']))}`;
    const attempted = await readFile(join(root, 'autonomy', 'send-provenance', continuationId + '.click_attempted.json'), 'utf8');
    assert.equal(JSON.parse(attempted).phase, 'click_attempted');
    assert.ok(await readFile(join(root, 'autonomy', 'browser-owner.lock'), 'utf8'), 'browser scope remains quarantined');
    return;
  }
  assert.equal(sawShutdownUncertain, true, 'the first post-business sender drain failure must remain resumable');
  assert.equal(recreatedAfterBusinessCompletion, true, 'the controller must resume from its durable business-completed phase');
  assert.equal(first.manifest.state, 'retired', first.manifest.failureReason ?? 'controller did not retire');
  assert.deepEqual(await client.workflow.getHandle(workflowId, first.manifest.runId).result(), {
    schema: 'flowdeck.autonomous-result/v1', workflowId, runId: first.manifest.runId,
    status: 'completed', reason: 'successfully_reconciled', submissions: 3,
  });
  assert.equal(clicks.length, 3);
  const diskCheckpoint = createProductionSourceCursorStore(cursorPath);
  await diskCheckpoint.bindExact(cursorScope(first.manifest.runId));
  assert.deepEqual(await diskCheckpoint.readExact(cursorScope(first.manifest.runId)),
    {cursor:`cursor-${sourceIndex}`}, 'same-run checkpoint must survive reconstruction');
  assert.equal(await processFence.inspectExact(witnessIdentity),'stopped');
  await assert.rejects(readFile(join(root,'follower-owner.json')),{code:'ENOENT'});
  assert.equal(clicks[0].tabId, clicks[1].tabId, 'P1 continuation must stay in the original tab');
  assert.equal(clicks[0].chatUrl, clicks[1].chatUrl, 'P1 continuation must stay in the original chat');
  assert.notEqual(clicks[2].tabId, clicks[1].tabId, 'P2 must use a different Project tab');
  assert.notEqual(clicks[2].chatUrl, clicks[1].chatUrl, 'P2 must use a different chat');
  const receiptBytes = await readFile(first.manifest.closeoutReceipt.receiptPath);
  assert.equal(sha256(receiptBytes), first.manifest.closeoutReceipt.receiptSha256);
  assert.equal(first.manifest.closeoutReceipt.receiptSha256, sha256(receiptBytes));

  const sendsBeforeRestart = clicks.length;
  runtime = createProductionRuntimeComposition(controllerPath, runtimePorts, ownerRoot);
  const restarted = await setTimeoutBounded(runtime.controller.execute({ ...controllerConfig, runId: first.manifest.runId }), 15_000, 'controller restart');
  assert.equal(restarted.manifest.state, 'retired');
  assert.deepEqual(restarted.manifest.closeoutReceipt, first.manifest.closeoutReceipt);
  assert.equal(clicks.length, sendsBeforeRestart, 'same-run receipt verification must not send again');

  // Explicit, local-only acceptance evidence export. The test still deletes its
  // isolated fake browser/source state, but the exact successful run and final
  // receipt stay auditable alongside read-only Temporal history replay.
  const evidenceDirectory = process.env.FLOWDECK_COMPOSITION_EVIDENCE_DIRECTORY;
  if (evidenceDirectory) {
    if (!isAbsolute(evidenceDirectory)) throw Error('acceptance evidence directory must be absolute');
    const history = await client.workflow.getHandle(workflowId, first.manifest.runId).fetchHistory();
    const evidence = {
      schema: 'flowdeck.production-composition-acceptance/v1',
      mode: 'real-temporal-stateful-fake-browser-and-source',
      liveBrowserSubmissions: 0,
      productionCursorPersisted: true,
      macOSProcessWitnessUsed: process.platform === 'darwin',
      workflowId, runId: first.manifest.runId,
      workflowType: 'flowdeckAutonomousLifecycleV1',
      historyEventCount: history.events.length,
      policyDigest,
      businessStatus: 'completed', submissions: 3,
      uniqueFakeClicks: clicks.length,
      tabRouting: {
        p1ContinuationSameTab: clicks[0].tabId === clicks[1].tabId,
        p1ContinuationSameChat: clicks[0].chatUrl === clicks[1].chatUrl,
        p2DistinctTab: clicks[2].tabId !== clicks[0].tabId,
        p2DistinctChat: clicks[2].chatUrl !== clicks[0].chatUrl,
      },
      shutdownFailureInjected: sawShutdownUncertain,
      shutdownResumedAfterRestart: recreatedAfterBusinessCompletion,
      controllerState: first.manifest.state,
      receiptSha256: sha256(receiptBytes),
      restartReceiptSha256: restarted.manifest.closeoutReceipt.receiptSha256,
      restartAdditionalClicks: clicks.length - sendsBeforeRestart,
    };
    await mkdir(evidenceDirectory, {recursive:true,mode:0o700});
    await writeFile(join(evidenceDirectory,'acceptance.json'), JSON.stringify(evidence,null,2)+'\n',
      {flag:'wx',mode:0o600});
    await writeFile(join(evidenceDirectory,'retirement-receipt.json'), receiptBytes,
      {flag:'wx',mode:0o600});
  }
}

test('same production composition completes three real Temporal sends and retires from collected evidence',
  { timeout: 180_000 }, t => runProductionComposition(t));

test('real Temporal lost continuation ACK makes no second click, no P2, and no retirement',
  { timeout: 180_000 }, t => runProductionComposition(t, 'lost_continuation_ack'));

test('production predecessor corruption prevents constructing followup authority', async () => {
  const reader = createProductionPredecessorReader({
    sessions: { readSourceReport: async () => null, readBinding: async () => null,
      readInboxEvents: async () => null, observeResponse: async () => null },
    root: join(tmpdir(), 'missing-flowdeck-predecessor-provenance'),
  });
  const context = { workflowId: 'workflow-12345678', runId: 'run-12345678', campaignRunId: 'campaign-12345678',
    projectId: ids.projectId, policyDigest: 'a'.repeat(64), policy: { campaignId: ids.campaignId,
      ownerId: ids.ownerId, deviceId: ids.deviceId, enabledTaskIds: [ids.p1], projectUrl: PROJECT } };
  assert.equal(await reader('initial_p1', context), null);
  let clicks = 0;
  if (await reader('initial_p1', context)) clicks++;
  assert.equal(clicks, 0);
});

test('production session checks reject duplicate, wrong-scope, undelivered, and upstream-mismatched events', async () => {
  const context = { schema: 'flowdeck.autonomous-input/v1', projectId: ids.projectId,
    campaignRunId: ids.campaignRunId, workflowId: 'workflow-negative-0001', runId: 'temporal-negative-0001',
    policyDigest: 'a'.repeat(64), policy: { campaignId: ids.campaignId, ownerId: ids.ownerId,
      deviceId: ids.deviceId, enabledTaskIds: [ids.p1, ids.p2],
      projectUrl: 'https://chatgpt.com/g/g-p-test/project' } };
  const startedAt = new Date().toISOString(), reportedAt = new Date(Date.now() + 1).toISOString();
  const started = { schema: 'remote-mcp.work-event/v1', source: 'remote-mcp-jazz', eventId: 'negative-start-01',
    workId: 'negative-work-0001', ownerId: ids.ownerId, deviceId: ids.deviceId, kind: 'work_started', revision: 1,
    sourceCommittedAt: startedAt, startedAt, timestampEvidence: 'recorded_in_source_transaction',
    completionEvidence: 'none', executionVerified: false, backgroundProcesses: 'unknown', origin: 'event' };
  const reported = { ...started, eventId: 'negative-report-01', kind: 'work_reported', revision: 2,
    sourceCommittedAt: reportedAt, reportedAt, completionEvidence: 'agent_report_only', outcome: 'partial' };
  const binding = { workflowId: context.workflowId, runId: context.runId, campaignRunId: context.campaignRunId,
    projectId: ids.projectId, campaignId: ids.campaignId, taskId: ids.p1, stage: 'initial_p1',
    dispatchId: 'negative-dispatch-0001', workId: started.workId, ownerId: ids.ownerId, deviceId: ids.deviceId,
    tabId: 'NEGATIVETAB0000001', chatUrl: 'https://chatgpt.com/g/g-p-test/c/negative-chat-01', dispatchReconciled: true };
  let source = { workId: started.workId, ownerId: ids.ownerId, deviceId: ids.deviceId,
    state: 'reported', outcome: 'partial', startedAt, reportedAt };
  let inboxRows = [{ event: started, delivery: 'delivered' }, { event: reported, delivery: 'delivered' }];
  let currentBinding = binding;
  let observation = { workId: started.workId, taskId: ids.p1, ownerId: ids.ownerId, deviceId: ids.deviceId,
    tabId: binding.tabId, chatUrl: binding.chatUrl, userTurns: 1, turn: 'finished', decision: 'continue', strictCompletionMarker: false };
  const checks = createProductionSessionChecks({ readSourceReport: async () => source,
    readBinding: async () => currentBinding, readInboxEvents: async () => inboxRows,
    observeResponse: async () => observation });
  assert.deepEqual(await checks.awaitP1Events(context), { status: 'reported' });
  inboxRows = [...inboxRows, { event: { ...reported, eventId: 'negative-report-duplicate' }, delivery: 'delivered' }];
  assert.equal((await checks.awaitP1Events(context)).status, 'blocked');
  inboxRows = [{ event: { ...started, ownerId: 'wrong-owner-0001' }, delivery: 'delivered' }, { event: reported, delivery: 'delivered' }];
  assert.equal((await checks.awaitP1Events(context)).status, 'blocked');
  inboxRows = [{ event: started, delivery: 'delivered' }, { event: reported, delivery: 'pending' }];
  assert.deepEqual(await checks.awaitP1Events(context), { status: 'pending' });
  inboxRows = [{ event: started, delivery: 'delivered' }, { event: reported, delivery: 'delivered' }];
  source = { ...source, outcome: 'success' };
  assert.equal((await checks.awaitP1Events(context)).status, 'blocked');
  source = { ...source, outcome: 'partial' };
  currentBinding = { ...binding, stage: 'initial_p2' };
  assert.equal((await checks.awaitP1Events(context)).status, 'blocked');
  currentBinding = binding;
  observation = { ...observation, turn: 'unknown' };
  assert.deepEqual(await checks.awaitP1Events(context), { status: 'pending' });
});
