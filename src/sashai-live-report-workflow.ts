import {defineQuery, proxyActivities, setHandler, sleep} from '@temporalio/workflow';
import type {LiveAttempt, LiveClaims, LiveObserved, LiveReceipt, LiveSendReceipt} from './sashai-live-report-activities.js';

const taskId = 'sashai-task-routing-report-live-v1';
const output = '/Users/test/Documents/work/temporal-harness-mvp/docs/SASHAI-BROWSER-TASK-ROUTING-REVIEW-2026-10-15.md';
const project = 'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project';
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Type-only boundary: importing browser activities into a workflow bundle is unsafe.
interface LiveActivities {
  prepareLiveAttempt(expectedContractSha256: string): Promise<LiveAttempt>;
  submitLiveOnce(a: LiveAttempt): Promise<LiveSendReceipt>;
  observeLive(a: LiveAttempt, claims: LiveClaims): Promise<LiveObserved>;
  verifyLiveReport(a: LiveAttempt, claims: LiveClaims): Promise<LiveReceipt>;
  correctLiveOnce(a: LiveAttempt, failedReceipt: LiveReceipt, claims: LiveClaims): Promise<LiveSendReceipt>;
  reconcileLiveSend(a: LiveAttempt, phase: 'initial' | 'correction'): Promise<{
    claimed: boolean; claimMatched: boolean; chat: string | null;
  }>;
  recordLiveAcceptance(a: LiveAttempt, receipt: LiveReceipt, claims: LiveClaims): Promise<void>;
}
const activities = proxyActivities<LiveActivities>({
  startToCloseTimeout: '2 minutes',
  scheduleToCloseTimeout: '2 minutes',
  retry: {maximumAttempts: 1},
});

export interface LiveReportState {
  stage: string;
  taskId: string;
  attemptId: string | null;
  contractSha256: string;
  output: string;
  sourceFingerprint: string | null;
  chat: string | null;
  artifactSha256: string | null;
  initialReceipt: LiveReceipt | null;
  finalReceipt: LiveReceipt | null;
  initialSendClaimed: boolean;
  correctionClaimed: boolean;
  initialClaimSha256: string | null;
  correctionClaimSha256: string | null;
  correctionAttempted: boolean;
  polls: {initial: number; correction: number};
  reconciliation: {phase: 'initial' | 'correction'; claimed: boolean; claimMatched: boolean; chat: string | null} | null;
  missing: string[];
  dispatchPermitted: false;
  nextTaskPermitted: false;
}
export const liveReportQuery = defineQuery<LiveReportState>('liveSashaiReportStatus');

