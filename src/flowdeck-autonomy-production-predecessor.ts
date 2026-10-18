import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProductionSessionChecks, type ProductionSessionPorts, type ProductionSessionStage, type ProductionSessionBinding, type SourceWorkReport, type ProductionResponseObservation } from './flowdeck-autonomy-production-sessions.js';
import type { AutonomousExecutionContext } from './flowdeck-autonomous-workflow.js';
import type { FollowupSessionPredecessor } from './flowdeck-autonomy-production-followups.js';
import { createAutonomySendProvenanceStore } from './flowdeck-autonomy-send-provenance.js';
import { autonomyPolicyDigest, sha256 } from './flowdeck-autonomy-policy.js';
import { createInitialScopeStore } from './flowdeck-autonomy-production-activities.js';
import { createAutonomousInitialJournal, initialDispatchKey } from './flowdeck-autonomy-initial-send.js';
import { composerPayloadFor, normalizeComposerText } from './sashai-dispatch-evidence.js';

export type ProductionPredecessorStage = 'initial_p1' | 'continue_p1';
export interface ProductionPredecessorPorts {
  root: string;
  sessions: ProductionSessionPorts;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'));

export function createProductionPredecessorReader(ports: ProductionPredecessorPorts) {
  const provenance = createAutonomySendProvenanceStore(join(ports.root, 'send-provenance'));
  const scopes = createInitialScopeStore(ports.root);
  const initialJournal = createAutonomousInitialJournal(join(ports.root, 'initial-dispatches'));
  return async function readPredecessor(stage: ProductionPredecessorStage, context: AutonomousExecutionContext): Promise<FollowupSessionPredecessor | null> {
    if (context.policyDigest !== autonomyPolicyDigest(context.policy) || context.projectId !== context.policy.projectId) return null;
    let source: SourceWorkReport | null, binding: ProductionSessionBinding | null;
    let inbox: Awaited<ReturnType<ProductionSessionPorts['readInboxEvents']>>;
    let observation: ProductionResponseObservation | null;
    [source, binding, inbox] = await Promise.all([
      ports.sessions.readSourceReport(context, stage), ports.sessions.readBinding(context, stage), ports.sessions.readInboxEvents(context, stage),
    ]);
    if (!binding || inbox === null || !source) return null;
    const snapshotPorts: ProductionSessionPorts = {
      readSourceReport: async () => source, readBinding: async () => binding, readInboxEvents: async () => inbox,
      observeResponse: async () => observation,
    };
    observation = await ports.sessions.observeResponse(context, stage, binding);
    const verdict = await createProductionSessionChecks(snapshotPorts).check(context, stage as ProductionSessionStage);
    if (verdict.status !== (stage === 'initial_p1' ? 'reported' : 'implementation_done')) return null;

    let dispatchId: string, promptHash: string, tabId: string, chatUrl: string, userTurnId: string, observedUserTurns: number;
    // Both predecessor stages require independently reconciled initial P1 provenance.
    {
      const scope = await scopes.readExact(context);
      if (!scope || scope.runId !== context.runId || scope.campaignId !== context.policy.campaignId ||
          scope.projectId !== context.projectId || scope.taskId !== context.policy.enabledTaskIds[0] ||
          scope.policyDigest !== context.policyDigest || scope.projectUrl !== context.policy.projectUrl ||
          scope.worktree !== context.policy.worktree) return null;
      const promptRecord = await readJson(join(ports.root, 'initial-prompts', `${initialDispatchKey(scope)}.json`));
      if (promptRecord.schema !== 'flowdeck.initial-prompt/v1' || !equal(promptRecord.scope, scope) ||
          scope.promptHash !== sha256(normalizeComposerText(composerPayloadFor(promptRecord.prompt)))) return null;
      if (await initialJournal.current(scope) !== 'reconciled') return null;
      const record = await readJson(join(ports.root, 'initial-observations', `${sha256(JSON.stringify([scope.campaignId, scope.runId, scope.taskId]))}.json`));
      if (record.schema !== 'flowdeck.initial-observation/v1' || !equal(record.scope, scope) || record.userPromptHash !== scope.promptHash || !record.turnId) return null;
      dispatchId = sha256(JSON.stringify([scope.campaignId, scope.runId, scope.projectId, scope.taskId]));
      promptHash = scope.promptHash; tabId = scope.tabId; chatUrl = record.chatUrl; userTurnId = record.turnId; observedUserTurns = 1;
      if(stage === 'continue_p1') {
        const initialTab = tabId, initialChat = chatUrl;
        dispatchId = `followup-${sha256(JSON.stringify([context.workflowId, context.runId, context.campaignRunId, 'continue_p1']))}`;
        const sentRecord = await provenance.readExact(dispatchId);
        const intent = sentRecord.intent, sent = sentRecord.observation;
        if (intent.workflowId !== context.workflowId || intent.runId !== context.runId || intent.campaignRunId !== context.campaignRunId ||
            intent.campaignId !== context.policy.campaignId || intent.projectId !== context.projectId ||
            intent.taskId !== context.policy.enabledTaskIds[0] || intent.kind !== 'continue_p1' ||
            intent.policyDigest !== context.policyDigest || intent.dispatchId !== dispatchId ||
            intent.projectUrl !== context.policy.projectUrl || intent.priorUserTurns !== 1 ||
            intent.priorChatUrl !== initialChat || intent.tabId !== initialTab ||
            sent.chatUrl !== initialChat || sent.tabId !== initialTab || sent.observedUserTurns !== 2 ||
            intent.reservationId !== sha256(JSON.stringify([context.runId, 'continue_p1']))) return null;
        promptHash = intent.promptHash; tabId = sent.tabId; chatUrl = sent.chatUrl;
        userTurnId = sent.userTurnId; observedUserTurns = sent.observedUserTurns;
      }
    }
    if (binding.dispatchId !== dispatchId || binding.tabId !== tabId || binding.chatUrl !== chatUrl ||
        observation?.workId !== binding.workId || observation.tabId !== tabId || observation.chatUrl !== chatUrl ||
        observation.userTurns !== observedUserTurns || !userTurnId ||
        observation.turn !== 'finished' ||
        observation.decision !== (stage === 'initial_p1' ? 'continue' : 'implementation_done') ||
        source.state !== 'reported' || source.outcome !== (stage === 'initial_p1' ? 'partial' : 'success')) return null;
    const outcome = stage === 'initial_p1' ? 'partial' : 'success';
    const decision = stage === 'initial_p1' ? 'continue' : 'implementation_done';
    return { schema: 'flowdeck.followup-predecessor/v1', stage, workflowId: context.workflowId,
      runId: context.runId, campaignRunId: context.campaignRunId, campaignId: context.policy.campaignId,
      projectId: context.projectId, taskId: context.policy.enabledTaskIds[0], policyDigest: context.policyDigest,
      dispatchId, promptHash, tabId, chatUrl, userTurnId, observedUserTurns, workId: binding.workId,
      ownerId: binding.ownerId, deviceId: binding.deviceId, sourceState: 'reported', outcome,
      turnFinished: true, decision, exactBinding: true, exactDispatch: true, exactSession: true, conflict: false };
  };
}
