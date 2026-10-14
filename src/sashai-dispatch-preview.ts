import { createHash } from 'node:crypto';
import type { PlanGate } from './sashai-task-source.js';
import { parseSashaiChatUrl } from './sashai-observer.js';

export interface ContinuationBinding {
  taskId: string;
  taskText: string;
  chatUrl: string;
  activePlan: string;
  planSha256: string;
  checkpoint: string;
  remainingSteps: string[];
  acceptanceChecks: string[];
}

interface PreviewInput {
  taskSource: PlanGate;
  observation: {
    url: string;
    browser: string;
    turnState: string;
    pageBusyHint?: boolean;
  } | null;
  binding?: ContinuationBinding | null;
  connectorPreservingTransportVerified?: boolean;
  previousAttempt?: 'none' | 'submitted' | 'unknown';
}

const hasText = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const hasItems = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(hasText);

/** Proposal only: no browser calls, claims, task approval or submission. */
export function previewSashaiContinuation(input: PreviewInput) {
  const { taskSource, observation, binding } = input;
  const result = (action: string, blockers: string[], prompt: string | null = null) => ({
    mode: 'read_only_preview' as const,
    executionEnabled: false as const,
    submitsMessages: false as const,
    action, blockers, taskId: binding?.taskId ?? null,
    conversationUrl: observation?.url ?? null,
    prompt,
    promptSha256: prompt ? createHash('sha256').update(prompt).digest('hex') : null,
  });
  if (!observation || observation.browser !== 'attached_read_only')
    return result('wait_for_observation', ['The bound conversation is not currently observable.']);
  try { parseSashaiChatUrl(observation.url); }
  catch { return result('wait_for_observation', ['Observation is not a Sashai project conversation.']); }
  if (observation.turnState === 'running' || observation.turnState === 'awaiting_answer')
    return result('observe', ['The current turn is active or awaiting a response; do not send another message.']);
  if (observation.turnState !== 'turn_finished')
    return result('wait_for_observation', ['A finished response has not been established.']);
  const blockers: string[] = [];
  if (input.previousAttempt !== 'none')
    blockers.push('Establish that no continuation was already submitted before preparing another.');
  if (taskSource.status !== 'approved_plan_has_pending_tasks' || !taskSource.planSha256)
    blockers.push('No approved active plan with pending tasks and a known revision.');
  if (!binding) blockers.push('No explicit current-task and checkpoint binding.');
  else {
    if (!hasText(binding.taskId) || !hasText(binding.taskText)) blockers.push('Task identity is missing.');
    let boundUrl: string | null = null;
    try { boundUrl = parseSashaiChatUrl(binding.chatUrl).url; } catch {}
    if (boundUrl !== observation.url) blockers.push('Task binding does not match the observed conversation.');
    if (binding.activePlan !== taskSource.activePlan || binding.planSha256 !== taskSource.planSha256)
      blockers.push('Task binding refers to a different or stale active-plan revision.');
    if (!taskSource.tasks.includes(binding.taskText)) blockers.push('Bound task is not an unchecked item in the approved plan projection.');
    if (!hasText(binding.checkpoint) || !hasItems(binding.remainingSteps))
      blockers.push('An explicit unfinished-work checkpoint and remaining steps are required.');
    if (!hasItems(binding.acceptanceChecks)) blockers.push('Independent acceptance checks are required.');
  }
  if (!input.connectorPreservingTransportVerified)
    blockers.push('A task-capable sender preserving Desktop Commander selection has not been verified.');
  if (blockers.length || !binding)
    return result(input.previousAttempt !== 'none' ? 'reconcile_attempt' : 'blocked', blockers);

  const prompt = [
    `Continue the SAME Sashai task ${binding.taskId} in this conversation using Remote Desktop Commander on my MacBook.`,
    `Repository: ${taskSource.repository}`,
    `Follow AGENTS.md and ${binding.activePlan}, Task Breakdown item: ${binding.taskText}`,
    `Checkpoint: ${binding.checkpoint}`,
    'Remaining steps:', ...binding.remainingSteps.map(step => '- ' + step),
    'Required acceptance checks:', ...binding.acceptanceChecks.map(check => '- ' + check),
    'Do not start an unrelated task. Return completed work, actual check results, remaining work and blockers.',
  ].join('\n');
  return result('prepare_continuation', [], prompt);
}