/** One approved report exercise, not a general task dispatcher. No resume/send signals. */
export async function liveSashaiReportLifecycle(expectedContractSha256: string): Promise<LiveReportState> {
  const state: LiveReportState = {
    stage: 'preparing_durable_attempt', taskId, attemptId: null,
    contractSha256: expectedContractSha256, output, sourceFingerprint: null,
    chat: null, artifactSha256: null, initialReceipt: null, finalReceipt: null,
    initialSendClaimed: false, correctionClaimed: false, correctionAttempted: false,
    initialClaimSha256: null, correctionClaimSha256: null,
    polls: {initial: 0, correction: 0}, reconciliation: null, missing: [],
    dispatchPermitted: false, nextTaskPermitted: false,
  };
  const snapshot = (): LiveReportState => ({
    ...state, polls: {...state.polls}, missing: [...state.missing],
    reconciliation: state.reconciliation ? {...state.reconciliation} : null,
    initialReceipt: state.initialReceipt ? {...state.initialReceipt, missing: [...state.initialReceipt.missing]} : null,
    finalReceipt: state.finalReceipt ? {...state.finalReceipt, missing: [...state.finalReceipt.missing]} : null,
  });
  setHandler(liveReportQuery, snapshot);
  const block = (reason: string): LiveReportState => {
    state.stage = 'blocked';
    state.missing.push(reason);
    return snapshot();
  };
  if (!sha256(expectedContractSha256)) return block('invalid_expected_contract_sha256');

  let attempt: LiveAttempt;
  try {
    attempt = await activities.prepareLiveAttempt(expectedContractSha256);
  } catch {
    return block('prepare_failed_no_send');
  }
  if (attempt.taskId !== taskId || attempt.contractSha256 !== expectedContractSha256 ||
      attempt.output !== output || attempt.project !== project || attempt.approval !== 'report-only' ||
      !attempt.attemptId || !attempt.tabId || attempt.chatUrl !== null ||
      !sha256(attempt.source?.fingerprintSha256)) return block('attempt_identity_mismatch');
  state.attemptId = attempt.attemptId;
  state.sourceFingerprint = attempt.source.fingerprintSha256;

  let claims: LiveClaims;
  const reconcile = async (phase: 'initial' | 'correction'): Promise<LiveReportState> => {
    state.stage = 'reconciling_unknown_' + phase + '_send';
    try {
      const result = await activities.reconcileLiveSend(attempt, phase);
      state.reconciliation = {phase, ...result};
      if (phase === 'initial') state.initialSendClaimed = result.claimed;
      else state.correctionClaimed = result.claimed;
      if (!result.claimMatched) state.missing.push('send_claim_identity_mismatch');
      if (state.chat && result.chat !== state.chat) state.missing.push('reconciliation_chat_mismatch');
      if (!state.chat && result.chat) state.chat = result.chat;
    } catch {
      state.missing.push('reconciliation_failed');
    }
    // A matching write-ahead claim is not proof of a successful click. Never resend.
    return block(phase + '_send_outcome_indeterminate');
  };
  const observe = async (phase: 'initial' | 'correction'): Promise<boolean> => {
    state.stage = 'observing_' + phase;
    for (let poll = 0; poll < 60; poll++) {
      if (poll > 0) await sleep('5 seconds');
      state.polls[phase]++;
      const observed = await activities.observeLive(attempt, claims);
      if (state.chat && observed.chat !== state.chat) {
        state.missing.push('observed_chat_identity_changed');
        return false;
      }
      if (observed.chat) state.chat = observed.chat;
      if (observed.artifactExists) {
        if (!sha256(observed.artifactSha256)) {
          state.missing.push('observed_artifact_hash_missing');
          return false;
        }
        // A connector may write the report in chunks while its turn is active.
        // Freeze the accepted version only after stable finished observations.
        state.artifactSha256 = observed.artifactSha256;
      } else if (state.artifactSha256) {
        state.missing.push('observed_artifact_disappeared');
        return false;
      }
      const correctionChanged = phase === 'initial' ||
        observed.artifactSha256 !== state.initialReceipt?.artifactSha256;
      if (observed.turn === 'turn_finished' && observed.stable === true &&
          observed.artifactExists && state.chat && correctionChanged) return true;
    }
    state.missing.push(phase + '_observation_limit_reached');
    return false;
  };
  const receiptMatches = (receipt: LiveReceipt): boolean =>
    receipt.taskId === attempt.taskId && receipt.attemptId === attempt.attemptId &&
    receipt.contractSha256 === expectedContractSha256 && receipt.artifactPath === attempt.output &&
    state.chat !== null && receipt.chat === state.chat &&
    receipt.sourceFingerprint === attempt.source.fingerprintSha256 &&
    receipt.initialClaimSha256 === claims.initial &&
    receipt.correctionClaimSha256 === (claims.correction ?? null) &&
    sha256(receipt.artifactSha256) && receipt.artifactSha256 === state.artifactSha256 &&
    receipt.observedConnector === true;

  state.stage = 'sending_initial_once';
  try {
    const sent = await activities.submitLiveOnce(attempt);
    if (sent?.state !== 'clicked' || !sha256(sent.claimSha256)) return await reconcile('initial');
    claims = Object.freeze({initial: sent.claimSha256});
    state.initialClaimSha256 = claims.initial;
    state.initialSendClaimed = true;
  } catch {
    return await reconcile('initial');
  }
  try {
    if (!await observe('initial')) return block('initial_observation_blocked');
    state.stage = 'verifying_initial_report';
    const initial = await activities.verifyLiveReport(attempt, claims);
    state.initialReceipt = initial;
    if (!receiptMatches(initial)) return block('initial_receipt_identity_or_evidence_mismatch');
    // The approved exercise intentionally requires precisely this initial rejection.
    if (initial.accepted !== false || initial.missing.length !== 1 || initial.missing[0] !== 'evidence_index_missing') {
      state.missing.push(...initial.missing);
      return block('initial_verifier_unexpected_state');
    }
    state.stage = 'correcting_evidence_index_once';
    state.correctionAttempted = true;
    try {
      const sent = await activities.correctLiveOnce(attempt, initial, claims);
      if (sent?.state !== 'clicked' || !sha256(sent.claimSha256)) return await reconcile('correction');
      // Replace the frozen claims once; the initial digest can never be rebound.
      claims = Object.freeze({initial: claims.initial, correction: sent.claimSha256});
      state.correctionClaimSha256 = claims.correction!;
      state.correctionClaimed = true;
    } catch {
      return await reconcile('correction');
    }
    if (!await observe('correction')) return block('correction_observation_blocked');
    state.stage = 'verifying_corrected_report';
    const final = await activities.verifyLiveReport(attempt, claims);
    state.finalReceipt = final;
    if (!receiptMatches(final)) return block('final_receipt_identity_or_evidence_mismatch');
    if (final.initialArtifactSha256 !== initial.artifactSha256) return block('final_initial_artifact_hash_mismatch');
    if (final.accepted !== true || final.missing.length !== 0) {
      state.missing.push(...final.missing);
      return block('final_report_not_accepted');
    }
    state.stage = 'recording_acceptance';
    await activities.recordLiveAcceptance(attempt, final, claims);
    state.stage = 'verified_approval_boundary';
    return snapshot();
  } catch {
    return block('activity_failed_at_' + state.stage);
  }
}
