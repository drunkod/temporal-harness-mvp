/** Guarded production transactions for continuation P1 and independent P2. */
import { createHash } from 'node:crypto';
import { lstat, open, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { composerPayloadFor, normalizeComposerText } from './sashai-dispatch-evidence.js';
import { autonomyPolicyDigest, reserveAutonomousSend, sha256, validateAutonomyPolicy,
  type AutonomyPolicyV1, type AutonomousUsage } from './flowdeck-autonomy-policy.js';
import { createAutonomyCampaignStore } from './flowdeck-autonomy-campaign.js';
import { autonomousSendPromptHash, createAutonomySendProvenanceStore,
  type AutonomousSendKind, type SendIntentV1 } from './flowdeck-autonomy-send-provenance.js';
import { supervisedTaskPrompt } from './flowdeck-supervisor-activities.js';
import type { ApprovedTask, SupervisorProject } from './flowdeck-projects.js';
import { PROJECT } from './sashai-live-browser.js';

export type FollowupStage = 'continue_p1' | 'initial_p2';
export interface FollowupExecution {
  workflowId: string; runId: string; campaignRunId: string; projectId: string; policyDigest: string;
}
export interface FollowupAuthorization {
  policy: AutonomyPolicyV1; project: SupervisorProject; planBytes: Buffer | string; usage: AutonomousUsage;
}
export interface FollowupOwnerClaim {
  schema: 'flowdeck.browser-owner/v1'; campaignId: string; runId: string;
  deviceId: string; profile: string; tabOwnerId: string;
}
export interface FollowupSessionPredecessor {
  schema: 'flowdeck.followup-predecessor/v1'; stage: 'initial_p1' | 'continue_p1';
  workflowId: string; runId: string; campaignRunId: string; campaignId: string; projectId: string;
  taskId: string; policyDigest: string; dispatchId: string; promptHash: string;
  tabId: string; chatUrl: string; userTurnId: string; observedUserTurns: number;
  workId: string; ownerId: string; deviceId: string; sourceState: 'reported';
  outcome: 'partial' | 'success' | 'failed'; turnFinished: boolean;
  decision: 'continue' | 'implementation_done' | 'needs_attention';
  exactBinding: boolean; exactDispatch: boolean; exactSession: boolean; conflict: boolean;
}
export interface FollowupBrowserTurn { id: string; text: string }
export interface FollowupBrowserTab {
  id: string; ownerId: string; projectUrl: string; chatUrl: string | null;
  connector: string | null; composer: string; hydrated: boolean; projectTab: boolean;
  userTurns: FollowupBrowserTurn[];
}
export interface FollowupBrowserSource {
  observe(tabId: string): Promise<FollowupBrowserTab | null>;
  createOwnedProjectTab(ownerId: string): Promise<FollowupBrowserTab>;
  stage(tabId: string, prompt: string): Promise<void>;
  matches(tabId: string, prompt: string): Promise<boolean>;
  click(tabId: string, prompt: string, deadline: number, checkFence: () => void): Promise<boolean>;
}
export interface ProductionFollowupPorts {
  root: string; execution: FollowupExecution; authorize(): Promise<FollowupAuthorization>;
  /** Re-reads the Activity SDK execution and cancellation signal; never trusts the context alone. */
  assertExecution(execution: FollowupExecution): Promise<void> | void;
  /** Reads the original durable browser-owner.lock. It never creates or replaces the claim. */
  readOwnerClaim(): Promise<FollowupOwnerClaim | null>;
  /** Must join initial/followup journal, source session, event inbox, and actual browser binding. */
  readPredecessor(stage: 'initial_p1' | 'continue_p1'): Promise<FollowupSessionPredecessor | null>;
  browser: FollowupBrowserSource;
  cancelled?(): boolean;
  campaign?: ReturnType<typeof createAutonomyCampaignStore>;
  provenance?: ReturnType<typeof createAutonomySendProvenanceStore>;
}
export interface FollowupSubmitResult {
  status: 'submitted' | 'pending' | 'reconciled'; dispatchId: string; submittedCount: number;
}
export interface FollowupReconcileResult {
  status: 'pending' | 'reconciled'; dispatchId: string;
}

type PartialDispatch = { intent: SendIntentV1; intentBytes: Buffer; phases: string[]; phaseBytes: Buffer[] };
const kinds: Record<FollowupStage, AutonomousSendKind> = { continue_p1: 'continue_p1', initial_p2: 'initial_p2' };
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const exactKeys = (value: unknown, names: string[]) => !!value && typeof value === 'object' && !Array.isArray(value) &&
  same(Object.keys(value).sort(), [...names].sort());
const id = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const tabId = /^[A-Z0-9]{16,128}$/i;
const dispatchKey = (e: FollowupExecution, stage: FollowupStage) =>
  `followup-${sha256(JSON.stringify([e.workflowId, e.runId, e.campaignRunId, stage]))}`;
const promptFor = (stage: FollowupStage, project: SupervisorProject, task: ApprovedTask) =>
  supervisedTaskPrompt(project, task, stage === 'continue_p1' ? 'continue' : 'initial');
const ownedFile = async (path: string) => {
  const st = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!st) return null;
  if (!st.isFile() || st.isSymbolicLink()) throw Error('followup journal record is not a regular file: quarantine');
  return readFile(path);
};

/**
 * The same guarded transaction is used for both followup stages. External ports
 * supply observations; this module alone persists autonomous provenance.
 */
export function createProductionFollowups(ports: ProductionFollowupPorts) {
  const root = resolve(ports.root);
  const campaign = ports.campaign ?? createAutonomyCampaignStore(root);
  const provenance = ports.provenance ?? createAutonomySendProvenanceStore(join(root, 'send-provenance'));
  const recordsRoot = resolve(provenance.root);
  const canceled = () => { if (ports.cancelled?.()) throw Error('followup dispatch canceled'); };
  const recordPath = (dispatchId: string, name: string) => join(recordsRoot, `${dispatchId}.${name}.json`);

  async function authorization(stage: FollowupStage) {
    canceled();
    await ports.assertExecution(ports.execution);
    const a = await ports.authorize();
    await ports.assertExecution(ports.execution);
    canceled();
    const p = validateAutonomyPolicy(a.policy, a.project, a.planBytes);
    const e = ports.execution;
    if (![e.workflowId, e.runId, e.campaignRunId, e.projectId].every(x => typeof x === 'string' && id.test(x)) ||
        e.projectId !== p.projectId || e.policyDigest !== autonomyPolicyDigest(p))
      throw Error('followup execution/policy identity mismatch: quarantine');
    if (a.project.projectUrl !== PROJECT || p.projectUrl !== PROJECT) throw Error('unsupported followup Project route');
    const task = stage === 'continue_p1'
      ? a.project.tasks.find(t => t.id === a.project.initialTaskId)
      : a.project.tasks.find(t => t.id === p.enabledTaskIds[1]);
    if (!task || !p.enabledTaskIds.includes(task.id) ||
        (stage === 'continue_p1' && task.id !== a.project.initialTaskId) ||
        (stage === 'initial_p2' && (task.id === a.project.initialTaskId || task.requiresReviewBeforeNext === true || (task.dependsOn?.length ?? 0) > 0)) ||
        !same(a.project.tasks.find(t => t.id === task.id), task))
      throw Error('followup task is not the exact approved independent task: quarantine');
    return { authorization: a, policy: p, project: a.project, task, prompt: promptFor(stage, a.project, task), digest: autonomyPolicyDigest(p) };
  }

  async function owner(p: AutonomyPolicyV1) {
    const claim = await ports.readOwnerClaim();
    if (!claim || !exactKeys(claim, ['schema', 'campaignId', 'runId', 'deviceId', 'profile', 'tabOwnerId']) ||
        claim.schema !== 'flowdeck.browser-owner/v1' || claim.campaignId !== p.campaignId ||
        claim.runId !== ports.execution.runId || claim.deviceId !== p.deviceId || claim.profile !== p.profile ||
        typeof claim.tabOwnerId !== 'string' || !id.test(claim.tabOwnerId))
      throw Error('same-run browser owner claim is absent or conflicting: quarantine');
    return claim;
  }

  async function predecessor(stage: FollowupStage, auth: Awaited<ReturnType<typeof authorization>>) {
    const priorStage = stage === 'continue_p1' ? 'initial_p1' : 'continue_p1';
    const prior = await ports.readPredecessor(priorStage);
    const expectedTask = stage === 'continue_p1' ? auth.project.initialTaskId : auth.policy.enabledTaskIds[0];
    const requiredOutcome = stage === 'continue_p1' ? 'partial' : 'success';
    const requiredDecision = stage === 'continue_p1' ? 'continue' : 'implementation_done';
    const expectedDispatch = stage === 'continue_p1'
      ? sha256(JSON.stringify([auth.policy.campaignId, ports.execution.runId, auth.policy.projectId, auth.project.initialTaskId]))
      : dispatchKey(ports.execution, 'continue_p1');
    const initialTask = auth.project.tasks.find(t => t.id === auth.project.initialTaskId)!;
    const expectedPriorPromptHash = autonomousSendPromptHash(supervisedTaskPrompt(auth.project, initialTask,
      stage === 'continue_p1' ? 'initial' : 'continue'));
    if (!prior || !exactKeys(prior, ['schema', 'stage', 'workflowId', 'runId', 'campaignRunId', 'campaignId', 'projectId',
      'taskId', 'policyDigest', 'dispatchId', 'promptHash', 'tabId', 'chatUrl', 'userTurnId', 'observedUserTurns', 'workId',
      'ownerId', 'deviceId', 'sourceState', 'outcome', 'turnFinished', 'decision', 'exactBinding', 'exactDispatch', 'exactSession', 'conflict']) ||
        prior.schema !== 'flowdeck.followup-predecessor/v1' || prior.stage !== priorStage ||
        prior.workflowId !== ports.execution.workflowId || prior.runId !== ports.execution.runId ||
        prior.campaignRunId !== ports.execution.campaignRunId || prior.campaignId !== auth.policy.campaignId ||
        prior.projectId !== auth.policy.projectId || prior.taskId !== expectedTask || prior.policyDigest !== auth.digest ||
        prior.dispatchId !== expectedDispatch || prior.promptHash !== expectedPriorPromptHash || !tabId.test(prior.tabId) ||
        !prior.chatUrl || !prior.userTurnId || !prior.workId || prior.ownerId !== auth.policy.ownerId ||
        prior.deviceId !== auth.policy.deviceId || prior.sourceState !== 'reported' || !prior.turnFinished ||
        prior.outcome !== requiredOutcome || prior.decision !== requiredDecision || !prior.exactBinding ||
        !prior.exactDispatch || !prior.exactSession || prior.conflict ||
        !Number.isSafeInteger(prior.observedUserTurns) || prior.observedUserTurns !== (stage === 'continue_p1' ? 1 : 2))
      throw Error('exact predecessor session binding is absent, incomplete, or conflicting: quarantine');
    return prior;
  }

  async function partial(dispatchId: string): Promise<PartialDispatch | null> {
    const rootStat = await lstat(recordsRoot).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink()))
      throw Error('send provenance root is not a real directory: quarantine');
    const names: string[] = await readdir(recordsRoot).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error));
    const known = new Set(['intent', 'staged', 'click_attempted', 'submitted', 'reconciled', 'observation', 'receipt']
      .map(name => `${dispatchId}.${name}.json`));
    if (names.some(name => name.startsWith(`${dispatchId}.`) && !known.has(name)))
      throw Error('unknown followup provenance record: quarantine');
    const intentBytes = await ownedFile(recordPath(dispatchId, 'intent'));
    if (!intentBytes) return null;
    let intent: SendIntentV1;
    try { intent = JSON.parse(intentBytes.toString('utf8')); }
    catch { throw Error('partial/unreadable followup intent: quarantine'); }
    if (!exactKeys(intent, ['schema', 'dispatchId', 'workflowId', 'runId', 'campaignId', 'campaignRunId', 'projectId', 'taskId',
      'kind', 'policyDigest', 'reservationId', 'promptHash', 'tabId', 'projectUrl', 'priorChatUrl', 'priorUserTurns']) ||
        intent.dispatchId !== dispatchId || intent.schema !== 'flowdeck.send-intent/v1')
      throw Error('followup intent identity changed: quarantine');
    const phases: string[] = [], phaseBytes: Buffer[] = [];
    for (const phase of ['staged', 'click_attempted', 'submitted', 'reconciled']) {
      const bytes = await ownedFile(recordPath(dispatchId, phase));
      if (!bytes) break;
      let rec: any;
      try { rec = JSON.parse(bytes.toString('utf8')); } catch { throw Error('partial followup phase: quarantine'); }
      if (rec.schema !== 'flowdeck.send-phase/v1' || rec.dispatchId !== dispatchId || rec.phase !== phase || rec.intentSha256 !== hash(intentBytes))
        throw Error('followup phase linkage changed: quarantine');
      phases.push(phase); phaseBytes.push(bytes);
    }
    const phaseNames = ['staged', 'click_attempted', 'submitted', 'reconciled']
      .filter(name => names.includes(`${dispatchId}.${name}.json`));
    if (!same(phaseNames, phases)) throw Error('followup phase journal has a gap: quarantine');
    for (const name of ['observation', 'receipt']) {
      const bytes = await ownedFile(recordPath(dispatchId, name));
      if (bytes && (!phases.includes(name === 'observation' ? 'click_attempted' : 'reconciled') ||
          (name === 'receipt' && !phases.includes('reconciled'))))
        throw Error('followup evidence precedes its phase journal: quarantine');
    }
    if (phases.length !== phaseBytes.length) throw Error('followup phase journal is ambiguous: quarantine');
    return { intent, intentBytes, phases, phaseBytes };
  }

  async function ensureReservation(stage: FollowupStage, p: AutonomyPolicyV1) {
    const reservations = await campaign.reservations(p);
    const run = reservations.filter(r => r.runId === ports.execution.runId);
    const order: AutonomousSendKind[] = ['initial_p1', 'continue_p1', 'initial_p2'];
    run.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    const expectedKinds = stage === 'continue_p1' ? ['initial_p1'] : ['initial_p1', 'continue_p1'];
    const expectedWithStage = [...expectedKinds, ...(run.some(r => r.kind === kinds[stage]) ? [kinds[stage]] : [])];
    if (!same(run.map(r => r.kind), expectedWithStage)) throw Error('durable campaign sequence does not prove this followup: quarantine');
    const existing = run.find(r => r.kind === kinds[stage]);
    if (existing) return false;
    const usage: AutonomousUsage = { initialP1: run.filter(r => r.kind === 'initial_p1').length,
      p1Continuations: run.filter(r => r.kind === 'continue_p1').length,
      initialP2: run.filter(r => r.kind === 'initial_p2').length,
      total: run.length };
    const verdict = reserveAutonomousSend(p, usage, kinds[stage]);
    if (!verdict.allowed) throw Error('followup policy reservation refused: ' + verdict.reason);
    await campaign.reserve(p, ports.execution.runId, kinds[stage]);
    return true;
  }

  async function persistIntent(stage: FollowupStage, auth: Awaited<ReturnType<typeof authorization>>,
    prior: Pick<FollowupSessionPredecessor, 'tabId' | 'chatUrl' | 'observedUserTurns'>, tab: FollowupBrowserTab) {
    const dispatchId = dispatchKey(ports.execution, stage);
    const intent: SendIntentV1 = Object.freeze({ schema: 'flowdeck.send-intent/v1', dispatchId,
      workflowId: ports.execution.workflowId, runId: ports.execution.runId, campaignId: auth.policy.campaignId,
      campaignRunId: ports.execution.campaignRunId, projectId: auth.policy.projectId, taskId: auth.task.id,
      kind: kinds[stage], policyDigest: auth.digest,
      reservationId: sha256(JSON.stringify([ports.execution.runId, kinds[stage]])),
      promptHash: autonomousSendPromptHash(auth.prompt), tabId: tab.id, projectUrl: PROJECT,
      priorChatUrl: stage === 'continue_p1' ? prior.chatUrl : null,
      priorUserTurns: stage === 'continue_p1' ? prior.observedUserTurns : 0 });
    const old = await partial(dispatchId);
    if (old) {
      if (!same(old.intent, intent)) throw Error('stable followup dispatch identity changed: quarantine');
      return old;
    }
    const campaignRecords = await campaign.reservations(auth.policy);
    const reservation = campaignRecords.find(r => r.runId === ports.execution.runId && r.kind === kinds[stage]);
    if (!reservation) throw Error('followup reservation absent before intent persistence: quarantine');
    await provenance.putIntent(intent);
    return (await partial(dispatchId))!;
  }

  function validateStoredIntent(stage: FollowupStage, state: PartialDispatch,
    auth: Awaited<ReturnType<typeof authorization>>, prior: Pick<FollowupSessionPredecessor, 'tabId' | 'chatUrl' | 'observedUserTurns'>) {
    const intent = state.intent;
    const exact = intent.schema === 'flowdeck.send-intent/v1' && intent.dispatchId === dispatchKey(ports.execution, stage) &&
      intent.workflowId === ports.execution.workflowId && intent.runId === ports.execution.runId &&
      intent.campaignRunId === ports.execution.campaignRunId && intent.campaignId === auth.policy.campaignId &&
      intent.projectId === auth.policy.projectId && intent.taskId === auth.task.id && intent.kind === kinds[stage] &&
      intent.policyDigest === auth.digest &&
      intent.reservationId === sha256(JSON.stringify([ports.execution.runId, kinds[stage]])) &&
      intent.promptHash === autonomousSendPromptHash(auth.prompt) && intent.projectUrl === PROJECT && tabId.test(intent.tabId) &&
      (stage === 'continue_p1'
        ? intent.tabId === prior.tabId && intent.priorChatUrl === prior.chatUrl && intent.priorUserTurns === prior.observedUserTurns
        : intent.tabId !== prior.tabId && intent.priorChatUrl === null && intent.priorUserTurns === 0);
    if (!exact) throw Error('stored followup intent differs from exact current authority: quarantine');
  }

  async function observeAndReconcile(dispatchId: string): Promise<FollowupReconcileResult> {
    const state = await partial(dispatchId);
    if (!state || !state.phases.includes('click_attempted')) throw Error('followup click barrier absent: quarantine');
    const intent = state.intent;
    const stage: FollowupStage = intent.kind === 'continue_p1' ? 'continue_p1' : 'initial_p2';
    const auth = await authorization(stage);
    const claim = await owner(auth.policy);
    // The predecessor response is legitimately replaced by the continuation's
    // second turn. The immutable click_attempted barrier proves the pre-click
    // predecessor check occurred; after it, observe only the existing dispatch.
    const prior = stage === 'continue_p1'
      ? { tabId: intent.tabId, chatUrl: intent.priorChatUrl!, observedUserTurns: intent.priorUserTurns }
      : await predecessor(stage, auth);
    validateStoredIntent(stage, state, auth, prior);
    const tab = await ports.browser.observe(intent.tabId);
    if (!tab) return { status: 'pending', dispatchId };
    if (tab.id !== intent.tabId || tab.ownerId !== claim.tabOwnerId ||
        !tab.projectTab || tab.projectUrl !== PROJECT) throw Error('followup tab ownership/Project mismatch: quarantine');
    const prompt = auth.prompt;
    if (autonomousSendPromptHash(prompt) !== intent.promptHash) throw Error('followup prompt changed during observation: quarantine');
    const chatUrl = tab.chatUrl;
    const turns = tab.userTurns;
    if (!chatUrl || !turns || turns.length !== intent.priorUserTurns + 1) return { status: 'pending', dispatchId };
    if (intent.kind === 'continue_p1' && chatUrl !== intent.priorChatUrl) throw Error('continuation changed its original P1 chat: quarantine');
    if (intent.kind === 'initial_p2' && (turns.length !== 1 || tab.id === prior.tabId || chatUrl === prior.chatUrl))
      throw Error('P2 did not use a distinct new Project chat: quarantine');
    const turn = turns.at(-1)!;
    if (!turn.id || normalizeComposerText(turn.text) !== composerPayloadFor(prompt)) return { status: 'pending', dispatchId };
    const observation = { schema: 'flowdeck.send-observation/v1' as const, dispatchId,
      intentSha256: hash(state.intentBytes), observedPromptHash: intent.promptHash, tabId: tab.id,
      chatUrl, userTurnId: turn.id, observedUserTurns: turns.length };
    const priorObservation = await ownedFile(recordPath(dispatchId, 'observation'));
    if (!priorObservation) await provenance.putObservation(observation);
    else if (!same(JSON.parse(priorObservation.toString('utf8')), observation)) throw Error('followup observation changed: quarantine');
    if (!state.phases.includes('submitted')) {
      if (state.phases.at(-1) !== 'click_attempted') throw Error('followup phase is ambiguous after click barrier: quarantine');
      await provenance.recordPhase(dispatchId, 'submitted');
    }
    const after = await partial(dispatchId);
    if (!after!.phases.includes('reconciled')) await provenance.reconcile(dispatchId);
    else await provenance.readExact(dispatchId);
    return { status: 'reconciled', dispatchId };
  }

  async function transact(stage: FollowupStage): Promise<FollowupSubmitResult> {
    const auth = await authorization(stage);
    const claim = await owner(auth.policy);
    const dispatchId = dispatchKey(ports.execution, stage);
    const existing = await partial(dispatchId);
    // After a durable attempt, a changed browser response is expected, not
    // authorization for a new Send. Re-verify exact sealed intent below.
    const prior = stage === 'continue_p1' && existing?.phases.includes('click_attempted')
      ? { tabId: existing.intent.tabId, chatUrl: existing.intent.priorChatUrl!,
          observedUserTurns: existing.intent.priorUserTurns }
      : await predecessor(stage, auth);
    const reservations = await campaign.reservations(auth.policy);
    const reserved = reservations.some(r => r.runId === ports.execution.runId && r.kind === kinds[stage]);
    if (existing && !reserved) throw Error('followup dispatch exists without durable campaign reservation: quarantine');
    if (!existing && reserved) throw Error('reservation exists without recoverable followup intent: quarantine');
    if (existing) validateStoredIntent(stage, existing, auth, prior);

    if (existing?.phases.includes('click_attempted')) {
      const reconciled = await observeAndReconcile(dispatchId);
      return { status: reconciled.status, dispatchId, submittedCount: 0 };
    }

    const tab = existing
      ? await ports.browser.observe(existing.intent.tabId)
      : stage === 'continue_p1'
        ? await ports.browser.observe(prior.tabId)
        : await ports.browser.createOwnedProjectTab(claim.tabOwnerId);
    if (!tab || tab.id !== (stage === 'continue_p1' ? prior.tabId : tab.id) || !tabId.test(tab.id) ||
        tab.ownerId !== claim.tabOwnerId || !tab.projectTab || tab.projectUrl !== PROJECT || !tab.hydrated)
      throw Error('followup destination is not an exact owned hydrated Project tab: quarantine');
    if (stage === 'continue_p1') {
      if (tab.chatUrl !== prior.chatUrl || tab.userTurns.length !== prior.observedUserTurns)
        throw Error('continuation destination is not the original P1 tab/chat/turn count: quarantine');
    } else if (tab.chatUrl !== null || tab.userTurns.length !== 0 || tab.id === prior.tabId ||
        (existing && tab.id !== existing.intent.tabId)) {
      throw Error('P2 destination must be a distinct owned empty Project tab: quarantine');
    }

    await ensureReservation(stage, auth.policy);
    const state = existing ?? await persistIntent(stage, auth, prior, tab);
    if (state.phases.includes('staged')) {
      // A staged but not attempted dispatch can be safely re-staged after exact fences.
      await authorization(stage); canceled();
      await ports.browser.stage(tab.id, auth.prompt);
    } else {
      await ports.browser.stage(tab.id, auth.prompt);
      await provenance.recordPhase(dispatchId, 'staged');
    }
    await authorization(stage); canceled();
    const live = await ports.browser.observe(tab.id);
    if (!live || live.id !== tab.id || live.ownerId !== claim.tabOwnerId || live.projectUrl !== PROJECT ||
        !live.hydrated || live.chatUrl !== tab.chatUrl || !await ports.browser.matches(tab.id, auth.prompt) ||
        normalizeComposerText(live.composer) !== composerPayloadFor(auth.prompt))
      throw Error('followup staged composer/tab mismatch: quarantine');
    await authorization(stage); await owner(auth.policy); canceled();
    await provenance.recordPhase(dispatchId, 'click_attempted');
    // Revalidate after the durable barrier and immediately before the one click.
    await authorization(stage); await owner(auth.policy); canceled();
    const clicked = await ports.browser.click(tab.id, auth.prompt, Date.now() + 10_000, canceled);
    if (clicked !== true) throw Error('followup click uncertain; click_attempted retained, never resend');
    const reconciled = await observeAndReconcile(dispatchId);
    return { status: reconciled.status === 'reconciled' ? 'submitted' : 'pending', dispatchId, submittedCount: 1 };
  }

  async function reconcile(stage: FollowupStage): Promise<FollowupReconcileResult> {
    const auth = await authorization(stage);
    await owner(auth.policy);
    const dispatchId = dispatchKey(ports.execution, stage);
    return observeAndReconcile(dispatchId);
  }

  return {
    continueP1: () => transact('continue_p1'),
    reconcileContinuation: () => reconcile('continue_p1'),
    submitP2: () => transact('initial_p2'),
    reconcileP2: () => reconcile('initial_p2'),
  };
}
